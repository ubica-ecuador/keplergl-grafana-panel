/**
 * Id under which a self-hosted `style.json` is registered with kepler.
 *
 * Kept in its own module rather than alongside the map component: importing a
 * constant from `KeplerMap` would pull kepler, deck.gl and MapLibre into the
 * main chunk and undo the code splitting.
 */
export const CUSTOM_BASEMAP_ID = 'grafana-custom-basemap';

/**
 * kepler.gl instance id. Actions are wrapped to this id so a panel only ever
 * talks to its own map, never to another panel's.
 */
export const KEPLER_INSTANCE_ID = 'grafana';

/**
 * Id under which the plugin's own satellite style is registered.
 *
 * Deliberately not `satellite`. kepler's mapbox-hosted satellite already claims
 * that id, and `_loadMapStyle` merges `[...custom, ...defaults]` into an object
 * keyed by id — the defaults are written last, so a collision would silently
 * hand the slot back to the style that cannot load without a Mapbox token.
 */
export const SATELLITE_BASEMAP_ID = 'grafana-satellite';

/**
 * Ids of the two styles that carry real relief.
 *
 * They are separate entries rather than a switch on the flat ones because the
 * elevation rides in the style document — MapLibre reads `terrain` from the
 * style it is handed — and kepler has no notion of terrain to toggle.
 */
export const SATELLITE_TERRAIN_BASEMAP_ID = 'grafana-satellite-terrain';
export const TOPOGRAPHIC_TERRAIN_BASEMAP_ID = 'grafana-topographic-terrain';

/**
 * Raster tile server used when the panel option is left empty: none.
 *
 * A COG, a STAC item or a Zarr store is drawn by a TiTiler-compatible server
 * that reads the imagery on the map's behalf, which means it is handed every
 * URL the queries return — a presigned link's signature included. That server
 * is a choice for whoever runs the Grafana, not one the plugin makes for them:
 * until 1.3.0 the default was Development Seed's public demo,
 * `https://titiler.xyz`, so a fresh install sent its raster URLs to a third
 * party without anyone having said so. Left empty, a query that needs a server
 * draws nothing and the panel says which query is waiting for one
 * (`RasterServerNotice`), naming the option to set. The demo still works when
 * typed into the option, for public imagery.
 *
 * What needs no server is unaffected: a `.pmtiles` archive, a WMS, an ArcGIS
 * Image Service.
 *
 * Two things worth knowing before debugging a tile that never arrives:
 *
 *  - Pasting a bare `.tif` into kepler's own Add Data → Tileset form ignores
 *    this setting entirely. kepler decides a URL is a COG from its pathname and
 *    hardcodes `titiler.xyz` for both metadata and tiles, with no form override.
 *    Workaround: paste the STAC URL instead — `<server>/cog/stac?url=<cog>`.
 *  - Grafana's strict CSP must allow the server's host under `connect-src`,
 *    not `img-src`. The tiles are NumPy arrays fetched over XHR, not images.
 *
 * Here rather than in `keplerConfig` because `KeplerPanel` reads it, and that
 * module is deliberately free of kepler imports — pulling one in would drag
 * deck.gl and MapLibre into the main chunk and undo the code splitting.
 */
export const DEFAULT_RASTER_SERVER_URL = '';

/** What the empty option shows: the shape of a value, not a server anyone runs. */
export const RASTER_SERVER_PLACEHOLDER = 'https://titiler.example.org';

/** The raster tile server a panel option names, or `''` when it names none. */
export function resolveRasterServerUrl(option: string | undefined): string {
  return (option || DEFAULT_RASTER_SERVER_URL).trim();
}

/** The same, as the list `framesToRasters` and kepler's `rasterServerUrls` take: empty when there is no server. */
export function rasterServerUrlsOf(option: string | undefined): string[] {
  const url = resolveRasterServerUrl(option);
  return url ? [url] : [];
}
