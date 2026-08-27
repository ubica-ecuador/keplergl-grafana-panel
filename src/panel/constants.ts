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
 * Raster tile server used when the panel option is left empty.
 *
 * Development Seed's public demo, which is also what kepler.gl itself falls
 * back to for a lone COG (`tileset-raster-form`'s `TITILER_BASE_URL`). The
 * point of a default that exists is that a freshly installed plugin draws a
 * public COG without being configured first; pointing it at this repository's
 * own docker-compose would leave everyone else with a silent blank map.
 *
 * Its limits are real and belong in the option's description, not only here:
 * it can only read imagery that is public, the url — signature and all — is
 * handed to a third party, and it is a demo endpoint with no guarantees.
 * Anything private needs a server of one's own.
 *
 * Here rather than in `keplerConfig` because `KeplerPanel` reads it, and that
 * module is deliberately free of kepler imports — pulling one in would drag
 * deck.gl and MapLibre into the main chunk and undo the code splitting.
 */
export const DEFAULT_RASTER_SERVER_URL = 'https://titiler.xyz';
