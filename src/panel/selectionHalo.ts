/**
 * Which rows of the map are the dashboard's selection, and where to mark them.
 *
 * The selection is what the click mappings have *published* — the variables in
 * the URL — not kepler's clicked entity, which a data refresh erases and a
 * shared link never had. Free of kepler, deck and React, so the rules can be
 * tested with literal values; `selectionHaloInput.ts` reads kepler into these
 * shapes and `selectionHaloDeckLayers.ts` draws what comes out.
 */

/** Column name → the values the dashboard has selected in it. */
export type Selection = Readonly<Record<string, readonly string[]>>;

/** One dataset, as much of it as the halo needs. */
export interface HaloDataset {
  fieldNames: readonly string[];
  numRows: number;
  valueAt: (row: number, column: number) => unknown;
  /**
   * What the row scan is cached on: kepler's `dataContainer`. Filtering copies
   * the dataset object (`copyTableAndUpdate`) but keeps this one, so a moving
   * clock does not rescan while a new query result does.
   */
  cacheKey: object;
}

/** The last scan of each data container: one selection at a time is enough. */
const scans = new WeakMap<object, { key: string; rows: readonly number[] }>();

/**
 * The rows whose value in any selected column is one of that column's values.
 *
 * A union over the columns: a panel mapping both a zone and a station marks the
 * selected station and every row of the selected zone. Values compare as
 * strings, the way the URL holds them, so the 13 in a row is the "13" of a
 * variable. Scanned once per data container and selection — the map repaints
 * on every pointer move, and a large dataset must not be walked each time.
 */
export function selectedRows(dataset: HaloDataset, selection: Selection): readonly number[] {
  const columns: Array<[number, ReadonlySet<string>]> = [];
  for (const [name, values] of Object.entries(selection)) {
    const index = dataset.fieldNames.indexOf(name);
    if (index >= 0 && values.length) {
      columns.push([index, new Set(values)]);
    }
  }
  if (!columns.length) {
    return [];
  }

  const key = JSON.stringify(columns.map(([index, values]) => [index, [...values].sort()]).sort());
  const last = scans.get(dataset.cacheKey);
  if (last?.key === key) {
    return last.rows;
  }

  const rows: number[] = [];
  for (let row = 0; row < dataset.numRows; row++) {
    for (const [index, values] of columns) {
      const value = dataset.valueAt(row, index);
      if (value !== null && value !== undefined && values.has(String(value))) {
        rows.push(row);
        break;
      }
    }
  }
  scans.set(dataset.cacheKey, { key, rows });
  return rows;
}

/** Room between a point's edge and its ring, in pixels. */
export const RING_MARGIN_PX = 6;

/** The smallest ring drawn, however small the point: a 2 px dot needs a visible ring. */
export const RING_MIN_PX = 10;

/** How kepler sizes a point layer's points, read from its config. */
export interface PointRadius {
  /** `visConfig.radius`, or the top of `visConfig.radiusRange` when a column sizes the points. */
  base: number;
  /** `fixedRadius` with a size column: metres on the ground at every zoom. */
  fixed: boolean;
}

/** One kepler layer, as much of it as the halo needs. */
export interface HaloLayer {
  id: string;
  type: string;
  isVisible: boolean;
  dataId: string;
  /** kepler's column roles → field index; a role the layer does not use is absent. */
  columns: Readonly<Partial<Record<'lat' | 'lng' | 'geojson' | 'hex_id', number>>>;
  /** Point layers only. */
  radius?: PointRadius;
}

export interface HaloInput {
  selection: Selection;
  layers: readonly HaloLayer[];
  datasets: Readonly<Record<string, HaloDataset>>;
  /**
   * Whether kepler's filters let this row of this layer through — every valid
   * filter, CPU and GPU alike; a polygon filter only on the layers it targets.
   */
  rowPasses: (dataId: string, row: number, layerId: string) => boolean;
  /** This side's layers when the map is split, null when it is not. */
  sideLayers: Readonly<Record<string, boolean>> | null;
  zoom: number;
}

export interface HaloRing {
  position: [number, number];
  radiusPx: number;
}

/** A shape to outline: a GeoJSON cell's raw value, or an H3 index. */
export interface HaloShape {
  kind: 'geojson' | 'hexagon';
  value: unknown;
}

export interface HaloTargets {
  rings: HaloRing[];
  shapes: HaloShape[];
}

