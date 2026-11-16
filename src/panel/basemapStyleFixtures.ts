import type { StyleLayer } from './layerGroups';

/**
 * Excerpts of real style documents, for the layer-group tests. Ids, types and
 * source layers as each provider published them on 2026-10-01.
 */
export const CARTO_DARK_MATTER_LAYERS: StyleLayer[] = [
  { id: 'background', type: 'background' },
  { id: 'landcover', type: 'fill', 'source-layer': 'landcover' },
  { id: 'water', type: 'fill', 'source-layer': 'water' },
  { id: 'boundary_country_inner', type: 'line', 'source-layer': 'boundary' },
  { id: 'road_pri_fill_noramp', type: 'line', 'source-layer': 'transportation' },
  { id: 'building', type: 'fill', 'source-layer': 'building' },
  { id: 'place_city_r6', type: 'symbol', 'source-layer': 'place' },
  { id: 'poi_stadium', type: 'symbol', 'source-layer': 'poi' },
  { id: 'poi_park', type: 'symbol', 'source-layer': 'poi' },
  { id: 'roadname_minor', type: 'symbol', 'source-layer': 'transportation_name' },
];

export const OPENFREEMAP_LIBERTY_LAYERS: StyleLayer[] = [
  { id: 'background', type: 'background' },
  { id: 'water', type: 'fill', 'source-layer': 'water' },
  { id: 'road_minor', type: 'line', 'source-layer': 'transportation' },
  { id: 'boundary_2', type: 'line', 'source-layer': 'boundary' },
  { id: 'building', type: 'fill', 'source-layer': 'building' },
  { id: 'building-3d', type: 'fill-extrusion', 'source-layer': 'building' },
  { id: 'poi_r1', type: 'symbol', 'source-layer': 'poi' },
  { id: 'poi_transit', type: 'symbol', 'source-layer': 'poi' },
  { id: 'label_city', type: 'symbol', 'source-layer': 'place' },
];

export const OPENFREEMAP_POSITRON_LAYERS: StyleLayer[] = [
  { id: 'background', type: 'background' },
  { id: 'water', type: 'fill', 'source-layer': 'water' },
  { id: 'highway_minor', type: 'line', 'source-layer': 'transportation' },
  { id: 'building', type: 'fill', 'source-layer': 'building' },
  { id: 'label_city', type: 'symbol', 'source-layer': 'place' },
];

/** A self-hosted document in the manner of MapTiler v4: ids in upper case. */
export const UPPER_CASE_LAYERS: StyleLayer[] = [
  { id: 'Background', type: 'background' },
  { id: 'Water', type: 'fill', 'source-layer': 'water' },
  { id: 'Road network', type: 'line', 'source-layer': 'transportation' },
  { id: 'Building', type: 'fill', 'source-layer': 'building' },
  { id: 'Station', type: 'symbol', 'source-layer': 'poi' },
  { id: 'Place labels', type: 'symbol', 'source-layer': 'place' },
];

/**
 * Open Waters' Seamap, as published on 2026-11-16: its own seamarks and sea
 * areas (`seamap`), the Seascape bathymetry (`seascape-*`), and a VersaTiles
 * Shortbread map for the land, with Mapterhorn's hillshade (`elevation`).
 */
export const OPENWATERS_SEAMAP_LAYERS: StyleLayer[] = [
  { id: 'background', type: 'background' },
  { id: 'depth-shading', type: 'color-relief', source: 'seascape-dem' },
  { id: 'depth-areas', type: 'fill', source: 'seascape-vector', 'source-layer': 'depare' },
  { id: 'contour-lines', type: 'line', source: 'seascape-vector', 'source-layer': 'contours' },
  { id: 'soundings', type: 'symbol', source: 'seascape-vector', 'source-layer': 'soundings' },
  { id: 'depth-hillshade', type: 'hillshade', source: 'seascape-dem' },
  { id: 'source-labels', type: 'symbol', source: 'seascape-coverage', 'source-layer': 'coverage' },
  { id: 'water-area', type: 'fill', source: 'versatiles-shortbread', 'source-layer': 'water_polygons' },
  { id: 'land-forest', type: 'fill', source: 'versatiles-shortbread', 'source-layer': 'land' },
  { id: 'hillshade', type: 'hillshade', source: 'elevation' },
  { id: 'street-primary', type: 'line', source: 'versatiles-shortbread', 'source-layer': 'streets' },
  { id: 'boundary-country', type: 'line', source: 'versatiles-shortbread', 'source-layer': 'boundaries' },
  { id: 'building', type: 'fill', source: 'versatiles-shortbread', 'source-layer': 'buildings' },
  { id: 'poi-amenity', type: 'symbol', source: 'versatiles-shortbread', 'source-layer': 'pois' },
  { id: 'label-place-city', type: 'symbol', source: 'versatiles-shortbread', 'source-layer': 'place_labels' },
  { id: 'land_area', type: 'fill', source: 'seamap', 'source-layer': 'land' },
  { id: 'sea-areas', type: 'symbol', source: 'seamap', 'source-layer': 'sea_area' },
  { id: 'ferry', type: 'line', source: 'seamap', 'source-layer': 'seamark' },
  { id: 'TSS-separation-boundary', type: 'line', source: 'seamap', 'source-layer': 'seamark' },
  { id: 'sector-arc', type: 'line', source: 'seamap', 'source-layer': 'light' },
  { id: 'lights', type: 'symbol', source: 'seamap', 'source-layer': 'seamark' },
  { id: 'buoys', type: 'symbol', source: 'seamap', 'source-layer': 'seamark' },
  { id: 'rocks', type: 'symbol', source: 'seamap', 'source-layer': 'seamark' },
];
