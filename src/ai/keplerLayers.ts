import { KEPLER_COLOR_PALETTES } from '@kepler.gl/constants';

/**
 * What "Ask the map" may draw, and how each request becomes a kepler layer in
 * the saved (v1) format `addLayer` validates against the dataset. Pure, so the
 * mapping is tested without a store.
 */
export const LAYER_TYPES = ['point', 'heatmap', 'hexagon', 'grid', 'cluster'] as const;
export type LayerType = (typeof LAYER_TYPES)[number];

export const AGGREGATIONS = ['count', 'sum', 'average', 'minimum', 'maximum', 'median'] as const;

export interface LayerStyle {
  /** Column that colours the layer (for hexagon/grid/cluster: aggregated with `aggregation`). */
  colorBy?: { name: string; type: string } | null;
  /** Point radius, hexagon/grid height, heatmap weight. */
  sizeBy?: { name: string; type: string } | null;
  /** Hexagon/grid extruded columns, heatmap surface. */
  threeD?: boolean;
  /** Pixels for point, heatmap and cluster; kilometres for hexagon and grid. */
  radius?: number;
  opacity?: number;
  palette?: string;
  aggregation?: (typeof AGGREGATIONS)[number];
}

export interface LayerSpec extends LayerStyle {
  type: LayerType;
  dataId: string;
  label: string;
  lat: string;
  lng: string;
}

export interface ColorRange {
  name: string;
  type: string;
  category: string;
  colors: string[];
}

/** A kepler palette by name (case-insensitive), as the colour range a layer holds; null when unknown. */
export function paletteRange(name: string, steps = 6): ColorRange | null {
  const wanted = name.trim().toLowerCase();
  const palette = KEPLER_COLOR_PALETTES.find((p) => p.name.toLowerCase() === wanted);
  if (!palette) {
    return null;
  }
  const max = 'maxStep' in palette ? palette.maxStep : steps;
  return { name: palette.name, type: palette.type, category: palette.category, colors: palette.colors(Math.min(steps, max)) };
}

/** A palette with its colours the other way round (RdYlBu → blue low, red high). */
export function reversedPalette(name: string, steps = 6): ColorRange | null {
  const range = paletteRange(name, steps);
  return range ? { ...range, name: `${range.name} (reversed)`, colors: [...range.colors].reverse() } : null;
}

/** A few palettes worth naming to the model; any kepler palette name works. */
export const SUGGESTED_PALETTES = ['Global Warming', 'Viridis', 'Inferno', 'Magma', 'Turbo', 'YlOrRd', 'Blues', 'RdYlBu', 'Spectral', 'Tableau10'];

const isNumeric = (type?: string) => type === 'real' || type === 'integer';

/**
 * 3D heights that read at the data's own scale. kepler's defaults (hexagon
 * elevation ×5, heatmap surface 1 km) are made for a city: on a world of
 * quakes the columns and the surface were too low to see.
 */
export function heightsFor(extentKm: number): { elevationScale: number; surfaceHeight: number } {
  return {
    // Hexagon/grid heights run 0–500 m before the scale: the tallest cell reaches ~1.2 % of the extent
    // (twice that leaned far out of the frame from straight above, as perspective does to tall columns).
    elevationScale: Math.round(clamp(extentKm / 40, 1, 1000)),
    // Metres; about 1 % of the extent, within kepler's 0–100 km.
    surfaceHeight: Math.round(clamp(extentKm * 10, 200, 100000)),
  };
}

