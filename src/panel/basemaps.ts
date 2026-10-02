import {
  BASE_MAP_COLOR_MODES,
  DEFAULT_MAPLIBRE_STYLES,
  DEFAULT_NO_BASEMAP_STYLE,
  NO_MAP_ID,
} from '@kepler.gl/constants';

import {
  CUSTOM_BASEMAP_ID,
  SATELLITE_BASEMAP_ID,
  SATELLITE_TERRAIN_BASEMAP_ID,
  TOPOGRAPHIC_TERRAIN_BASEMAP_ID,
} from './constants';
import { withCartoKey } from './cartoKey';
import { assetBaseUrl } from './keplerConfig';
import { SATELLITE_LAYER_GROUPS, STYLE_LAYER_GROUPS, type LayerGroup } from './layerGroups';

export interface RegisteredMapStyle {
  id: string;
  label: string;
  url: string;
  icon?: string;
  layerGroups?: LayerGroup[];
  colorMode?: string;
}

/**
 * Thumbnails for the style picker: real tiles from the services each style
 * draws.
 *
 * kepler renders them as `<img>`, so they fall under Grafana's `img-src`,
 * which is already open — unlike the tiles themselves, which maplibre fetches.
 */
const SATELLITE_ICON = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/4/2';
const TOPOGRAPHIC_ICON = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/3/4/2';

/**
 * A thumbnail shipped with the plugin (src/images/basemaps), rendered once from
 * the real style.
 *
 * kepler names its own thumbnails as paths under `cdnUrl`, which this plugin
 * points at its own assets, so they asked for a `geodude/*.png` it never
 * shipped. Raster tiles from CARTO stood in for a while, until CARTO began
 * watermarking them without a key; a file in the plugin carries no watermark
 * and needs no network for the picker to show it.
 */
const shippedIcon = (id: string) => `${assetBaseUrl()}/images/basemaps/${id}.png`;

/**
 * OpenFreeMap's styles: OpenMapTiles over OpenStreetMap, served with no key
 * and no account (https://openfreemap.org). The defaults since CARTO began
 * asking for a key — see `cartoKey.ts`. OpenFreeMap's "3D" is Liberty with the
 * camera tilted, which is the map's business in kepler, not the base map's;
 * Liberty's own extrusions carry the 3D Building switch.
 */
const OPENFREEMAP_STYLES = [
  { name: 'positron', label: 'Positron', colorMode: BASE_MAP_COLOR_MODES.LIGHT },
  { name: 'bright', label: 'Bright', colorMode: BASE_MAP_COLOR_MODES.LIGHT },
  { name: 'liberty', label: 'Liberty', colorMode: BASE_MAP_COLOR_MODES.LIGHT },
  { name: 'dark', label: 'Dark', colorMode: BASE_MAP_COLOR_MODES.DARK },
  { name: 'fiord', label: 'Fiord', colorMode: BASE_MAP_COLOR_MODES.DARK },
];

/** CARTO's entries, renamed so the picker says whose they are. */
const CARTO_LABELS: Record<string, string> = {
  'dark-matter': 'Dark Matter (CARTO)',
  positron: 'Positron (CARTO)',
  voyager: 'Voyager (CARTO)',
};

/**
 * "No Basemap" is an empty background, so its thumbnail is drawn rather than
 * fetched: an inline SVG needs no network at all, which is the honest picture
 * of a style that requests no tiles.
 */
const NO_BASEMAP_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#1a1a1a"/></svg>'
  );

/**
 * Whether the panel replaces kepler's own list of base maps with this one.
 *
 * It does, and the reason is that five of kepler's nine defaults are Mapbox
 * styles — Satellite With Streets, Dark, Light, Muted Light, Muted Night — and
 * every one of them is a `mapbox://` URL that cannot load without an account.
 * Left in place they sit in the picker as choices that blank the map when
 * clicked. Replacing the list means re-registering the three that do work
 * without a Mapbox token (CARTO's), which {@link registeredMapStyles} does from
 * kepler's own definitions rather than by copying them, next to OpenFreeMap's.
 */
export const REPLACES_DEFAULT_MAP_STYLES = true;

