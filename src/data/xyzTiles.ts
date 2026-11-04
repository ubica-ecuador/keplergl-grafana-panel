import type { SavedRemoteDataset } from './mapConfig';

/**
 * Raster tiles addressed by a `{z}/{x}/{y}` template: OpenStreetMap-style
 * servers, ArcGIS MapServer caches, weather radar, anything Geomap's XYZ layer
 * draws.
 *
 * kepler draws raster tiles only from PMTiles and STAC; this is the plain web
 * map tile scheme. The dataset holds no rows, only the template, and the
 * panel's `xyzTileLayer.ts` draws it.
 */

/** The dataset type the panel uses for a tile template. */
export const XYZ_TILE_TYPE = 'xyz-tiles';

/** What an XYZ dataset carries. */
export interface XyzTileMetadata {
  /** The template, with `{z}`, `{x}`, `{y}`; `{-y}` and `{s}` / `{a-c}` too. */
  url: string;
  minZoom?: number;
  maxZoom?: number;
}

/** The tile's address. `{-y}` counts rows from the south (TMS); `{s}` and `{a-c}` pick the first subdomain. */
export function xyzTileUrl(template: string, { x, y, z }: { x: number; y: number; z: number }): string {
  return template
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{-y\}/g, String(2 ** z - 1 - y))
    .replace(/\{y\}/g, String(y))
    .replace(/\{s\}/g, 'a')
    .replace(/\{([a-z])-[a-z]\}/g, '$1');
}

/** A tile template as a saved dataset, as `mapConfig.datasets` holds the remote ones. */
export function xyzSavedDataset(id: string, label: string, metadata: XyzTileMetadata): SavedRemoteDataset {
  return {
    version: 'v1',
    data: { id, label, type: XYZ_TILE_TYPE, metadata: { ...metadata }, fields: [], allData: [] },
  };
}

/** Geomap's Esri services, by the name it saves. */
export const ESRI_SERVICES: Record<string, string> = {
  streets: 'World_Street_Map',
  'world-imagery': 'World_Imagery',
  'world-physical': 'World_Physical_Map',
  topo: 'World_Topo_Map',
  'usa-topo': 'USA_Topo_Maps',
  ocean: 'Ocean/World_Ocean_Base',
};

export function esriTileTemplate(slug: string): string {
  return `https://services.arcgisonline.com/arcgis/rest/services/${slug}/MapServer/tile/{z}/{y}/{x}`;
}
