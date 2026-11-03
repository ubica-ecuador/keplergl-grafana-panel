import {
  colorManipulator,
  FieldColorModeId,
  fieldColorModeRegistry,
  type FieldConfigSource,
  type GrafanaTheme2,
  type ThresholdsConfig,
} from '@grafana/data';

import type { BasemapChoice, KeplerPanelOptions } from '../types';

/**
 * Converting a Geomap panel, step one: what can be read from its options alone.
 *
 * Grafana hands a panel its predecessor's options when the visualization is
 * changed (`setPanelChangeHandler`), but not its data. A kepler layer names its
 * columns, and Geomap's usual location mode is `auto`, which names none: the
 * columns are only known once the queries answer. So this step translates
 * everything that does not depend on the rows (colours, sizes, the view, the
 * base map) into a {@link GeomapImport} kept in the options, and
 * `geomapToKepler.ts` finishes the job on the first data the panel receives.
 *
 * Only Geomap's saved shape is read, never its code: the interfaces below are
 * the subset of its panel JSON this conversion uses.
 */

export const GEOMAP_PLUGIN_ID = 'geomap';

/** A Geomap dimension: a fixed value, or a field to read it from. */
interface GeomapDimension<T> {
  fixed?: T;
  field?: string;
  mode?: string;
  min?: number;
  max?: number;
}

interface GeomapStyle {
  color?: GeomapDimension<string>;
  opacity?: number;
  size?: GeomapDimension<number>;
  text?: GeomapDimension<string>;
  textConfig?: { fontSize?: number; offsetX?: number; offsetY?: number };
}

export interface GeomapLayer {
  type?: string;
  name?: string;
  opacity?: number;
  tooltip?: boolean;
  location?: { mode?: string; latitude?: string; longitude?: string; geohash?: string; wkt?: string };
  filterData?: { id?: string; options?: unknown };
  config?: {
    style?: GeomapStyle;
    weight?: GeomapDimension<number>;
    radius?: number;
    showLegend?: boolean;
    blur?: number;
    theme?: string;
    server?: string;
    url?: string;
  };
}

export interface GeomapOptions {
  basemap?: GeomapLayer;
  layers?: GeomapLayer[];
  view?: { id?: string; lat?: number; lon?: number; zoom?: number };
  tooltip?: { mode?: string };
}

/** How an imported layer finds its coordinates. */
export type ImportedLocation = { mode: 'auto' } | { mode: 'coords'; latitude: string; longitude: string };

/** A colour read from a field: kepler's range and scale, from the field's Grafana colour scheme. */
export interface ImportedColorField {
  name: string;
  colors: string[];
  /** kepler's `custom` scale: `[upper bound | null, hex]`, from Grafana thresholds. */
  colorMap?: Array<[number | null, string]>;
  scale: 'custom' | 'quantize' | 'ordinal';
}

export interface ImportedLayer {
  type: 'point' | 'heatmap';
  label: string;
  /** The query the layer reads; absent means the first one, as in Geomap. */
  refId?: string;
  location: ImportedLocation;
  color: [number, number, number];
  colorField?: ImportedColorField;
  opacity: number;
  /** Point radius in pixels, and the range a size field spreads over. */
  radius: number;
  radiusRange: [number, number];
  sizeField?: string;
  textField?: string;
  textSize?: number;
  textOffset?: [number, number];
  /** Whether Geomap showed the layer's legend. */
  legend?: boolean;
  /** Heatmap only, in pixels: OpenLayers' radius plus its blur. */
  heatRadius?: number;
  weightField?: string;
}

export interface GeomapImport {
  version: 1;
  layers: ImportedLayer[];
  /** The view to open on, in kepler's zoom; `fit` frames the data. */
  view: { latitude: number; longitude: number; zoom: number } | 'fit';
  tooltip: boolean;
  /** What did not carry over, in words for the person who switched. */
  dropped: string[];
}

