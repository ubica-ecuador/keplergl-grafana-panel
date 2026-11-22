import type { DataFrame } from '@grafana/data';

import { detectFields, resolveRoles, type FieldRoleOverrides } from './detectFields';
import { queryName } from './rasterDataset';
import { serviceKindOf } from './serviceKind';
import { parseWmsBox, type WmsBox } from './wmsDataset';
import { attributionsOf, frameLabelOf, frameLayerOf, frameZoomsOf } from './frameLayer';

/**
 * Map tiles a query points at, in the shape the panel's XYZ layer draws
 * (`xyzTiles.ts`, `xyzTileLayer.ts`).
 *
 * A sibling of `wmsDataset.ts` and `esriDataset.ts`, and for their reason: what
 * the query describes is a service, not rows. A `{z}/{x}/{y}` template is the
 * plainest of them — an OpenStreetMap-style server, a WMTS's tile matrices
 * spelt as a template (PDOK's `…/EPSG:3857/{z}/{x}/{y}.png`), the first
 * template of a TileJSON — and needs no tile server: the tiles are finished
 * pictures.
 *
 * Columns, not a data source: the Spatial Catalog's Services frame gives a
 * service that is not a WMS in `tiles_url`, `tiles_format`, `tiles_min_zoom`,
 * `tiles_max_zoom`, `tiles_zoom_ids` and `tiles_bbox`, and a DuckDB query
 * returning the same columns draws the same layer.
 */
export interface XyzDataset {
  /** Whom to credit for it (`meta.custom.layer.attribution`), as kepler's dataset attributions (`frameLayer.ts`). */
  attributions?: string[];
  /** `grafana-<refId>-tiles`: rebuilt from the query, and never saved with the map. */
  id: string;
  label: string;
  /** The template: `{z}`, `{x}`, `{y}` or `{-y}`, and `{s}` / `{a-c}`. */
  url: string;
  minZoom?: number;
  maxZoom?: number;
  /** The service's name for each zoom level that is not its number, by the number (`tiles_zoom_ids`). */
  zoomIds?: Record<string, string>;
  /** Where the tiles have data (`tiles_bbox`), or null: framed on and cut to, as a WMS's box is. */
  bbox: WmsBox | null;
  /**
   * What the tiles are when they are not pictures: vector tiles (`mvt`), or a
   * PMTiles archive (`pmtiles`), whose `url` is the archive. Absent for
   * pictures, the plain `{z}/{x}/{y}` case.
   */
  format?: 'mvt' | 'pmtiles';
  /** Where vector tiles describe themselves (`tiles_metadata_url`): a TileJSON, or the archive. */
  metadataUrl?: string;
  /**
   * What a PMTiles archive holds, as its header says (`pmtilesHeader.ts`):
   * vector tiles or pictures. Unknown until the header is read, and an archive
   * is not drawn before.
   */
  pmtilesKind?: 'vector' | 'raster';
  /**
   * Where the tiles' legend is (`legend_url`), for pictures only: a WMTS
   * style's `LegendURL`, most often a WMS GetLegendGraphic of the same style.
   * Shown in kepler's map legend when it is a picture (`serviceLegend.ts`).
   */
  legendUrl?: string;
  /**
   * The layer the frame names (`meta.custom.layer.key`): the same key is the
   * same layer whatever its address, as another WMTS style of it is, and is not
   * framed again (`boxedXyz`).
   */
  layerKey?: string;
}

/** What a query's tiles are: pictures, vector tiles, or a PMTiles archive. */
export type TilesFormat = 'raster' | 'mvt' | 'pmtiles';

/** The dataset id for a query's tiles. */
export function xyzDatasetId(refId: string): string {
  return `grafana-${refId}-tiles`;
}

/**
 * Whether an id is one this panel minted for a query's tiles.
 *
 * What the refresh removes when the query stops naming tiles, and what the
 * save leaves out of the dashboard JSON: the query rebuilds it on every load.
 * A Geomap's XYZ layer converted to this map is the same dataset type under
 * another id (`geomap-xyz-…`), saved with the map and kept.
 */
export function isPanelXyzId(id: string): boolean {
  return /^grafana-.+-tiles$/.test(id);
}

/**
 * What the tiles are, from `tiles_format`, or, when the query left it out,
 * from the address: `.pmtiles` is an archive, `.mvt` or `.pbf` vector tiles,
 * anything else pictures. A format the panel does not know comes back as the
 * query wrote it, lower-cased, for the notice that says so.
 */
