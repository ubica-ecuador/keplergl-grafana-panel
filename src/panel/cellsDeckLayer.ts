import { CompositeLayer, type Layer, type UpdateParameters } from '@deck.gl/core';
import { A5Layer, GeohashLayer, H3HexagonLayer, S2Layer } from '@deck.gl/geo-layers';
import { naturalBreaks } from '@kepler.gl/utils';
import { scaleLinear, scaleLog, scaleQuantize, scaleSqrt } from 'd3-scale';

import {
  cellAreaKm2,
  fineCellOf,
  parentOf,
  resolutionFor,
  s2TokenOf,
  systemOf,
  type CellId,
  type CellSystem,
} from './cellsGrid';

type Row = { index: number };
type RGBA = [number, number, number, number];
/** A scale from a cell's value to a colour, as kepler builds it for the layer (and its legend). */
export type ColourScaleOf = (type: string, domain: number[]) => ((value: number) => unknown) | null;

/** One cell with the rows in it, in the shape kepler's aggregation popup reads (points, colorValue, elevationValue). */
export interface CellBin {
  cell: CellId;
  /** What deck's cell layer reads: the cell id, or an S2 token. */
  key: string | bigint;
  res: number;
  points: Row[];
  count: number;
  colorValue: number;
  elevationValue: number;
  /** The mean of its rows' positions: where its count label goes, and what culling tests. */
  position: [number, number];
  /** Where its colour and height are going, and where they come from while the transition runs. */
  color: RGBA;
  elevation: number;
  fromColor: RGBA;
  fromElevation: number;
  /** Its colour's place in the palette (fractional while moving), NaN for a colour off the palette. */
  pos: number;
  fromPos: number;
}

/** What a cell shows at one moment. */
interface Shown {
  color: RGBA;
  elevation: number;
  pos: number;
}

export interface CellsDeckLayerProps {
  data: Row[];
  /** The dataset's container: rows keep their fine cells while it is the same one. */
  cellSource: unknown;
  getPosition: (row: Row) => [number, number];
  getColorValue?: (points: Row[]) => number;
  getElevationValue?: (points: Row[]) => number;
  cellSystem: CellSystem;
  cellPixels: number;
  cellDensity: boolean;
  /** Milliseconds for a cell to reach its new colour and height; 0 snaps. */
  cellTransition: number;
  colorRange: number[][];
  /** The layer's colour scale as kepler names it (quantize, quantile, jenks, custom, log, sqrt). */
  cellColorScale: string;
  colorScaleOf?: ColourScaleOf;
  extruded: boolean;
  elevationScale: number;
  elevationRange: [number, number];
  /** linear, sqrt or log, kepler's height scales. */
  elevationScaleType: string;
  coverage: number;
  onSetColorDomain?: (value: {
    domain: number[];
    aggregatedBins: Record<number, { i: number; value: number; counts: number }>;
  }) => void;
  renderCountLabels?: ((labels: Array<{ position: [number, number]; count: number }>) => Layer[]) | null;
}

interface State {
  [key: string]: unknown;
  system: CellSystem;
  source: unknown;
  /** Each row's fine cell, by row index. */
  fine: Map<number, CellId>;
  res: number;
  bins: CellBin[];
  /** Bins whose position is inside `cullBox`: what is drawn. */
  shown: CellBin[];
  cullBox: [number, number, number, number] | null;
  version: number;
  lastDomain: string;
  /** The transition under way: when it started and how long it lasts. */
  anim: { start: number; duration: number } | null;
  /** The colour scale's classes, which a moving colour walks along. */
  palette: RGBA[];
  frame: number;
  raf: number | null;
}

/** The share of the view added on each side before culling, so a small pan draws nothing new. */
const CULL_MARGIN = 0.5;
const TRANSPARENT: RGBA = [0, 0, 0, 0];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const easeOut = (t: number) => 1 - (1 - t) ** 3;

