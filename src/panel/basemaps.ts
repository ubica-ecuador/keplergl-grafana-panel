import { BASE_MAP_COLOR_MODES, DEFAULT_LAYER_GROUPS } from '@kepler.gl/constants';

import { CUSTOM_BASEMAP_ID, SATELLITE_BASEMAP_ID } from './constants';
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
 * Thumbnail for the style picker: a real Esri tile over South America.
 *
 * kepler renders it as an `<img>`, so it falls under Grafana's `img-src`, which
 * is already open — unlike the tiles themselves, which maplibre fetches.
 */
const SATELLITE_ICON = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/4/2';

/**
 * The map styles this panel registers on top of the ones kepler ships.
 *
 * The satellite entry is always registered: it is the only imagery base map
 * here that does not need a Mapbox account. The self-hosted one is registered
 * only once a URL exists, which is what makes the panel usable in air-gapped
 * installs where the Carto base maps are unreachable.
 */
export function registeredMapStyles(customBasemapUrl?: string): RegisteredMapStyle[] {
  const styles: RegisteredMapStyle[] = [
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
  ];

  if (customBasemapUrl) {
    styles.push({ id: CUSTOM_BASEMAP_ID, label: 'Custom', url: customBasemapUrl });
  }

  return styles;
}