/**
 * The map styles this panel offers.
 *
 * OpenFreeMap's five come first and need nothing at all. CARTO's three keep
 * kepler's ids, so dashboards saved on them still open there, and take the
 * optional `cartoApiKey`; without one their tiles may carry a watermark. Four
 * more are the plugin's own documents, served from its assets: flat
 * satellite imagery, the same imagery over real elevation, a topographic map
 * over real elevation, and — once configured — a self-hosted `style.json`.
 * None needs an account. The relief pair carries a `terrain` key that MapLibre
 * reads straight from the style; kepler passes it through untouched, which is
 * the whole reason elevation is possible here at all.
 */
export function registeredMapStyles(customBasemapUrl?: string, cartoApiKey?: string): RegisteredMapStyle[] {
  const styles: RegisteredMapStyle[] = [
    // Replacing kepler's list drops its "No Basemap" entry along with the
    // Mapbox ones, and that one earns its place: it is how a dashboard shows
    // data on a plain background, with no tiles fetched at all.
    { ...DEFAULT_NO_BASEMAP_STYLE, icon: NO_BASEMAP_ICON },
    ...OPENFREEMAP_STYLES.map(({ name, label, colorMode }) => ({
      id: `openfreemap-${name}`,
      label: `${label} (OpenFreeMap)`,
      url: `https://tiles.openfreemap.org/styles/${name}`,
      icon: shippedIcon(`openfreemap-${name}`),
      layerGroups: STYLE_LAYER_GROUPS,
      colorMode,
    })),
    // kepler's own CARTO entries: their ids stay, so a dashboard saved on Dark
    // Matter opens on it, with or without a key. The switches' filters here
    // ignore case (layerGroups.ts).
    ...DEFAULT_MAPLIBRE_STYLES.map((style) => ({
      ...style,
      label: CARTO_LABELS[style.id] ?? style.label,
      url: cartoApiKey ? withCartoKey(style.url, cartoApiKey) : style.url,
      icon: shippedIcon(style.id),
      layerGroups: STYLE_LAYER_GROUPS,
    })),
    {
      id: SATELLITE_BASEMAP_ID,
      label: 'Satellite (Esri)',
      url: `${assetBaseUrl()}/basemaps/satellite.json`,
      icon: SATELLITE_ICON,
      layerGroups: SATELLITE_LAYER_GROUPS,
      // Imagery is neither a light nor a dark base map, so kepler should not
      // pick label colours as though it were either.
      colorMode: BASE_MAP_COLOR_MODES.NONE,
    },
    {
      id: SATELLITE_TERRAIN_BASEMAP_ID,
      label: 'Satellite + relief',
      url: `${assetBaseUrl()}/basemaps/satellite-terrain.json`,
      icon: SATELLITE_ICON,
      layerGroups: SATELLITE_LAYER_GROUPS,
      colorMode: BASE_MAP_COLOR_MODES.NONE,
    },
    {
      id: TOPOGRAPHIC_TERRAIN_BASEMAP_ID,
      label: 'Topographic + relief',
      url: `${assetBaseUrl()}/basemaps/topographic-terrain.json`,
      icon: TOPOGRAPHIC_ICON,
      // A single raster layer, so there is nothing for a layer-group switch to
      // hide — unlike the satellite style, whose roads and labels are their
      // own tile services.
      layerGroups: [],
      colorMode: BASE_MAP_COLOR_MODES.LIGHT,
    },
  ];

  if (customBasemapUrl) {
    styles.push({ id: CUSTOM_BASEMAP_ID, label: 'Custom', url: customBasemapUrl, layerGroups: STYLE_LAYER_GROUPS });
  }

  return styles;
}

/**
 * The base map the kepler store starts on: the one a saved map names, else the
 * one the panel option points at — whichever the panel offers — else No
 * Basemap. See `createKeplerStore` for why it matters.
 */
export function startingStyleType(
  savedStyleType: string | undefined,
  basemapId: string | null | undefined,
  styles: readonly RegisteredMapStyle[]
): string {
  const offered = (id: string | null | undefined): id is string => Boolean(id) && styles.some((s) => s.id === id);
  return [savedStyleType, basemapId].find(offered) ?? NO_MAP_ID;
}