function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

/** The colour at a fractional place in the palette, between its two neighbouring classes. */
function paletteAt(palette: RGBA[], pos: number): RGBA {
  const i = Math.max(0, Math.min(palette.length - 1, Math.floor(pos)));
  const j = Math.min(palette.length - 1, i + 1);
  return mix(palette[i], palette[j], Math.max(0, Math.min(1, pos - i)));
}

/** A colour's class in the scale's range: the same array kepler's scale returned, or equal values. */
function positionOf(colour: unknown, range: unknown[]): number {
  const at = range.indexOf(colour);
  if (at >= 0) {
    return at;
  }
  const c = rgba(colour);
  const found = range.findIndex((r) => {
    const x = rgba(r);
    return x[0] === c[0] && x[1] === c[1] && x[2] === c[2];
  });
  return found >= 0 ? found : Number.NaN;
}

/**
 * A cell's colour a share `t` of the way: along the palette when both ends are on it, so a cell going from the first
 * class to the last passes through the classes between (a straight line in RGB goes brown between purple and yellow);
 * straight in RGB otherwise. Its opacity moves on its own, for cells fading in or out.
 */
function shade(palette: RGBA[], from: RGBA, to: RGBA, fromPos: number, toPos: number, t: number): RGBA {
  const a = Number.isFinite(fromPos) ? fromPos : toPos;
  const b = Number.isFinite(toPos) ? toPos : fromPos;
  if (palette.length > 1 && Number.isFinite(a) && Number.isFinite(b)) {
    const c = paletteAt(palette, a + (b - a) * t);
    return [c[0], c[1], c[2], from[3] + (to[3] - from[3]) * t];
  }
  return mix(from, to, t);
}

function rgba(colour: unknown): RGBA {
  if (!Array.isArray(colour) || colour.length < 3) {
    return TRANSPARENT;
  }
  return [Number(colour[0]), Number(colour[1]), Number(colour[2]), colour.length > 3 ? Number(colour[3]) : 255];
}

/**
 * Points binned into the cells of a discrete global grid (H3, A5, S2 or geohash) whose level follows the zoom: each
 * cell is about `cellPixels` across on screen. A cell is coloured (and raised) by kepler's own aggregation of its
 * rows, so Count, Sum, Average and the time filter behave as in Hexbin; the colour domain goes back to kepler through
 * `onSetColorDomain`, as the Hexbin's does, so the legend follows.
 *
 * Changes are eased over `cellTransition` ms: a cell starts from the colour and height it showed, from its parent's
 * when the zoom split it (children come out of their parent) or from the mean of its children's when the zoom merged
 * them, and fades in when it has neither.
 */
export class CellsDeckLayer extends CompositeLayer<CellsDeckLayerProps> {
  static layerName = 'PlusCellsLayer';
  static defaultProps = {
    cellSystem: 'h3',
    cellPixels: 36,
    cellDensity: false,
    cellTransition: 400,
    cellColorScale: 'quantile',
    extruded: false,
    elevationScale: 1,
    elevationRange: [0, 500],
    elevationScaleType: 'linear',
    coverage: 1,
    // Fresh functions on every kepler render; the update triggers say when their results change.
    getPosition: { type: 'function', value: null, compare: false },
    getColorValue: { type: 'function', value: null, compare: false, optional: true },
    getElevationValue: { type: 'function', value: null, compare: false, optional: true },
    colorScaleOf: { type: 'function', value: null, compare: false, optional: true },
    onSetColorDomain: { type: 'function', value: null, compare: false, optional: true },
    renderCountLabels: { type: 'function', value: null, compare: false, optional: true },
  };

  declare state: State;

  initializeState(): void {
    this.setState({
      fine: new Map(),
      res: -1,
      bins: [],
      shown: [],
      cullBox: null,
      version: 0,
      lastDomain: '',
      anim: null,
      palette: [],
      frame: 0,
      raf: null,
    });
  }