/** Geomap's preset regions, as centre and zoom in OpenLayers' zoom. */
const REGIONS: Record<string, [number, number, number]> = {
  zero: [0, 0, 1],
  'north-america': [40, -100, 4],
  'south-america': [-20, -60, 3],
  europe: [46, 14, 4],
  africa: [0, 30, 3],
  'west-asia': [26, 53, 4],
  's-asia': [19.5, 80, 4],
  'se-asia': [10, 106, 4],
  'e-asia': [33, 120, 4],
  australia: [-25, 135, 4],
  oceania: [-10, -140, 3],
};

/**
 * OpenLayers counts zoom on 256-pixel tiles and MapLibre, which kepler draws
 * with, on 512-pixel ones: the same view is one level lower in kepler.
 */
const OPENLAYERS_TO_KEPLER_ZOOM = -1;

/** The radius OpenLayers' heatmap draws with is its radius plus its blur. */
const DEFAULT_HEAT_RADIUS = 5;
const DEFAULT_HEAT_BLUR = 15;

/** OpenLayers' heatmap gradient, which Geomap's heatmap keeps unless a weight field brings its own scheme. */
const OPENLAYERS_HEAT_GRADIENT = ['#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000'];

/** Geomap's marker defaults (its `defaultStyleConfig`). */
const DEFAULT_COLOR = 'dark-green';
const DEFAULT_OPACITY = 0.4;
const DEFAULT_SIZE = 5;
const DEFAULT_SIZE_RANGE: [number, number] = [2, 15];

/**
 * The panel change handler: Geomap's options in, Kepler's out.
 *
 * Anything that is not a Geomap keeps today's behaviour, starting from the
 * plugin's defaults.
 */
export function fromGeomapPanel(
  prevPluginId: string,
  prevOptions: Record<string, unknown> | undefined,
  prevFieldConfig: FieldConfigSource | undefined,
  theme: GrafanaTheme2
): Partial<KeplerPanelOptions> {
  if (prevPluginId !== GEOMAP_PLUGIN_ID || !prevOptions) {
    return {};
  }
  const geomap = prevOptions as GeomapOptions;
  const dropped: string[] = [];
  const basemap = convertBasemap(geomap.basemap, dropped);
  const layers: ImportedLayer[] = [];
  for (const layer of geomap.layers ?? []) {
    const imported = convertLayer(layer, prevFieldConfig, theme, dropped);
    if (imported) {
      layers.push(imported);
    }
  }
  return {
    ...basemap,
    // A Geomap tile shows the map and nothing else; kepler's side panel is a
    // click away in the map's own controls.
    showSidePanel: false,
    geomapImport: {
      version: 1,
      layers,
      view: convertView(geomap.view),
      tooltip: geomap.tooltip?.mode !== 'none',
      dropped,
    },
  };
}

function convertView(view: GeomapOptions['view']): GeomapImport['view'] {
  const id = view?.id ?? 'zero';
  if (id === 'fit') {
    return 'fit';
  }
  const region = REGIONS[id];
  const [lat, lon, zoom] = id === 'coords' || !region ? [view?.lat ?? 0, view?.lon ?? 0, view?.zoom ?? 1] : region;
  return {
    latitude: lat,
    longitude: lon,
    zoom: Math.max(0, (view?.zoom ?? zoom) + OPENLAYERS_TO_KEPLER_ZOOM),
  };
}

/** Geomap's Esri services, onto the closest base map the panel offers. */
const ESRI_BASEMAPS: Record<string, BasemapChoice> = {
  streets: 'openfreemap-liberty',
  'world-imagery': 'grafana-satellite',
  'world-physical': 'grafana-topographic-terrain',
  topo: 'grafana-topographic-terrain',
  'usa-topo': 'grafana-topographic-terrain',
  ocean: 'openfreemap-positron',
};

