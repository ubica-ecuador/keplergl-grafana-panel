import {
  BASE_MAP_COLOR_MODES,
  DEFAULT_LAYER_GROUPS,
  DEFAULT_MAPLIBRE_STYLES,
  DEFAULT_NO_BASEMAP_STYLE,
} from '@kepler.gl/constants';

import {
  CUSTOM_BASEMAP_ID,
  SATELLITE_BASEMAP_ID,
  SATELLITE_TERRAIN_BASEMAP_ID,
  TOPOGRAPHIC_TERRAIN_BASEMAP_ID,
} from './constants';
import { assetBaseUrl } from './keplerConfig';

export interface RegisteredMapStyle {
  id: string;
  label: string;
  url: string;
  icon?: string;
  layerGroups?: Array<(typeof DEFAULT_LAYER_GROUPS)[number]>;
  colorMode?: string;
}

/**
 * The two groups the satellite overlays answer to.
 *
 * kepler draws a switch for every group on the entry, so handing it the whole
 * of DEFAULT_LAYER_GROUPS would add five — Border, Building, Water, Land, 3d
 * Building — that match none of our layer ids and do nothing when clicked. The
 * filters come from kepler rather than being copied, so a rename upstream
 * surfaces as a test failure instead of an inert switch.
 */
const SATELLITE_LAYER_GROUPS = DEFAULT_LAYER_GROUPS.filter((group) => group.slug === 'label' || group.slug === 'road');

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
 * Thumbnails for kepler's own Carto entries, likewise real tiles.
 *
 * kepler names its thumbnails as paths under whatever `cdnUrl` the app
 * configures, and this plugin points that at its own assets so the vendored
 * effect thumbnails resolve — which left every base map thumbnail asking this
 * plugin for a `geodude/*.png` it does not ship, and answering 404. A raster
 * tile from the same service the style itself draws needs no vendoring, and
 * when it is unreachable so is the style it stands for.
 */
const CARTO_RASTER_ICONS: Record<string, string> = {
  'dark-matter': 'https://basemaps.cartocdn.com/dark_all/3/4/2.png',
  positron: 'https://basemaps.cartocdn.com/light_all/3/4/2.png',
  voyager: 'https://basemaps.cartocdn.com/rastertiles/voyager/3/4/2.png',
};

/**
 * "No Basemap" is an empty background, so its thumbnail is drawn rather than
 * fetched: an inline SVG needs no network at all, which is the honest picture
 * of a style that requests no tiles.
 */
const NO_BASEMAP_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#1a1a1a"/></svg>');

/**
 * Whether the panel replaces kepler's own list of base maps with this one.
 *
 * It does, and the reason is that five of kepler's nine defaults are Mapbox
 * styles — Satellite With Streets, Dark, Light, Muted Light, Muted Night — and
 * every one of them is a `mapbox://` URL that cannot load without an account.
 * Left in place they sit in the picker as choices that blank the map when
 * clicked. Replacing the list means re-registering the three that do work
 * without a token (Carto's), which {@link registeredMapStyles} does from
 * kepler's own definitions rather than by copying them.
 */
export const REPLACES_DEFAULT_MAP_STYLES = true;

/**
 * The map styles this panel offers.
 *
 * Four of them are the plugin's own documents, served from its assets: flat
 * satellite imagery, the same imagery over real elevation, a topographic map
 * over real elevation, and — once configured — a self-hosted `style.json`.
 * None needs an account. The relief pair carries a `terrain` key that MapLibre
 * reads straight from the style; kepler passes it through untouched, which is
 * the whole reason elevation is possible here at all.
 */
export function registeredMapStyles(customBasemapUrl?: string): RegisteredMapStyle[] {
  const styles: RegisteredMapStyle[] = [
    // Replacing kepler's list drops its "No Basemap" entry along with the
    // Mapbox ones, and that one earns its place: it is how a dashboard shows
    // data on a plain background, with no tiles fetched at all.
    { ...DEFAULT_NO_BASEMAP_STYLE, icon: NO_BASEMAP_ICON },
    // kepler's own Carto entries, verbatim apart from the thumbnail.
    ...DEFAULT_MAPLIBRE_STYLES.map((style) => ({
      ...style,
      icon: CARTO_RASTER_ICONS[style.id] ?? `${assetBaseUrl()}/${style.icon}`,
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
    styles.push({ id: CUSTOM_BASEMAP_ID, label: 'Custom', url: customBasemapUrl });
  }

  return styles;
}