  finalizeState(context: Parameters<CompositeLayer['finalizeState']>[0]): void {
    if (this.state.raf !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.state.raf);
    }
    super.finalizeState(context);
  }

  shouldUpdateState({ changeFlags }: UpdateParameters<this>): boolean {
    return changeFlags.somethingChanged;
  }

  updateState({ props, oldProps, changeFlags }: UpdateParameters<this>): void {
    const system = systemOf(props.cellSystem);
    const viewport = this.context.viewport;
    const latitude = (viewport as unknown as { latitude?: number }).latitude ?? 0;
    const res = resolutionFor(system, props.cellPixels, viewport.zoom, latitude);

    let rebin = false;
    let sameGrid = true;
    if (system !== this.state.system || props.cellSource !== this.state.source) {
      // Another grid, or other data: nothing to come from, the cells fade in.
      sameGrid = system === this.state.system;
      this.setState({ system, source: props.cellSource, fine: new Map() });
      rebin = true;
    }
    if (changeFlags.dataChanged || res !== this.state.res) {
      rebin = true;
    }
    const triggers = changeFlags.updateTriggersChanged;
    const recolour =
      rebin ||
      Boolean(triggers && (triggers.all || triggers.getColorValue || triggers.getElevationValue)) ||
      props.cellDensity !== oldProps.cellDensity ||
      props.colorRange !== oldProps.colorRange ||
      props.cellColorScale !== oldProps.cellColorScale ||
      props.extruded !== oldProps.extruded ||
      props.elevationScale !== oldProps.elevationScale ||
      props.elevationRange !== oldProps.elevationRange ||
      props.elevationScaleType !== oldProps.elevationScaleType;

    // A filter only recolours (an emptied cell turns transparent), so the cells drawn, and their outlines, stay.
    const moved = !this.state.cullBox || !inside(viewBox(viewport), this.state.cullBox);
    // What is on screen now, which the new colours start from (none on the frames of a transition).
    const before = (recolour || moved) && sameGrid ? this.displayed() : null;
    const beforeRes = this.state.res;

    if (rebin) {
      this.setState({ res, bins: this.binRows(system, res) });
    }
    if (recolour) {
      this.aggregate(system);
    }
    if (rebin || moved) {
      this.cull();
    }
    if (recolour || moved) {
      this.paint();
      this.startFrom(system, before, beforeRes);
    }
  }

  /** The rows grouped by their cell at `res`, each row placed at the fine level once per dataset. */
  private binRows(system: CellSystem, res: number): CellBin[] {
    const { data, getPosition } = this.props;
    const fine = this.state.fine;
    const groups = new Map<CellId, { points: Row[]; lng: number; lat: number }>();
    for (const row of data ?? []) {
      let cell = fine.get(row.index);
      const [lng, lat] = getPosition(row);
      if (cell === undefined) {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          continue;
        }
        cell = fineCellOf(system, lat, lng);
        fine.set(row.index, cell);
      }
      const at = parentOf(system, cell, res);
      let group = groups.get(at);
      if (!group) {
        group = { points: [], lng: 0, lat: 0 };
        groups.set(at, group);
      }
      group.points.push(row);
      group.lng += lng;
      group.lat += lat;
    }
    const bins: CellBin[] = [];
    for (const [cell, group] of groups) {
      const n = group.points.length;
      bins.push({
        cell,
        key: system === 's2' ? s2TokenOf(cell as string) : cell,
        res,
        points: group.points,
        count: n,
        colorValue: n,
        elevationValue: n,
        position: [group.lng / n, group.lat / n],
        color: TRANSPARENT,
        elevation: 0,
        fromColor: TRANSPARENT,
        fromElevation: 0,
        pos: Number.NaN,
        fromPos: Number.NaN,
      });
    }
    return bins;
  }

  /** Kepler's aggregation of each cell's rows (NaN once a filter empties it), per km² with density on. */
  private aggregate(system: CellSystem): void {
    const { getColorValue, getElevationValue, cellDensity, extruded } = this.props;
    for (const bin of this.state.bins) {
      const value = getColorValue ? getColorValue(bin.points) : bin.points.length;
      bin.colorValue = cellDensity && Number.isFinite(value) ? value / cellAreaKm2(system, bin.cell, bin.res) : value;
      if (extruded) {
        bin.elevationValue = getElevationValue ? getElevationValue(bin.points) : bin.points.length;
      }
    }
  }

  /** The domain kepler expects for each colour scale: every value for quantile, the breaks for Jenks, else the range. */
  private domainOf(type: string, values: number[]): number[] {
    if (type === 'quantile') {
      return values;
    }
    if (type === 'jenks') {
      const classes = (this.props.colorRange ?? []).length;
      return values.length ? (naturalBreaks(values, classes) as number[]) : [];
    }
    return [values[0] ?? 0, values[values.length - 1] ?? 0];
  }

  /**
   * Colours and heights from the cells near the view, not the whole dataset: a dynamic grid shows what is in the view,
   * so the scale (and the legend) is that of the cells there. Far away cells would otherwise set it: the world's
   * sparse cells put every cell of a dense region in the top class. The colour scale is kepler's own for the layer
   * (`colorScaleOf`), the one its legend draws.
   */
  private paint(): void {
    const { colorRange, cellColorScale, colorScaleOf, extruded, elevationScaleType } = this.props;
    const shown = this.state.shown;
    const values = shown
      .map((b) => b.colorValue)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const domain = this.domainOf(cellColorScale, values);
    const fallback = () =>
      scaleQuantize<number[]>()
        .domain([domain[0] ?? 0, Math.max(domain[domain.length - 1] ?? 1, (domain[0] ?? 0) + 1)])
        .range(colorRange ?? []);
    const scale = values.length ? (colorScaleOf?.(cellColorScale, domain) ?? fallback()) : null;

    let minElevation = Infinity;
    let maxElevation = 0;
    if (extruded) {
      for (const bin of shown) {
        const e = bin.elevationValue;
        if (Number.isFinite(e)) {
          maxElevation = Math.max(maxElevation, e);
          if (e > 0) {
            minElevation = Math.min(minElevation, e);
          }
        }
      }
    }
    const [lo, hi] = this.props.elevationRange ?? [0, 500];
    const heightOf =
      elevationScaleType === 'log' && Number.isFinite(minElevation) && maxElevation > minElevation
        ? scaleLog().domain([minElevation, maxElevation]).range([lo, hi]).clamp(true)
        : (elevationScaleType === 'sqrt' ? scaleSqrt() : scaleLinear()).domain([0, maxElevation || 1]).range([lo, hi]);

    const range = (scale as unknown as { range?: () => unknown[] } | null)?.range?.() ?? [];
    this.setState({ palette: range.map(rgba) });
    for (const bin of shown) {
      const colour = scale && Number.isFinite(bin.colorValue) ? scale(bin.colorValue) : null;
      bin.color = colour ? rgba(colour) : TRANSPARENT;
      bin.pos = colour ? positionOf(colour, range) : Number.NaN;
      bin.elevation = extruded && Number.isFinite(bin.elevationValue) ? heightOf(bin.elevationValue) : 0;
    }
    this.setState({ version: this.state.version + 1 });
    this.reportDomain(domain, values);
  }

  /** The colour and height each drawn cell shows at this moment, by cell. */
  private displayed(): Map<CellId, Shown> {
    const t = this.progress();
    const out = new Map<CellId, Shown>();
    for (const bin of this.state.shown) {
      out.set(bin.cell, this.shownAt(bin, t));
    }
    return out;
  }

  /** What a cell shows a share `t` of the way through the transition. */
  private shownAt(bin: CellBin, t: number): Shown {
    if (t >= 1) {
      return { color: bin.color, elevation: bin.elevation, pos: bin.pos };
    }
    const a = Number.isFinite(bin.fromPos) ? bin.fromPos : bin.pos;
    const b = Number.isFinite(bin.pos) ? bin.pos : bin.fromPos;
    return {
      color: shade(this.state.palette, bin.fromColor, bin.color, bin.fromPos, bin.pos, t),
      elevation: bin.fromElevation + (bin.elevation - bin.fromElevation) * t,
      pos: a + (b - a) * t,
    };
  }

  /**
   * Sets where each drawn cell starts from and runs the transition: the same cell's colour; the parent's when the
   * level got finer; the mean of the children's when it got coarser; else its own colour, transparent.
   */
  private startFrom(system: CellSystem, before: Map<CellId, Shown> | null, beforeRes: number): void {
    const duration = Math.max(0, Number(this.props.cellTransition) || 0);
    const res = this.state.res;
    let merged: Map<CellId, Shown> | null = null;
    if (before && beforeRes > res) {
      const sums = new Map<CellId, { c: number[]; e: number; n: number; p: number; pw: number }>();
      for (const [cell, shown] of before) {
        const parent = parentOf(system, cell, res);
        const sum = sums.get(parent) ?? { c: [0, 0, 0, 0], e: 0, n: 0, p: 0, pw: 0 };
        // Weighted by alpha, so a transparent (emptied) child does not grey its parent.
        const a = shown.color[3] / 255;
        sum.c[0] += shown.color[0] * a;
        sum.c[1] += shown.color[1] * a;
        sum.c[2] += shown.color[2] * a;
        sum.c[3] += a;
        sum.e += shown.elevation;
        sum.n += 1;
        if (Number.isFinite(shown.pos)) {
          sum.p += shown.pos * a;
          sum.pw += a;
        }
        sums.set(parent, sum);
      }
      merged = new Map();
      for (const [cell, s] of sums) {
        const w = s.c[3] || 1;
        merged.set(cell, {
          color: [s.c[0] / w, s.c[1] / w, s.c[2] / w, (255 * s.c[3]) / s.n],
          elevation: s.e / s.n,
          pos: s.pw > 0 ? s.p / s.pw : Number.NaN,
        });
      }
    }
    for (const bin of this.state.shown) {
      let start = before?.get(bin.cell);
      if (!start && before && beforeRes >= 0 && beforeRes < res) {
        start = before.get(parentOf(system, bin.cell, beforeRes));
      }
      if (!start && merged) {
        start = merged.get(bin.cell);
      }
      bin.fromColor = start ? start.color : [bin.color[0], bin.color[1], bin.color[2], 0];
      bin.fromElevation = start ? start.elevation : 0;
      // A cell fading in keeps its own colour on the way.
      bin.fromPos = start ? start.pos : bin.pos;
    }
    if (duration === 0) {
      this.setState({ anim: null });
      return;
    }
    this.setState({ anim: { start: now(), duration } });
    this.tick();
  }

  /** How far the transition is, 0 to 1 eased; 1 when none runs. */
  private progress(): number {
    const anim = this.state.anim;
    if (!anim) {
      return 1;
    }
    return easeOut(Math.min(1, (now() - anim.start) / anim.duration));
  }

  /** One frame of the transition: redraws the cells' colours and asks for the next frame until it is done. */
  private tick(): void {
    if (this.state.raf !== null || typeof requestAnimationFrame === 'undefined') {
      return;
    }
    const step = () => {
      // kepler renders a new instance of this layer on every map update; the state moves to it.
      const layer = (this.getCurrentLayer() ?? this) as CellsDeckLayer;
      const done = layer.progress() >= 1;
      layer.setState({ frame: layer.state.frame + 1, raf: done ? null : requestAnimationFrame(step) });
      if (done) {
        layer.setState({ anim: null });
      }
    };
    this.setState({ raf: requestAnimationFrame(step) });
  }

  /** The legend's domain, sent to kepler only when it changed (kepler stores it in the layer's config). */
  private reportDomain(domain: number[], values: number[]): void {
    const { onSetColorDomain } = this.props;
    const signature = `${this.state.res}:${this.props.cellColorScale}:${domain.length}:${domain[0]}:${domain[domain.length - 1]}`;
    if (!onSetColorDomain || signature === this.state.lastDomain || values.length === 0) {
      return;
    }
    this.setState({ lastDomain: signature });
    const aggregatedBins: Record<number, { i: number; value: number; counts: number }> = {};
    this.state.shown.forEach((bin, i) => {
      aggregatedBins[i] = { i, value: bin.colorValue, counts: bin.count };
    });
    onSetColorDomain({ domain, aggregatedBins });
  }

  /** The bins near the view: drawing a cell is the costly part (its outline), so far ones wait until panned to. */
  private cull(): void {
    const box = viewBox(this.context.viewport);
    const w = box[2] - box[0];
    const h = box[3] - box[1];
    const cullBox: [number, number, number, number] = [
      box[0] - w * CULL_MARGIN,
      box[1] - h * CULL_MARGIN,
      box[2] + w * CULL_MARGIN,
      box[3] + h * CULL_MARGIN,
    ];
    const shown = this.state.bins.filter(
      (b) =>
        b.position[0] >= cullBox[0] &&
        b.position[0] <= cullBox[2] &&
        b.position[1] >= cullBox[1] &&
        b.position[1] <= cullBox[3]
    );
    this.setState({ shown, cullBox });
  }

  renderLayers(): Layer[] {
    const system = systemOf(this.props.cellSystem);
    const { extruded, coverage, renderCountLabels } = this.props;
    const t = this.progress();
    const trigger = `${this.state.version}:${t >= 1 ? 'end' : this.state.frame}`;
    const shownAt = (b: CellBin) => this.shownAt(b, t);
    const common = {
      data: this.state.shown,
      filled: true,
      stroked: false,
      extruded,
      wireframe: false,
      elevationScale: this.props.elevationScale,
      getFillColor: (b: CellBin) => shownAt(b).color,
      getElevation: (b: CellBin) => shownAt(b).elevation,
      updateTriggers: { getFillColor: trigger, getElevation: trigger },
    };
    const props = this.getSubLayerProps({ id: `cells-${system}` });
    const layers: Layer[] = [];
    if (system === 'h3') {
      layers.push(
        new H3HexagonLayer<CellBin>({
          ...props,
          ...common,
          coverage,
          highPrecision: 'auto',
          getHexagon: (b) => b.key as string,
        })
      );
    } else if (system === 'a5') {
      layers.push(new A5Layer<CellBin>({ ...props, ...common, getPentagon: (b) => b.key as bigint }));
    } else if (system === 's2') {
      layers.push(new S2Layer<CellBin>({ ...props, ...common, getS2Token: (b) => b.key as string }));
    } else {
      layers.push(new GeohashLayer<CellBin>({ ...props, ...common, getGeohash: (b) => b.key as string }));
    }
    if (renderCountLabels) {
      layers.push(...renderCountLabels(this.state.shown.map((b) => ({ position: b.position, count: b.count }))));
    }
    return layers;
  }
}

/** The view's [west, south, east, north]. */
function viewBox(viewport: { getBounds?: () => number[] }): [number, number, number, number] {
  const b = viewport.getBounds?.() ?? [-180, -90, 180, 90];
  return [b[0], b[1], b[2], b[3]];
}

function inside(view: [number, number, number, number], box: [number, number, number, number]): boolean {
  return view[0] >= box[0] && view[1] >= box[1] && view[2] <= box[2] && view[3] <= box[3];
}
