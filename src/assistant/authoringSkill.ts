/**
 * A worked saved-map example for the authoring skill below. Exported so a test
 * can hold its structure to what the panel actually accepts: it must pass
 * `parseMapConfigJson`, its layer's `dataId` must follow `datasetId(refId)`,
 * and `visualChannels` must sit beside `config` — the one nesting mistake an
 * assistant makes even when told the path in prose.
 */
export const exampleMapConfig = {
  version: 'v1',
  config: {
    mapStyle: { styleType: 'openfreemap-dark' },
    mapState: { latitude: -2.9, longitude: -79.0, zoom: 11 },
    visState: {
      filters: [],
      layers: [
        {
          id: 'speed-points',
          type: 'point',
          config: {
            dataId: 'grafana-A',
            label: 'Speed',
            columns: { lat: 'latitude', lng: 'longitude' },
            isVisible: true,
            visConfig: {
              radius: 6,
              colorRange: {
                name: 'Custom',
                type: 'custom',
                category: 'Custom',
                colors: ['#2ecc71', '#f1c40f', '#e74c3c'],
              },
            },
          },
          visualChannels: { colorField: { name: 'kmh', type: 'real' }, colorScale: 'quantile' },
        },
      ],
    },
  },
};

/**
 * Schema knowledge for an assistant that writes or edits whole dashboards with
 * this panel — what `baseAssistantSkill` leaves out. It teaches only what an
 * assistant was observed to get wrong on its own: everything else (the panel's
 * option names, SQL, dashboard variables) it reads from the panel's own schema.
 */
export const dashboardAuthoringSkill = `# Authoring dashboards with the Kepler panel
The panel auto-detects query columns named latitude/longitude (or lat/lng), time, and a
track/trip id, and creates layers from them by itself — write a 'mapConfig' only to restyle
the map or add layers beyond the automatic ones.
'mapConfig' MUST be a kepler saved config with a top-level version key:
{"version":"v1","config":{"visState":…,"mapState":…,"mapStyle":…}}. Without "version" the
panel will silently ignore the whole mapConfig.
In a saved layer, 'visualChannels' is a SIBLING of 'config' — never inside it — while
'dataId', 'columns' and 'visConfig' live inside 'config'. Worked example (a point layer
coloured green→red by the 'kmh' column of query A):
${JSON.stringify(exampleMapConfig, null, 1)}
The panel applies 'mapConfig' when the dashboard loads; if a live edit does not show on the
open dashboard, reload the page once.
If the data is historical, save an absolute dashboard time range that covers it — a relative
range like now-6h shows an empty map.`;
