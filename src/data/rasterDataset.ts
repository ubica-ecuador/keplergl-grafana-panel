import { DataFrame } from '@grafana/data';

import { detectFields, FieldRoleOverrides, resolveRoles } from './detectFields';

/**
 * A raster scene a query points at, in the shape kepler's raster tileset needs.
 *
 * Deliberately separate from `PanelDataset`: a raster is not a table of rows.
 * It carries no data at all — only where the imagery lives and who can serve
 * it in tiles — and kepler models exactly that as a dataset with `rows: []`
 * whose whole substance is in `metadata`.
 */
export interface RasterDataset {
  id: string;
  label: string;
  /** The cloud-optimised GeoTIFF itself, as the query gave it. */
  cogUrl: string;
  /** Where the tile server describes that COG as a STAC Item. */
  metadataUrl: string;
  /** Tile servers kepler may draw from, in the order it should try them. */
  tileServerUrls: string[];
}

/**
 * The dataset id for a query's raster.
 *
 * Suffixed rather than sharing `datasetId(refId)`, because both can exist for
 * the same query: the row form of the catalogue search is a perfectly good
 * table — scene id, date, cloud cover — and there is no reason to lose it just
 * because one of its columns is also a raster. The `grafana-` prefix is what
 * marks a dataset as rebuilt-from-a-query, which is how the save path knows not
 * to write it into the dashboard JSON.
 */
export function rasterDatasetId(refId: string): string {
  return `grafana-${refId}-raster`;
}

/**
 * Whether an id is one this panel minted for a query's raster.
 *
 * The panel may only replace or remove its own: a tileset the user added
 * through kepler's Add Data lives in the same store and must survive every
 * refresh the query does.
 */
export function isPanelRasterId(id: string): boolean {
  return id.startsWith('grafana-') && id.endsWith('-raster');
}

/**
 * Turns the queries that point at imagery into raster descriptors.
 *
 * Sibling to `framesToDatasets` rather than part of it: a raster dataset has no
 * rows, `processRowObject([])` returns null, and the row path drops exactly
 * that. Travelling in the same list would mean the raster silently disappearing
 * on its way to kepler.
 *
 * Only the first row is read. A query is expected to resolve to one scene —
 * `ORDER BY … LIMIT 1` in SQL — and a table of ten scenes describes a choice
 * still to be made, not ten layers to stack.
 */
export function framesToRasters(
  frames: DataFrame[],
  overrides: Record<string, FieldRoleOverrides> = {},
  opts: { tileServerUrls: string[] }
): RasterDataset[] {
  // No server means kepler's own `getTitilerUrl` throws 'No raster tile
  // servers' from inside the layer's tile fetch, where it surfaces as a layer
  // that renders nothing rather than as a message anyone can act on.
  if (opts.tileServerUrls.length === 0) {
    return [];
  }

  const rasters: RasterDataset[] = [];

  frames.forEach((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    const roles = resolveRoles(detectFields(frame), overrides[refId]);
    if (!roles.rasterUrl) {
      return;
    }

    const cogUrl = firstValue(frame, roles.rasterUrl);
    if (!cogUrl) {
      return;
    }

    rasters.push({
      id: rasterDatasetId(refId),
      label: frame.name ?? `Query ${refId}`,
      cogUrl,
      metadataUrl: metadataUrlFor(opts.tileServerUrls[0], cogUrl),
      tileServerUrls: opts.tileServerUrls,
    });
  });

  return rasters;
}

/**
 * Where a TiTiler-based server describes a COG as a STAC Item.
 *
 * The COG's own url goes through `encodeURIComponent`, not into the string as
 * it stands: a signed link carries `?` and `&` of its own, and raw they would
 * be read as parameters of *this* request — titiler would receive a truncated
 * url and answer about a scene that does not exist.
 *
 * The trailing slash is trimmed for the same reason kepler's own form trims it:
 * `<server>//cog/stac` is a 404 on some deployments and a redirect on others,
 * and a redirect loses the CORS headers.
 */
export function metadataUrlFor(tileServerUrl: string, cogUrl: string): string {
  const base = tileServerUrl.replace(/\/+$/, '');
  return `${base}/cog/stac?url=${encodeURIComponent(cogUrl)}`;
}

/** The first non-empty value of a column, or undefined if it has none. */
function firstValue(frame: DataFrame, name: string): string | undefined {
  const field = frame.fields.find((f) => f.name === name);
  if (!field) {
    return undefined;
  }
  for (let i = 0; i < frame.length; i++) {
    const value = field.values[i];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}
