import type { DefaultTheme } from 'vitepress';

/**
 * The sidebar under `/plus/`, the commercial edition's pages.
 *
 * Plus runs the free panel with every option under the same path, so these
 * pages document only what Plus adds and link back to the free pages for the
 * rest, the same way the free pages treat kepler.gl.
 */
export const PLUS_SIDEBAR: DefaultTheme.SidebarItem[] = [
  {
    text: 'Plus',
    items: [
      { text: 'Overview', link: '/plus/' },
      { text: 'What Plus adds', link: '/plus/start/what-plus-adds' },
      { text: 'Install and configure the app', link: '/plus/start/install' },
      { text: 'Move a dashboard to Plus', link: '/plus/start/upgrade-a-dashboard' },
      { text: 'Template dashboards', link: '/plus/start/templates' },
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
    ],
  },
  {
    text: 'Layers',
    collapsed: false,
    items: [
      { text: 'Plus layers', link: '/plus/layers/' },
      { text: 'Gauge', link: '/plus/layers/gauge' },
      { text: '3D Shape', link: '/plus/layers/shape-3d' },
      { text: 'Coverage and Coverage 3D', link: '/plus/layers/coverage' },
      { text: 'Surface', link: '/plus/layers/surface' },
      { text: 'Sparkline', link: '/plus/layers/sparkline' },
      { text: 'Traffic', link: '/plus/layers/traffic' },
      { text: 'Pipeline', link: '/plus/layers/pipeline' },
      { text: 'Fleet', link: '/plus/layers/fleet' },
    ],
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
