import type { DataFrame } from '@grafana/data';

import type { FieldRoles } from './detectFields';

/** The map services a query's row can name, each drawn by its own road (`wmsDataset.ts`, `esriDataset.ts`, …). */
export type ServiceKind = 'wms' | 'esri' | 'tiles' | 'raster';

/**
 * Which kind of service a query draws, or null when it names none.
 *
 * One service per query: the first row that names any decides, and in that
 * row, when it names several, a WMS (`wms_url` with `wms_layer`) wins over an
 * ArcGIS Image Service (`esri_url`), which wins over map tiles (`tiles_url`),
 * which win over a raster (`raster_url`). A frame of a catalog's services
 * lists them one per row, the one meant first, and every row carries every
 * column, empty where the service is another kind; a hand-written query can
 * fill two in one row. Without this each road took its own first row and the
 * map stacked a WMS on tiles on a COG, where the query meant one of them.
 *
 * The order is the one that costs least when it is wrong. A service that
 * paints its own pictures for any view (a WMS, an Image Service) is what a
 * catalog gives first when it has one; tiles are the same pictures cut in
 * advance; a raster link needs a tile server the panel may not have.
 *
 * Zarr stays out: a store and one of its arrays is a description no row of
 * a catalog's services gives, and it is drawn as before.
 *
 * Each road asks this and steps aside when another kind won, so a query that
 * names one kind only is drawn exactly as it was.
 */
export function serviceKindOf(frame: DataFrame, roles: FieldRoles): ServiceKind | null {
  const column = (name: string | undefined) => (name ? frame.fields.find((f) => f.name === name) : undefined);
  const wmsUrls = column(roles.wmsUrl);
  const wmsLayers = column(roles.wmsLayer);
  const esriUrls = column(roles.esriUrl);
  const tilesUrls = column(roles.tilesUrl);
  const rasterUrls = column(roles.rasterUrl);
  if (!wmsUrls && !esriUrls && !tilesUrls && !rasterUrls) {
    return null;
  }

  for (let row = 0; row < frame.length; row += 1) {
    if (named(wmsUrls?.values[row]) && named(wmsLayers?.values[row])) {
      return 'wms';
    }
    if (named(esriUrls?.values[row])) {
      return 'esri';
    }
    if (named(tilesUrls?.values[row])) {
      return 'tiles';
    }
    if (named(rasterUrls?.values[row])) {
      return 'raster';
    }
  }
  return null;
}

/** Whether a road should step aside for a query: it names a service, and of another kind. */
export function anotherServiceWins(frame: DataFrame, roles: FieldRoles, mine: ServiceKind): boolean {
  const kind = serviceKindOf(frame, roles);
  return kind !== null && kind !== mine;
}

function named(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}