/**
 * Geomap's base map, onto the panel's. CARTO is not carried over as CARTO: its
 * tiles now want a key, which a Geomap never had to give, so it becomes the
 * OpenFreeMap style of the same tone.
 */
function convertBasemap(
  basemap: GeomapLayer | undefined,
  dropped: string[]
): Pick<KeplerPanelOptions, 'basemap' | 'customBasemapUrl'> {
  const type = basemap?.type ?? 'default';
  switch (type) {
    case 'default':
      return { basemap: 'auto' };
    case 'carto': {
      const tone = basemap?.config?.theme;
      return { basemap: tone === 'light' ? 'openfreemap-positron' : tone === 'dark' ? 'openfreemap-dark' : 'auto' };
    }
    case 'osm-standard':
      return { basemap: 'openfreemap-liberty' };
    case 'esri-xyz': {
      const choice = ESRI_BASEMAPS[basemap?.config?.server ?? 'streets'];
      if (choice) {
        return { basemap: choice };
      }
      dropped.push('the custom Esri MapServer base map (the map uses the theme’s base map)');
      return { basemap: 'auto' };
    }
    case 'maplibre':
      return basemap?.config?.url ? { basemap: 'custom', customBasemapUrl: basemap.config.url } : { basemap: 'auto' };
    default:
      dropped.push(`the ${type} base map (the map uses the theme’s base map)`);
      return { basemap: 'auto' };
  }
}

function convertLayer(
  layer: GeomapLayer,
  fieldConfig: FieldConfigSource | undefined,
  theme: GrafanaTheme2,
  dropped: string[]
): ImportedLayer | null {
  const label = layer.name || layer.type || 'Layer';
  if (layer.type !== 'markers' && layer.type !== 'heatmap') {
    dropped.push(`the ${layer.type ?? 'unknown'} layer “${label}”`);
    return null;
  }
  const location = convertLocation(layer.location);
  if (!location) {
    dropped.push(`“${label}”, located by ${layer.location?.mode} (only coordinates carry over)`);
    return null;
  }
  const refId = refIdOf(layer.filterData);
  const style = layer.config?.style ?? {};
  const opacity = (style.opacity ?? DEFAULT_OPACITY) * (layer.opacity ?? 1);
  const color = toRgb(theme.visualization.getColorByName(style.color?.fixed ?? DEFAULT_COLOR));
  const base = { label, ...(refId ? { refId } : {}), location, color, opacity };

  if (layer.type === 'heatmap') {
    const weightField = layer.config?.weight?.field;
    // Geomap's heat takes the weight field's scheme when it is a continuous
    // one, and OpenLayers' gradient otherwise.
    const scheme = weightField ? colorFieldOf(weightField, fieldConfig, theme) : undefined;
    const colors = scheme?.scale === 'quantize' ? scheme.colors : OPENLAYERS_HEAT_GRADIENT;
    return {
      ...base,
      type: 'heatmap',
      // OpenLayers' heat is drawn over a transparent black: the opacity of a
      // marker style means nothing to it, and kepler's own default reads alike.
      opacity: layer.opacity ?? 1,
      radius: DEFAULT_SIZE,
      radiusRange: DEFAULT_SIZE_RANGE,
      heatRadius: (layer.config?.radius ?? DEFAULT_HEAT_RADIUS) + (layer.config?.blur ?? DEFAULT_HEAT_BLUR),
      colorField: { name: weightField ?? '', colors, scale: 'quantize' },
      ...(weightField ? { weightField } : {}),
    };
  }

  const size = style.size ?? {};
  const colorFieldName = style.color?.field;
  const textField = style.text?.mode === 'field' || style.text?.field ? style.text?.field : undefined;
  return {
    ...base,
    type: 'point',
    legend: layer.config?.showLegend !== false,
    radius: size.fixed ?? DEFAULT_SIZE,
    radiusRange: [size.min ?? DEFAULT_SIZE_RANGE[0], size.max ?? DEFAULT_SIZE_RANGE[1]],
    ...(size.field ? { sizeField: size.field } : {}),
    ...(colorFieldName ? { colorField: colorFieldOf(colorFieldName, fieldConfig, theme) } : {}),
    ...(textField
      ? {
          textField,
          textSize: style.textConfig?.fontSize ?? 12,
          textOffset: [style.textConfig?.offsetX ?? 0, style.textConfig?.offsetY ?? 0] as [number, number],
        }
      : {}),
  };
}