const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6378137;

/** deck's web-mercator world is 512 pixels wide at zoom 0. */
const TILE_SIZE_PX = 512;

/**
 * A kepler point's radius on screen, in pixels.
 *
 * kepler hands deck's `ScatterplotLayer` a radius in metres (deck's default
 * `radiusUnits`): `getRadiusScaleByZoom` multiplies the layer's radius by
 * `getZoomFactor`, 2^max(14 − zoom, 0), and uses 1 when the radius is fixed. So
 * below zoom 14 a point keeps its size on screen and above it grows with the
 * map.
 */
export function pointRadiusPx(radius: PointRadius, zoom: number, latitude: number): number {
  const metres = radius.fixed ? radius.base : radius.base * Math.pow(2, Math.max(14 - zoom, 0));
  const metresPerPixel =
    (EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180)) / (TILE_SIZE_PX * Math.pow(2, zoom));
  return metres / metresPerPixel;
}

/**
 * A cell that holds nothing. `Number(null)` and `Number('')` are 0, so an empty
 * coordinate would pass `Number.isFinite` and be ringed at latitude 0 — inside
 * Ecuador at longitude −79 — where kepler, which checks the raw values, draws
 * no point at all.
 */
function isEmptyCell(value: unknown): value is null | undefined | '' {
  return value === null || value === undefined || value === '';
}

/** A coordinate cell as a number, or NaN when it holds nothing. */
function coordinate(value: unknown): number {
  return isEmptyCell(value) ? NaN : Number(value);
}

/** How a layer's rows are marked, or null for a type the halo leaves alone. */
function haloKind(layer: HaloLayer): 'ring' | 'geojson' | 'hexagon' | null {
  const has = (role: 'lat' | 'lng' | 'geojson' | 'hex_id') => (layer.columns[role] ?? -1) >= 0;
  switch (layer.type) {
    case 'point':
      return has('lat') && has('lng') ? 'ring' : null;
    case 'geojson':
      return has('geojson') ? 'geojson' : null;
    case 'hexagonId':
      return has('hex_id') ? 'hexagon' : null;
    default:
      return null;
  }
}

/**
 * The rings and outlines that mark the selection on one side of the map.
 *
 * Only where the row is drawn: its layer is visible, on this side of a split
 * map, and kepler's filters let the row through — never a ring around nothing.
 * One mark per row and geometry, however many layers draw it: two point layers
 * on the same columns keep the larger ring, so it stays outside both points,
 * while a trip's pickup and dropoff layers ring each end.
 */
export function selectionHalo(input: HaloInput): HaloTargets {
  const rings = new Map<string, HaloRing>();
  const shapes = new Map<string, HaloShape>();

  for (const layer of input.layers) {
    if (!layer.isVisible || (input.sideLayers && !input.sideLayers[layer.id])) {
      continue;
    }
    const dataset = input.datasets[layer.dataId];
    const kind = haloKind(layer);
    if (!dataset || !kind) {
      continue;
    }

    for (const row of selectedRows(dataset, input.selection)) {
      if (!input.rowPasses(layer.dataId, row, layer.id)) {
        continue;
      }
      if (kind === 'ring') {
        const latIdx = layer.columns.lat!;
        const lngIdx = layer.columns.lng!;
        const lat = coordinate(dataset.valueAt(row, latIdx));
        const lng = coordinate(dataset.valueAt(row, lngIdx));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          continue;
        }
        const pointPx = layer.radius ? pointRadiusPx(layer.radius, input.zoom, lat) : 0;
        const radiusPx = Math.max(RING_MIN_PX, pointPx + RING_MARGIN_PX);
        const key = `${layer.dataId}:${row}:${latIdx}:${lngIdx}`;
        const existing = rings.get(key);
        if (!existing || existing.radiusPx < radiusPx) {
          rings.set(key, { position: [lng, lat], radiusPx });
        }
        continue;
      }

      const columnIdx = kind === 'geojson' ? layer.columns.geojson! : layer.columns.hex_id!;
      const value = dataset.valueAt(row, columnIdx);
      if (!isEmptyCell(value)) {
        shapes.set(`${layer.dataId}:${row}:${kind}:${columnIdx}`, { kind, value });
      }
    }
  }

  return { rings: [...rings.values()], shapes: [...shapes.values()] };
}
