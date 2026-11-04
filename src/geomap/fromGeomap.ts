import {
  colorManipulator,
  FieldColorModeId,
  fieldColorModeRegistry,
  type FieldConfigSource,
  type GrafanaTheme2,
  type ThresholdsConfig,
} from '@grafana/data';

import type { KeplerPanelOptions } from '../types';
import { type GeomapRule, type RuleColors, rulesToColors } from './geojsonRules';
import { ESRI_SERVICES, esriTileTemplate } from '../data/xyzTiles';
import { GAZETTEERS } from '../data/placeLookup';

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
  /** A route's stroke when nothing varies; Geomap then draws it at `size.fixed` anyway. */
  lineWidth?: number;
  size?: GeomapDimension<number>;
  text?: GeomapDimension<string>;
  textConfig?: { fontSize?: number; offsetX?: number; offsetY?: number };
}

export interface GeomapLayer {
  type?: string;
  name?: string;
  opacity?: number;
  tooltip?: boolean;
  location?: {
    mode?: string;
    latitude?: string;
    longitude?: string;
    geohash?: string;
    wkt?: string;
    lookup?: string;
    gazetteer?: string;
  };
  filterData?: { id?: string; options?: unknown };
  config?: {
    style?: GeomapStyle;
    weight?: GeomapDimension<number>;
    /** Network only: how the edges are drawn; `style` is the nodes'. */
    edgeStyle?: GeomapStyle;
    radius?: number;
    showLegend?: boolean;
    /** Route only: an arrow at each segment's end (1), at its start (-1), or none (0). */
    arrow?: number;
    blur?: number;
    theme?: string;
    server?: string;
    url?: string;
    /** Photos only: the picture column, its shape, radius, frame width and colour. */
    kind?: string;
    border?: number;
    color?: string;
    /** XYZ only: the zoom range the server answers. */
    minZoom?: number;
    maxZoom?: number;
    /** Night / Day only: the moment shown, the sun, and the night's colour. */
    show?: string;
    sun?: boolean;
    nightColor?: string;
    /** GeoJSON only: the file, and the style rules checked feature by feature. */
    src?: string;
    rules?: Array<{ style?: GeomapStyle; check?: GeomapRule['check'] }>;
  };
}

export interface GeomapOptions {
  basemap?: GeomapLayer;
  layers?: GeomapLayer[];
  view?: { id?: string; lat?: number; lon?: number; zoom?: number };
  tooltip?: { mode?: string };
}

/** How an imported layer finds its coordinates. */
export type ImportedLocation =
  | { mode: 'auto' }
  | { mode: 'coords'; latitude: string; longitude: string }
  /** A column of geohashes, or of place names looked up in the panel's gazetteer; absent, the panel's detection finds it. */
  | { mode: 'geohash'; geohash?: string }
  | { mode: 'lookup'; lookup?: string };

/** A colour read from a field: kepler's range and scale, from the field's Grafana colour scheme. */
export interface ImportedColorField {
  name: string;
  colors: string[];
  /** kepler's `custom` scale: `[upper bound | null, hex]`, from Grafana thresholds. */
  colorMap?: Array<[number | null, string]>;
  scale: 'custom' | 'quantize' | 'ordinal';
}