export function tilesFormatOf(format: unknown, url: string): TilesFormat | string {
  const given = typeof format === 'string' ? format.trim().toLowerCase() : '';
  if (given) {
    return given;
  }
  if (isPmtilesUrl(url)) {
    return 'pmtiles';
  }
  if (/\.(mvt|pbf)([?#]|$)/i.test(url)) {
    return 'mvt';
  }
  return 'raster';
}

/** Whether an address is a PMTiles archive: `.pmtiles` at the end of its path, as kepler's `isPMTilesUrl` reads it. */
export function isPmtilesUrl(url: string): boolean {
  return /\.pmtiles([?#]|$)/i.test(url);
}

/** Whether a template names a tile: a zoom, a column and a row. */
export function isTileTemplate(url: string): boolean {
  return url.includes('{z}') && url.includes('{x}') && (url.includes('{y}') || url.includes('{-y}'));
}

/**
 * The service's names for its zoom levels, from `tiles_zoom_ids`: `"z:name"`
 * pairs, comma separated (`"0:00,1:01,…"`). Split at each pair's first colon
 * only, since a WMTS's matrix names often hold colons of their own
 * (`EPSG:3857:5`). A pair without a whole number before its colon is skipped;
 * none left is none.
 */
export function parseZoomIds(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  const ids: Record<string, string> = {};
  for (const pair of value.split(',')) {
    const colon = pair.indexOf(':');
    if (colon < 0) {
      continue;
    }
    const zoom = pair.slice(0, colon).trim();
    const name = pair.slice(colon + 1).trim();
    if (/^\d+$/.test(zoom) && name) {
      ids[String(Number(zoom))] = name;
    }
  }
  return Object.keys(ids).length ? ids : undefined;
}

/**
 * Turns the queries that name map tiles into tile descriptors.
 *
 * One descriptor per query, from its first row with a `tiles_url`, never one
 * per row: the rule the WMS and Image Service roads follow. The rows stay a
 * table on the map, as a WMS query's do. A query whose first service is a WMS
 * or an Image Service draws that instead (`serviceKindOf`).
 *
 * Pictures and vector tiles (`mvt`) are a `{z}/{x}/{y}` template; a PMTiles
 * archive is its address, and what it holds is read from its header before
 * it is drawn (`usePmtilesKinds`). A template that names no tile, and a format
 * the panel does not know, are left off the map; each such query is told to
 * `onUndrawn`, worded for the notice over the map (`undrawnTilesText`), since
 * a map that shows nothing reads as broken.
 */
export function framesToXyz(
  frames: DataFrame[],
  overrides: Record<string, FieldRoleOverrides> = {},
  opts: { onUndrawn?: (text: string) => void } = {}
): XyzDataset[] {
  const datasets: XyzDataset[] = [];

  frames.forEach((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    const roles = resolveRoles(detectFields(frame), overrides[refId]);
    if (!roles.tilesUrl || serviceKindOf(frame, roles) !== 'tiles') {
      return;
    }
    const column = (name: string | undefined) => (name ? frame.fields.find((f) => f.name === name) : undefined);
    const urls = column(roles.tilesUrl);
    const row = urls ? urls.values.findIndex((value) => typeof value === 'string' && value.trim() !== '') : -1;
    if (!urls || row < 0) {
      return;
    }
    const url = String(urls.values[row]).trim();
    const at = (name: string | undefined) => column(name)?.values[row];

    // An address that is an archive is one whatever the column says: kepler,
    // which reads it, tells the two apart by the address alone.
    const given = tilesFormatOf(at(roles.tilesFormat), url);
    const format = isPmtilesUrl(url) ? 'pmtiles' : given;
    if (
      !(format === 'raster' || format === 'mvt' || format === 'pmtiles') ||
      (format !== 'pmtiles' && !isTileTemplate(url))
    ) {
      opts.onUndrawn?.(undrawnTilesText(queryName(frame, refId), format));
      return;
    }

    // The row's levels, else the layer's (`meta.custom.layer`): said once for every row.
    const layerZooms = frameZoomsOf(frame);
    const minZoom = zoomOf(at(roles.tilesMinZoom)) ?? layerZooms.minZoom;
    const maxZoom = zoomOf(at(roles.tilesMaxZoom)) ?? layerZooms.maxZoom;
    // A vector tile's level is its number: the names are a WMTS's, of pictures.
    const zoomIds = format === 'raster' ? parseZoomIds(at(roles.tilesZoomIds)) : undefined;
    const metadata = at(roles.tilesMetadataUrl);
    const metadataUrl = format !== 'raster' && typeof metadata === 'string' && metadata.trim() ? metadata.trim() : '';
    // A legend explains pictures: vector tiles have kepler's own legend of
    // what they are coloured by, and an archive's pictures kepler's layer.
    const legend = format === 'raster' ? at(roles.legendUrl) : undefined;
    const legendUrl = typeof legend === 'string' ? legend.trim() : '';
    const layerKey = frameLayerOf(frame)?.key;
    datasets.push({
      id: xyzDatasetId(refId),
      label: frameLabelOf(frame, refId),
      url,
      ...(minZoom !== undefined ? { minZoom } : {}),
      ...(maxZoom !== undefined ? { maxZoom } : {}),
      ...(zoomIds ? { zoomIds } : {}),
      bbox: parseWmsBox(at(roles.tilesBbox)),
      ...(format !== 'raster' ? { format } : {}),
      ...(metadataUrl ? { metadataUrl } : {}),
      ...(legendUrl ? { legendUrl } : {}),
      ...(layerKey ? { layerKey } : {}),
      ...attributionsOf(frame),
    });
  });

  return datasets;
}

/** Why a query's tiles are not on the map, as the notice over it says. */
export function undrawnTilesText(query: string, format: string): string {
  switch (format) {
    case 'raster':
    case 'mvt':
      return `${query} gives a tiles_url with no {z}, {x} and {y} in it, so there is no tile to ask for.`;
    default:
      return `${query} gives tiles in a format this map does not know (tiles_format "${format}").`;
  }
}

/** A zoom level from a column: a whole number of zero or more, given as a number or as text. */
function zoomOf(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}
