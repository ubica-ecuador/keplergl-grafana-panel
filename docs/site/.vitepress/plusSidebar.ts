import type { DefaultTheme } from 'vitepress';

/**
 * The sidebar under `/plus/`, the commercial edition's pages.
 *
 * Plus runs the free panel with every option under the same path, so these
 * pages document only what Plus adds and link back to the free pages for the
 * rest, the same way the free pages treat kepler.gl.
 */
/**
 * Plus's live dashboards: the `plus` folder of the public, read-only pacha
 * instance, so a dashboard joins the list by being saved in that folder.
 */
export const PLUS_DEMO_URL = 'https://pacha.ubica.dev/dashboards/f/plus/?orgId=1';

export const PLUS_SIDEBAR: DefaultTheme.SidebarItem[] = [
  {
    text: 'Plus',
    items: [
      { text: 'Live demos ↗', link: PLUS_DEMO_URL },
      { text: 'Overview', link: '/plus/' },
      { text: 'What Plus adds', link: '/plus/start/what-plus-adds' },
      { text: 'Install and configure the app', link: '/plus/start/install' },
      { text: 'Move a dashboard to Plus', link: '/plus/start/upgrade-a-dashboard' },
      { text: 'Template dashboard', link: '/plus/start/templates' },
    ],
  },
  {
    text: 'Getting data in',
    collapsed: false,
    items: [
      { text: 'Places without coordinates', link: '/plus/data/places' },
      { text: 'States, provinces and municipalities', link: '/plus/data/regions' },
      { text: 'Network links', link: '/plus/data/network-links' },
      { text: 'Active alerts and service health', link: '/plus/data/active-alerts' },
      { text: 'Geofence alerts', link: '/plus/data/geofences' },
      { text: "Data in a model's frame", link: '/plus/data/model-frame' },
    ],
  },
  {
    text: 'Layers',
    collapsed: false,
    items: [
      { text: 'Plus layers', link: '/plus/layers/' },
      { text: 'Cards on any layer', link: '/plus/layers/cards' },
      { text: 'Gauge', link: '/plus/layers/gauge' },
      { text: '3D Shape', link: '/plus/layers/shape-3d' },
      { text: 'Coverage and Coverage 3D', link: '/plus/layers/coverage' },
      { text: 'Surface', link: '/plus/layers/surface' },
      { text: 'Sparkline', link: '/plus/layers/sparkline' },
      { text: '3D Callout', link: '/plus/layers/callout' },
      { text: 'Traffic', link: '/plus/layers/traffic' },
      { text: 'Pipeline', link: '/plus/layers/pipeline' },
      { text: 'Fleet', link: '/plus/layers/fleet' },
      { text: '4D Model', link: '/plus/layers/model-4d' },
      { text: 'Floor plan', link: '/plus/indoor/plans#the-floor-plan-layer' },
    ],
  },
  {
    text: 'Indoor maps',
    collapsed: false,
    items: [
      { text: 'Floors', link: '/plus/indoor/' },
      { text: 'Floor plans and rooms', link: '/plus/indoor/plans' },
      { text: 'Buildings and sites', link: '/plus/indoor/buildings' },
      { text: 'Indoor tab and settings', link: '/plus/indoor/settings' },
    ],
  },
  {
    text: 'Time',
    collapsed: false,
    items: [{ text: 'Time Brush panel', link: '/plus/time-brush' }],
  },
  {
    text: 'Base maps and 3D',
    collapsed: false,
    items: [
      { text: 'Base maps', link: '/plus/maps/basemaps' },
      { text: '3D tiles', link: '/plus/maps/3d-tiles' },
    ],
  },
  {
    text: 'Grafana Assistant',
    items: [{ text: 'Grafana Assistant', link: '/plus/assistant' }],
  },
  {
    text: 'Administration',
    collapsed: false,
    items: [
      { text: 'Keys and who can read them', link: '/plus/admin/keys' },
      { text: 'Content Security Policy', link: '/plus/admin/csp' },
      { text: 'Privacy', link: '/plus/admin/privacy' },
      { text: 'Versions', link: '/plus/admin/versions' },
      { text: 'Support', link: '/plus/support' },
      { text: 'Licence and terms', link: '/plus/legal' },
      { text: 'Privacy policy', link: '/plus/privacy-policy' },
    ],
  },
  {
    text: 'Free panel',
    items: [{ text: 'Everything the free panel does ↩', link: '/guide/what-it-is' }],
  },
];