export interface ImportedLayer {
  type: 'point' | 'heatmap' | 'route' | 'geojson' | 'dayNight' | 'xyz' | 'photos';
  label: string;
  /** The query the layer reads; absent means the first one, as in Geomap. */
  refId?: string;
  /** A network's part: its nodes or its edges, found by Grafana's node graph shape rather than by query. */
  graph?: 'nodes' | 'edges';
  location: ImportedLocation;
  color: [number, number, number];
  colorField?: ImportedColorField;
  opacity: number;
  /** Point radius (a route's width) in pixels, and the range a size field spreads over. */
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
  /** Route only: which end of each segment carries an arrow. */
  arrow?: 'end' | 'start';
  /** GeoJSON only: the file as Geomap names it (relative to Grafana for its own maps). */
  src?: string;
  /** GeoJSON only: the outline width, in pixels. */
  lineWidth?: number;
  /** GeoJSON only: the style rules, as one colour channel on a feature property. */
  ruleColors?: RuleColors;
  /** Night / Day only: whether the sun is drawn. */
  sun?: boolean;
  /** Photos only: the column of picture addresses (Geomap's first text column when absent), the frame's shape and width. */
  photoField?: string;
  photoKind?: 'square' | 'circle';
  photoBorder?: number;
  /** XYZ only: the tile template and the zoom range it answers. */
  tileUrl?: string;
  minZoom?: number;
  maxZoom?: number;
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
  const layers: ImportedLayer[] = [];
  const basemap = convertBasemap(geomap.basemap, dropped, layers);
  let dayNight: Pick<KeplerPanelOptions, 'dayNight' | 'dayNightSun'> = {};
  // The panel looks place names up in one gazetteer: the first layer's that names one.
  const gazetteers = (geomap.layers ?? [])
    .filter((layer) => layer.location?.mode === 'lookup')
    .map((layer) => portableGazetteer(layer.location?.gazetteer));
  if (new Set(gazetteers).size > 1) {
    dropped.push(`place names from ${gazetteers.slice(1).join(', ')} (one gazetteer per panel: ${gazetteers[0]})`);
  }
  for (const layer of geomap.layers ?? []) {
    if (layer.type === 'dayNight') {
      const night = convertDayNight(layer, theme);
      dayNight = { dayNight: layer.config?.show === 'from' ? 'from' : 'to', dayNightSun: Boolean(night.sun) };
      layers.push(night);
      continue;
    }
    if (layer.type === 'network') {
      layers.push(...convertNetwork(layer, prevFieldConfig, theme, dropped));
      continue;
    }
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
    // Geomap draws every row its queries return; the dashboard's range reaches
    // it only through the queries. Coupling the map's clock is a choice to make
    // afterwards, not a change the switch should bring.
    timeSync: 'off',
    ...dayNight,
    ...(gazetteers.length ? { gazetteer: gazetteers[0] } : {}),
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

/**
 * Geomap's base map, onto the panel's. CARTO is not carried over as CARTO: its
 * tiles now want a key, which a Geomap never had to give, so it becomes the
 * OpenFreeMap style of the same tone.
 */
function convertBasemap(
  basemap: GeomapLayer | undefined,
  dropped: string[],
  tiles: ImportedLayer[]
): Pick<KeplerPanelOptions, 'basemap' | 'customBasemapUrl'> {
  const type = basemap?.type ?? 'default';
  // A tiled base map that the panel offers no style for is drawn as tiles at
  // the bottom of the map, over the theme's base map.
  if (type === 'xyz' || (type === 'esri-xyz' && (basemap?.config?.server ?? 'streets') !== 'world-imagery')) {
    const tile = basemap ? convertXyz(basemap, 'Base map') : null;
    if (tile) {
      tiles.push(tile);
    } else {
      dropped.push(`the ${type} base map, which names no tile server`);
    }
    return { basemap: 'auto' };
  }
  switch (type) {
    case 'default':
      return { basemap: 'auto' };
    case 'carto': {
      const tone = basemap?.config?.theme;
      return { basemap: tone === 'light' ? 'openfreemap-positron' : tone === 'dark' ? 'openfreemap-dark' : 'auto' };
    }
    case 'osm-standard':
      return { basemap: 'openfreemap-liberty' };
    case 'esri-xyz':
      // World Imagery: the panel's satellite base map is that imagery.
      return { basemap: 'grafana-satellite' };
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
  if (layer.type === 'geojson') {
    return convertGeojson(layer, label, theme, dropped);
  }
  if (layer.type === 'xyz' || layer.type === 'esri-xyz') {
    const tile = convertXyz(layer, label);
    if (!tile) {
      dropped.push(`the ${layer.type} layer “${label}”, which names no tile server`);
    }
    return tile;
  }
  if (layer.type !== 'markers' && layer.type !== 'heatmap' && layer.type !== 'route' && layer.type !== 'photos') {
    dropped.push(`the ${layer.type ?? 'unknown'} layer “${label}”`);
    return null;
  }
  const location = convertLocation(layer.location);
  if (!location) {
    dropped.push(`“${label}”, located by ${layer.location?.mode}`);
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

  if (layer.type === 'photos') {
    const config = layer.config ?? {};
    const kind = config.kind ?? 'square';
    if (kind !== 'square' && kind !== 'circle') {
      dropped.push(`the ${kind} shape of “${label}” (drawn square)`);
    }
    return {
      ...base,
      type: 'photos',
      opacity: layer.opacity ?? 1,
      // Geomap's radius is half the picture's side.
      radius: 2 * (config.radius ?? DEFAULT_PHOTO_RADIUS),
      radiusRange: DEFAULT_SIZE_RANGE,
      color: toRgb(theme.visualization.getColorByName(config.color ?? DEFAULT_PHOTO_FRAME)),
      ...(config.src ? { photoField: config.src } : {}),
      photoKind: kind === 'circle' ? 'circle' : 'square',
      photoBorder: config.border ?? 2,
    };
  }

  const size = style.size ?? {};
  const colorFieldName = style.color?.field;
  const colorField = colorFieldName ? { colorField: colorFieldOf(colorFieldName, fieldConfig, theme) } : {};

  if (layer.type === 'route') {
    const arrow = layer.config?.arrow;
    return {
      ...base,
      type: 'route',
      // A route is drawn at full strength unless its style says otherwise.
      opacity: (style.opacity ?? 1) * (layer.opacity ?? 1),
      legend: false,
      radius: size.fixed ?? DEFAULT_SIZE,
      radiusRange: [size.min ?? DEFAULT_SIZE_RANGE[0], size.max ?? DEFAULT_SIZE_RANGE[1]],
      ...(size.field ? { sizeField: size.field } : {}),
      ...colorField,
      ...(arrow === 1 ? { arrow: 'end' as const } : arrow === -1 ? { arrow: 'start' as const } : {}),
    };
  }

  const textField = style.text?.mode === 'field' || style.text?.field ? style.text?.field : undefined;
  return {
    ...base,
    type: 'point',
    legend: layer.config?.showLegend !== false,
    radius: size.fixed ?? DEFAULT_SIZE,
    radiusRange: [size.min ?? DEFAULT_SIZE_RANGE[0], size.max ?? DEFAULT_SIZE_RANGE[1]],
    ...(size.field ? { sizeField: size.field } : {}),
    ...colorField,
    ...(textField
      ? {
          textField,
          textSize: style.textConfig?.fontSize ?? 12,
          textOffset: [style.textConfig?.offsetX ?? 0, style.textConfig?.offsetY ?? 0] as [number, number],
        }
      : {}),
  };
}

/** Geomap's photo defaults. */
const DEFAULT_PHOTO_RADIUS = 20;
const DEFAULT_PHOTO_FRAME = 'rgb(200, 200, 200)';

/** Geomap's default GeoJSON file, Grafana's own world countries. */
const DEFAULT_GEOJSON_SRC = 'public/maps/countries.geojson';

function convertGeojson(layer: GeomapLayer, label: string, theme: GrafanaTheme2, dropped: string[]): ImportedLayer {
  const style = layer.config?.style ?? {};
  const toHex = (c: string) => colorManipulator.asHexString(theme.visualization.getColorByName(c));
  const defaultColor = toHex(style.color?.fixed ?? DEFAULT_COLOR);
  const rules = (layer.config?.rules ?? []).map((r) => ({
    check: r.check,
    color: toHex(r.style?.color?.fixed ?? style.color?.fixed ?? DEFAULT_COLOR),
  }));
  const ruleColors = rules.length ? rulesToColors(rules, defaultColor) : null;
  if (rules.length && !ruleColors) {
    dropped.push(
      `the style rules of “${label}” (kept only when they all check one property, all equal or all compare)`
    );
  }
  if (style.color?.field) {
    dropped.push(`the colour by field of “${label}” (a GeoJSON file has no query field)`);
  }
  return {
    type: 'geojson',
    label,
    location: { mode: 'auto' },
    src: layer.config?.src || DEFAULT_GEOJSON_SRC,
    color: toRgb(defaultColor),
    opacity: (style.opacity ?? DEFAULT_OPACITY) * (layer.opacity ?? 1),
    lineWidth: style.lineWidth ?? 1,
    radius: style.size?.fixed ?? DEFAULT_SIZE,
    radiusRange: DEFAULT_SIZE_RANGE,
    ...(ruleColors ? { ruleColors } : {}),
  };
}

/**
 * A Geomap network: its nodes as markers and its edges as a route's segments,
 * each on its part of the node graph (`buildNetwork.ts` places the edges).
 * Geomap draws the nodes over the edges.
 */
function convertNetwork(
  layer: GeomapLayer,
  fieldConfig: FieldConfigSource | undefined,
  theme: GrafanaTheme2,
  dropped: string[]
): ImportedLayer[] {
  const label = layer.name || 'Network';
  const { edgeStyle, style, showLegend, arrow } = layer.config ?? {};
  const edges = convertLayer(
    { ...layer, type: 'route', name: `${label} · edges`, filterData: undefined, config: { style: edgeStyle, arrow } },
    fieldConfig,
    theme,
    dropped
  );
  const nodes = convertLayer(
    { ...layer, type: 'markers', name: `${label} · nodes`, filterData: undefined, config: { style, showLegend } },
    fieldConfig,
    theme,
    dropped
  );
  if (arrow === 2) {
    dropped.push(`the arrows at both ends of “${label}” (kepler draws them at the target only)`);
  }
  return [
    ...(edges ? [{ ...edges, graph: 'edges' as const, ...(arrow === 2 ? { arrow: 'end' as const } : {}) }] : []),
    ...(nodes ? [{ ...nodes, graph: 'nodes' as const }] : []),
  ];
}

/** Geomap's night, `#a7a6ba4D`: a grey at 30 %. */
const DEFAULT_NIGHT_COLOR = '#a7a6ba4D';

/**
 * Geomap's Night / Day layer, drawn by the panel's own night shading
 * (`dayNight.ts`): this keeps its colour, its opacity and its sun.
 */
function convertDayNight(layer: GeomapLayer, theme: GrafanaTheme2): ImportedLayer {
  const night = layer.config?.nightColor ?? DEFAULT_NIGHT_COLOR;
  const { color, alpha } = rgba(theme.visualization.getColorByName(night));
  return {
    type: 'dayNight',
    label: layer.name || 'Night',
    location: { mode: 'auto' },
    color,
    opacity: alpha * (layer.opacity ?? 1),
    radius: DEFAULT_SIZE,
    radiusRange: DEFAULT_SIZE_RANGE,
    sun: Boolean(layer.config?.sun),
  };
}

/** A colour and its alpha, from any CSS form Grafana hands back, `#rrggbbaa` included. */
function rgba(color: string): { color: [number, number, number]; alpha: number } {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(color);
  if (hex) {
    return { color: toRgb(`#${hex[1]}`), alpha: parseInt(hex[2], 16) / 255 };
  }
  const { values } = colorManipulator.decomposeColor(
    color.startsWith('#') ? color : colorManipulator.asHexString(color)
  );
  return { color: toRgb(color), alpha: values.length > 3 ? values[3] : 1 };
}

/**
 * An XYZ or Esri tile layer, as the panel's `{z}/{x}/{y}` tiles. Esri's named
 * services are its public MapServer caches; a custom one gives its own url.
 */
function convertXyz(layer: GeomapLayer, label: string): ImportedLayer | null {
  const config = layer.config ?? {};
  const server = config.server ?? 'streets';
  const url =
    layer.type === 'esri-xyz' && server !== 'custom'
      ? ESRI_SERVICES[server] && esriTileTemplate(ESRI_SERVICES[server])
      : config.url;
  if (!url) {
    return null;
  }
  return {
    type: 'xyz',
    label,
    location: { mode: 'auto' },
    color: [0, 0, 0],
    opacity: layer.opacity ?? 1,
    radius: DEFAULT_SIZE,
    radiusRange: DEFAULT_SIZE_RANGE,
    tileUrl: url,
    ...(typeof config.minZoom === 'number' ? { minZoom: config.minZoom } : {}),
    ...(typeof config.maxZoom === 'number' ? { maxZoom: config.maxZoom } : {}),
  };
}

/**
 * Geomap's gazetteer path, written so it works on any Grafana: its countries
 * default carries the build prefix of the Grafana it was saved on, while the
 * same three files are also served from `public/gazetteer/`.
 */
function portableGazetteer(path: string | undefined): string {
  if (!path) {
    return GAZETTEERS.countries;
  }
  const own = Object.values(GAZETTEERS).find((g) => path.endsWith(g.slice(g.indexOf('gazetteer/'))));
  return own ?? path;
}

function convertLocation(location: GeomapLayer['location']): ImportedLocation | null {
  const mode = location?.mode ?? 'auto';
  if (mode === 'auto') {
    return { mode: 'auto' };
  }
  if (mode === 'coords' && location?.latitude && location?.longitude) {
    return { mode: 'coords', latitude: location.latitude, longitude: location.longitude };
  }
  if (mode === 'geohash') {
    return { mode: 'geohash', ...(location?.geohash ? { geohash: location.geohash } : {}) };
  }
  if (mode === 'lookup') {
    return { mode: 'lookup', ...(location?.lookup ? { lookup: location.lookup } : {}) };
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