/** The visConfig key each style option lands in, per layer type. */
export function visConfigFor(type: LayerType, style: LayerStyle): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (style.opacity !== undefined) {
    out.opacity = clamp(style.opacity, 0, 1);
  }
  if (style.palette) {
    const range = paletteRange(style.palette);
    if (range) {
      out.colorRange = range;
    }
  }
  switch (type) {
    case 'point':
      if (style.radius !== undefined) {
        out.radius = clamp(style.radius, 1, 100);
      }
      break;
    case 'heatmap':
      if (style.radius !== undefined) {
        out.radius = clamp(style.radius, 1, 100);
      }
      if (style.threeD !== undefined) {
        out.surfaceEnabled = style.threeD;
      }
      break;
    case 'hexagon':
    case 'grid':
      if (style.radius !== undefined) {
        out.worldUnitSize = clamp(style.radius, 0.05, 1000);
      }
      if (style.threeD !== undefined) {
        out.enable3d = style.threeD;
      }
      if (style.aggregation) {
        out.colorAggregation = style.aggregation;
        out.sizeAggregation = style.aggregation;
      }
      break;
    case 'cluster':
      if (style.radius !== undefined) {
        out.clusterRadius = clamp(style.radius, 1, 500);
      }
      if (style.aggregation) {
        out.colorAggregation = style.aggregation;
      }
      break;
  }
  return out;
}

/** The visual channel that `sizeBy` drives, per layer type. */
export function sizeChannel(type: string): { channel: string; field: string; scale: string } | null {
  switch (type) {
    case 'point':
      return { channel: 'size', field: 'sizeField', scale: 'sizeScale' };
    case 'hexagon':
    case 'grid':
      return { channel: 'size', field: 'sizeField', scale: 'sizeScale' };
    case 'heatmap':
      return { channel: 'weight', field: 'weightField', scale: 'weightScale' };
    default:
      return null;
  }
}

export function colorScaleFor(type: string, fieldType?: string): string {
  if (!isNumeric(fieldType) && type === 'point') {
    return 'ordinal';
  }
  return type === 'point' || type === 'cluster' ? 'quantize' : 'quantile';
}

/**
 * The saved-format layer for a request. `extentKm` (the data's bounding box
 * diagonal) sizes hexagons and grid cells when no radius is given, so a world
 * of quakes does not come out as 1 km cells nobody can see.
 */
export function buildLayerConfig(spec: LayerSpec, id: string, extentKm: number): Record<string, unknown> {
  const style: LayerStyle = { ...spec };
  if ((spec.type === 'hexagon' || spec.type === 'grid') && spec.radius === undefined) {
    style.radius = Number(clamp(extentKm / 60, 0.2, 500).toPrecision(2));
  }
  const visConfig: Record<string, unknown> = { opacity: 0.8, ...visConfigFor(spec.type, style) };
  if (spec.type === 'point' && visConfig.radius === undefined) {
    visConfig.radius = 6;
  }
  if (spec.type === 'heatmap' && visConfig.radius === undefined) {
    visConfig.radius = 30;
  }
  if ((spec.type === 'hexagon' || spec.type === 'grid') && spec.threeD) {
    visConfig.elevationScale = heightsFor(extentKm).elevationScale;
  }
  if (spec.type === 'heatmap' && spec.threeD) {
    visConfig.surfaceHeight = heightsFor(extentKm).surfaceHeight;
  }
  if (spec.colorBy && (spec.type === 'hexagon' || spec.type === 'grid' || spec.type === 'cluster') && !spec.aggregation) {
    visConfig.colorAggregation = isNumeric(spec.colorBy.type) ? 'average' : 'mode';
  }

  const visualChannels: Record<string, unknown> = {};
  if (spec.colorBy && spec.type !== 'heatmap') {
    visualChannels.colorField = { name: spec.colorBy.name, type: spec.colorBy.type };
    visualChannels.colorScale = colorScaleFor(spec.type, spec.colorBy.type);
  }
  const size = sizeChannel(spec.type);
  // A heatmap has no colour field: its colour is density, weighted by the column asked for.
  const sizeField = spec.sizeBy ?? (spec.type === 'heatmap' ? spec.colorBy : null);
  if (size && sizeField) {
    visualChannels[size.field] = { name: sizeField.name, type: sizeField.type };
    visualChannels[size.scale] = spec.type === 'point' ? 'sqrt' : 'linear';
  }

  return {
    id,
    type: spec.type,
    config: {
      dataId: spec.dataId,
      label: spec.label,
      columnMode: 'points',
      columns: { lat: spec.lat, lng: spec.lng },
      isVisible: true,
      visConfig,
    },
    visualChannels,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number(n)));
}