function convertLocation(location: GeomapLayer['location']): ImportedLocation | null {
  const mode = location?.mode ?? 'auto';
  if (mode === 'auto') {
    return { mode: 'auto' };
  }
  if (mode === 'coords' && location?.latitude && location?.longitude) {
    return { mode: 'coords', latitude: location.latitude, longitude: location.longitude };
  }
  return null;
}

/** Geomap filters a layer's data with a frame matcher; only "by query" names one frame. */
function refIdOf(filterData: GeomapLayer['filterData']): string | undefined {
  return filterData?.id === 'byRefId' && typeof filterData.options === 'string' ? filterData.options : undefined;
}

/**
 * The colours a field's Grafana colour scheme gives, as kepler's range.
 *
 * Geomap colours by a field through the field's own colour settings: its
 * thresholds, a continuous scheme or a palette. An override on that field wins
 * over the defaults, as it does in Grafana.
 */
export function colorFieldOf(
  name: string,
  fieldConfig: FieldConfigSource | undefined,
  theme: GrafanaTheme2
): ImportedColorField {
  const settings = fieldSettings(name, fieldConfig);
  const mode = settings.color?.mode ?? FieldColorModeId.Thresholds;
  const toHex = (c: string) => colorManipulator.asHexString(theme.visualization.getColorByName(c));

  if (mode === FieldColorModeId.Thresholds) {
    const steps = settings.thresholds?.steps?.length
      ? settings.thresholds.steps
      : [
          { value: -Infinity, color: 'green' },
          { value: 80, color: 'red' },
        ];
    const colors = steps.map((s) => toHex(s.color));
    // A step's colour holds up to the next step's value; the last one has no end.
    const colorMap = steps.map((_, i): [number | null, string] => [
      i < steps.length - 1 ? (steps[i + 1].value as number) : null,
      colors[i],
    ]);
    return { name, colors, colorMap, scale: 'custom' };
  }

  if (mode === FieldColorModeId.Fixed && settings.color?.fixedColor) {
    return { name, colors: [toHex(settings.color.fixedColor)], scale: 'ordinal' };
  }

  const scheme = fieldColorModeRegistry.getIfExists(mode);
  const colors = (scheme?.getColors?.(theme) ?? []).map(toHex);
  if (!colors.length) {
    return { name, colors: OPENLAYERS_HEAT_GRADIENT, scale: 'quantize' };
  }
  return { name, colors, scale: scheme?.isContinuous ? 'quantize' : 'ordinal' };
}

interface ColorSettings {
  color?: { mode?: string; fixedColor?: string };
  thresholds?: ThresholdsConfig;
}

function fieldSettings(name: string, fieldConfig: FieldConfigSource | undefined): ColorSettings {
  const settings: ColorSettings = {
    color: fieldConfig?.defaults?.color,
    thresholds: fieldConfig?.defaults?.thresholds,
  };
  for (const override of fieldConfig?.overrides ?? []) {
    if (override.matcher?.id !== 'byName' || override.matcher.options !== name) {
      continue;
    }
    for (const property of override.properties ?? []) {
      if (property.id === 'color') {
        settings.color = property.value;
      } else if (property.id === 'thresholds') {
        settings.thresholds = property.value;
      }
    }
  }
  return settings;
}

function toRgb(color: string): [number, number, number] {
  const { values } = colorManipulator.decomposeColor(colorManipulator.asHexString(color));
  return [values[0], values[1], values[2]];
}
