import { defineConfig } from 'vitepress';

/**
 * The versions this documentation is written against.
 *
 * They are surfaced on the page rather than kept here as a comment because
 * upstream is, in places, *behind* what this plugin ships: kepler.gl's public
 * documentation covers the 3.2 stable line and lists fifteen layer types, while
 * the plugin pins a 3.3.0 pre-release that registers nineteen — the Flow layer
 * among them. A reader following an outbound link needs to know which version
 * the sentence that sent them there was true of.
 */
export const VERSIONS = {
  kepler: '3.3.0-alpha.7',
  deck: '9.3.10',
  maplibre: '4',
};

/**
 * GitHub Pages serves a project site under `/<repo>/`, so every asset URL
 * carries that prefix. Taken from the environment rather than hardcoded, so
 * renaming the repository does not silently break every image on the site —
 * the workflow passes `github.event.repository.name`.
 */
const base = process.env.DOCS_BASE ?? '/keplergl-grafana-panel/';

export default defineConfig({
  base,
  lang: 'en-GB',
  title: 'Kepler Geospatial Maps',
  description:
    'Spatio-temporal maps for Grafana dashboards — trajectories, origin-destination flows and velocity fields from any data source. Runs kepler.gl inside the panel: no external service, no account, no Mapbox token.',
  // Broken internal links fail the build. Outbound links are checked separately
  // by `docs:linkcheck`, which does not block: a third party's outage must not
  // stop us publishing.
  ignoreDeadLinks: false,
  lastUpdated: true,
  // Notes for whoever maintains the site, not a page of it.
  srcExclude: ['README.md'],
  head: [['link', { rel: 'icon', href: `${base}logo.svg` }]],

  themeConfig: {
    logo: '/logo.svg',

    // MiniSearch, bundled with VitePress. No Algolia and no outbound request,
    // which is the same premise the plugin itself is built on.
    search: { provider: 'local' },

    nav: [
      { text: 'Guide', link: '/guide/what-it-is' },
      { text: 'Tutorials', link: '/tutorials/' },
      { text: 'Layer gallery', link: '/layers/' },
      { text: 'Reference', link: '/reference/panel-options' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What it is', link: '/guide/what-it-is' },
          { text: 'Install', link: '/guide/install' },
          { text: 'Quickstart', link: '/guide/quickstart' },
          { text: 'Migrating from the Foursquare panel', link: '/guide/migrating-from-the-foursquare-panel' },
        ],
      },
      {
        text: 'Getting data in',
        collapsed: false,
        items: [
          { text: 'How a query becomes a map', link: '/guide/data/how-a-query-becomes-a-map' },
          { text: 'Points', link: '/guide/data/points' },
          { text: 'Geometry', link: '/guide/data/geometry' },
          { text: 'Trajectories', link: '/guide/data/trajectories' },
          { text: 'Origin–destination flows', link: '/guide/data/flows' },
          { text: 'H3 and S2', link: '/guide/data/h3-and-s2' },
          { text: 'Velocity fields', link: '/guide/data/velocity-fields' },
          { text: 'Rasters', link: '/guide/data/rasters' },
          { text: 'WMS services', link: '/guide/data/wms' },
          { text: 'Zarr stores', link: '/guide/data/zarr' },
          { text: 'Imagery over time', link: '/guide/data/imagery-over-time' },
        ],
      },
      {
        text: 'The map',
        collapsed: false,
        items: [
          { text: 'Base maps and relief', link: '/guide/map/basemaps-and-relief' },
          { text: 'Theme', link: '/guide/map/theme' },
          { text: 'Map configuration', link: '/guide/map/map-configuration' },
        ],
      },
      {
        text: "Using kepler's own panel",
        collapsed: true,
        items: [
          { text: 'Layers and attributes', link: '/guide/kepler/layers-and-attributes' },
          { text: 'Colour palettes and scales', link: '/guide/kepler/colour-palettes-and-scales' },
          { text: 'Filters', link: '/guide/kepler/filters' },
          { text: 'Interactions', link: '/guide/kepler/interactions' },
          { text: 'Map settings', link: '/guide/kepler/map-settings' },
          { text: 'Time playback', link: '/guide/kepler/time-playback' },
          { text: 'Effects', link: '/guide/kepler/effects' },
        ],
      },
      {
        text: 'Dashboard integration',
        collapsed: false,
        items: [
          { text: 'Time range sync', link: '/guide/dashboard/time-range-sync' },
          { text: 'Time window variables', link: '/guide/dashboard/time-window-variables' },
          { text: 'Peer time sync', link: '/guide/dashboard/peer-time-sync' },
          { text: 'Cross-filtering', link: '/guide/dashboard/cross-filtering' },
          { text: 'Publishing viewport and areas', link: '/guide/dashboard/publishing' },
        ],
      },
      {
        text: 'Data source recipes',
        collapsed: true,
        items: [
          { text: 'PostGIS', link: '/guide/sources/postgis' },
          { text: 'DuckDB — parquet, CSV, GeoJSON', link: '/guide/sources/duckdb-geoparquet' },
          { text: 'Infinity — GeoJSON, CSV, WFS', link: '/guide/sources/infinity' },
          { text: 'Any other SQL source', link: '/guide/sources/other-sql' },
          { text: 'Measuring imagery', link: '/guide/sources/measuring-imagery' },
        ],
      },
      {
        text: 'Layer gallery',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/layers/' },
          { text: 'Points and aggregation', link: '/layers/points-and-aggregation' },
          { text: 'Geometry and spatial indices', link: '/layers/geometry-and-indices' },
          { text: 'Origin–destination', link: '/layers/origin-destination' },
          { text: 'Time', link: '/layers/time' },
          { text: 'Layers configured with a URL', link: '/layers/url-configured' },
        ],
      },
      {
        text: 'Tutorials',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/tutorials/' },
          { text: '1 — Your first map', link: '/tutorials/first-map' },
          { text: '2 — Animate trajectories', link: '/tutorials/trajectories' },
          { text: '3 — An OD flow map', link: '/tutorials/od-flows' },
          { text: '4 — A cross-filtered dashboard', link: '/tutorials/cross-filtered-dashboard' },
          { text: '5 — Click the map, query a radius', link: '/tutorials/click-to-query' },
          { text: '6 — A wind field', link: '/tutorials/wind-field' },
          { text: '7 — Imagery over time', link: '/tutorials/imagery-over-time' },
        ],
      },
      {
        text: 'Reference',
        collapsed: false,
        items: [
          { text: 'Panel options', link: '/reference/panel-options' },
          { text: 'Field roles', link: '/reference/field-roles' },
          { text: 'Variable formats', link: '/reference/variable-formats' },
          { text: 'Differences from stock kepler.gl', link: '/reference/differences-from-kepler' },
          { text: 'Under the hood — deck.gl', link: '/reference/under-the-hood' },
          { text: 'Upstream documentation', link: '/reference/upstream-docs' },
          { text: 'Troubleshooting', link: '/reference/troubleshooting' },
          { text: 'Compatibility', link: '/reference/compatibility' },
        ],
      },
      {
        text: 'Contributing',
        items: [{ text: 'Developing the plugin', link: '/contributing' }],
      },
    ],

    footer: {
      message:
        'Apache-2.0. Bundles <a href="https://github.com/keplergl/kepler.gl">kepler.gl</a> (MIT) and <a href="https://github.com/visgl/flowmap.gl">flowmap.gl</a> (Apache-2.0).',
      copyright: 'Not affiliated with Foursquare. kepler.gl is a Foursquare open-source project.',
    },
  },
});
