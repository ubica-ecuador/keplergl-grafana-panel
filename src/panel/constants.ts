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
