import type { DataFrame, DataQueryRequest, DataQueryResponse } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import { isObservable, lastValueFrom } from 'rxjs';

import type { SavedMapConfig, SavedRemoteDataset } from '../data/mapConfig';
import { metadataUrlFor, rasterKind, type RasterKind } from '../data/rasterDataset';
import { COG_PAINTED_TYPE } from '../panel/cogPaintedLayer';

/**
 * Spatial catalogs as a data source (the Ubica Catalog data source, `ubica-catalog-datasource`): what the map's
 * "Add from catalog" lists, and how a dataset added from one keeps following its entry.
 *
 * A dataset added from a catalog is saved like any tileset or raster, its address included, plus where it came from
 * (`catalogEntry`, `catalogUid` in its metadata). On load the address is taken again from the catalog, so moving a
 * file means changing one entry, not every dashboard; with the catalog out of reach the saved address still loads.
 */

export const CATALOG_DATASOURCE_TYPE = 'ubica-catalog-datasource';

/** How long a catalog's entries are kept; one read serves every map of the dashboard. */
const KEEP_MS = 5 * 60 * 1000;

/** How long a map with catalog datasets waits for their catalogs before loading with the saved addresses. */
export const CATALOG_WAIT_MS = 3000;

export type CatalogKind = 'gltf-model' | '3d-tiles' | 'raster' | 'vector' | 'external' | 'other';

export interface CatalogEntry {
  id: string;
  title: string;
  kind: CatalogKind | string;
  collection: string;
  href: string;
  /** How a tile server reads it, when the data source names an alternate the entry has (a raster's VRT, say). */
  serverHref: string | null;
  /** Whether the tile server paints it with the palette it carries; null when the catalog does not say. */
  painted: boolean | null;
  start: number | null;
  license: string;
  thumbnail: string | null;
  bbox: [number, number, number, number] | null;
}

export interface CatalogRef {
  uid: string;
  entry: string;
}

/** What the map adding an entry brings: its raster tile servers, and how kepler describes a raster. */
export interface AddContext {
  tileServerUrls: readonly string[];
  /** The metadata kepler needs for a raster (keplerAdapter's `catalogRasterMetadata`). */
  rasterMetadata?: (raster: CatalogRaster) => Record<string, unknown>;
}

/** A raster entry as the map draws it: the panel's raster kinds (see `RasterKind`). */
export interface CatalogRaster {
  kind: RasterKind;
  sourceUrl: string;
  metadataUrl: string;
  tileServerUrls: string[];
}

const NO_CONTEXT: AddContext = { tileServerUrls: [] };

/** The address this map loads an entry from: for a raster, what its tile server reads. */
export function addressOf(entry: Pick<CatalogEntry, 'kind' | 'href' | 'serverHref'>): string {
  return entry.kind === 'raster' ? (entry.serverHref ?? entry.href) : entry.href;
}

/** A raster entry in the panel's terms: painted when the catalog says so, an archive by its name, else a COG. */
export function catalogRaster(
  entry: Pick<CatalogEntry, 'kind' | 'href' | 'serverHref' | 'painted'>,
  tileServerUrls: readonly string[]
): CatalogRaster {
  const sourceUrl = addressOf(entry);
  const kind = rasterKind(sourceUrl, entry.painted === true);
  const servers = kind === 'pmtiles' ? [] : [...tileServerUrls];
  return {
    kind,
    sourceUrl,
    metadataUrl: kind === 'cog' ? metadataUrlFor(servers[0] ?? '', sourceUrl) : sourceUrl,
    tileServerUrls: servers,
  };
}

/** Why an entry cannot be added to this map, or null when it can. */
export function whyNotAddable(
  entry: Pick<CatalogEntry, 'kind' | 'href' | 'serverHref'>,
  context: AddContext = NO_CONTEXT
): string | null {
  switch (entry.kind) {
    case '3d-tiles':
      return null;
    case 'raster':
      return rasterKind(addressOf(entry)) === 'pmtiles' || context.tileServerUrls.length > 0
        ? null
        : 'A raster: this map has no tile server to draw it (Raster tile server, in the panel options).';
    case 'gltf-model':
      return 'A glTF model: Kepler Plus draws it, with the 4D Model layer.';
    case 'external':
      return 'A catalog of its own: search it from a query.';
    default:
      return 'This map cannot draw this kind of entry.';
  }
}

/** Where an entry that this map cannot draw is used instead: a short label for its row. */
export function whereInstead(entry: Pick<CatalogEntry, 'kind'>): string {
  switch (entry.kind) {
    case 'gltf-model':
      return 'In Plus';
    case 'raster':
      return 'No tile server';
    default:
      return 'By query';
  }
}

const cache = new Map<string, { at: number; entries: Promise<CatalogEntry[]> }>();

/** For tests: forget every catalog read. */
export function forgetCatalogsForTests(): void {
  cache.clear();
}

/** The catalog data sources this Grafana has. */
export function listCatalogs(): Array<{ uid: string; name: string }> {
  try {
    // getList adds Grafana's built-in data source to any filter: keep the catalogs alone.
    return getDataSourceSrv()
      .getList({ type: CATALOG_DATASOURCE_TYPE })
      .filter((ds) => ds.type === CATALOG_DATASOURCE_TYPE)
      .map((ds) => ({ uid: ds.uid, name: ds.name }));
  } catch {
    return [];
  }
}

/** A catalog's entries, through its data source's own search query. */
export function catalogEntries(uid: string): Promise<CatalogEntry[]> {
  const kept = cache.get(uid);
  if (kept && Date.now() - kept.at < KEEP_MS) {
    return kept.entries;
  }
  const entries = readEntries(uid);
  entries.catch(() => cache.delete(uid));
  cache.set(uid, { at: Date.now(), entries });
  return entries;
}

async function readEntries(uid: string): Promise<CatalogEntry[]> {
  const ds = await getDataSourceSrv().get({ uid });
  const request = {
    targets: [{ refId: 'catalog', queryType: 'search', text: '', kind: '' }],
    scopedVars: {},
    requestId: `catalog-${uid}`,
    interval: '1m',
    intervalMs: 60_000,
    timezone: 'browser',
    app: 'panel',
    startTime: Date.now(),
  } as unknown as DataQueryRequest;
  const answer = ds.query(request) as unknown;
  const response = (isObservable(answer) ? await lastValueFrom(answer) : await answer) as DataQueryResponse;
  return entriesOf(response.data?.[0]);
}

/** The rows of a catalog search frame (title, kind, collection, id, href, server_href, painted, start, box…). */
export function entriesOf(frame: DataFrame | undefined): CatalogEntry[] {
  if (!frame) {
    return [];
  }
  const column = (name: string) => frame.fields.find((field) => field.name === name)?.values ?? [];
  const [ids, titles, kinds, collections, hrefs, serverHrefs, painted, starts, licenses, thumbnails] = [
    'id',
    'title',
    'kind',
    'collection',
    'href',
    'server_href',
    'painted',
    'start',
    'license',
    'thumbnail',
  ].map(column);
  const [xmin, ymin, xmax, ymax] = ['xmin', 'ymin', 'xmax', 'ymax'].map(column);
  const entries: CatalogEntry[] = [];
  for (let i = 0; i < frame.length; i++) {
    const box = [xmin[i], ymin[i], xmax[i], ymax[i]].map(Number);
    const start = Number(starts[i]);
    entries.push({
      id: String(ids[i] ?? ''),
      title: String(titles[i] ?? ids[i] ?? ''),
      kind: String(kinds[i] ?? 'other'),
      collection: String(collections[i] ?? ''),
      href: String(hrefs[i] ?? ''),
      serverHref: serverHrefs[i] ? String(serverHrefs[i]) : null,
      painted: typeof painted[i] === 'boolean' ? painted[i] : null,
      start: starts[i] !== null && starts[i] !== undefined && Number.isFinite(start) ? start : null,
      license: String(licenses[i] ?? ''),
      thumbnail: thumbnails[i] ? String(thumbnails[i]) : null,
      bbox: box.every(Number.isFinite) ? (box as [number, number, number, number]) : null,
    });
  }
  return entries.filter((entry) => entry.id !== '' && entry.href !== '');
}

/** Entries whose title, id or collection hold every word of the text, of one kind when asked. */
export function searchCatalog(entries: CatalogEntry[], text: string, kind: string): CatalogEntry[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(
    (entry) =>
      (!kind || entry.kind === kind) &&
      words.every((word) => `${entry.id} ${entry.title} ${entry.collection}`.toLowerCase().includes(word))
  );
}

/**
 * The saved form of an entry added from a catalog: what kepler's Add Data → Tileset makes for a tileset, what a
 * query's raster becomes for a raster (a `raster-tile`, or the panel's `cogPainted` when the tile server paints it),
 * plus where it came from. Null when this map cannot add it.
 */
export function catalogDataset(
  entry: CatalogEntry,
  uid: string,
  context: AddContext = NO_CONTEXT
): SavedRemoteDataset | null {
  if (whyNotAddable(entry, context)) {
    return null;
  }
  const origin = { catalogEntry: entry.id, catalogUid: uid };
  const base = {
    id: `catalog-${entry.id}`,
    label: entry.title,
    color: [0, 92, 255],
    fields: [],
    allData: [],
    disableDataOperation: true,
  };
  if (entry.kind === '3d-tiles') {
    return { version: 'v1', data: { ...base, type: 'tile-3d', metadata: { tile3dUrl: entry.href, ...origin } } };
  }
  const raster = catalogRaster(entry, context.tileServerUrls);
  return {
    version: 'v1',
    data: {
      ...base,
      type: raster.kind === 'painted' ? COG_PAINTED_TYPE : 'raster-tile',
      metadata: { ...(context.rasterMetadata?.(raster) ?? {}), ...origin },
    },
  };
}

/** The catalog entries a saved map's datasets came from. */
export function catalogRefsOf(saved: SavedMapConfig | null | undefined): CatalogRef[] {
  return (saved?.datasets ?? [])
    .map((dataset) => dataset.data.metadata ?? {})
    .filter((m) => typeof m.catalogEntry === 'string' && typeof m.catalogUid === 'string')
    .map((m) => ({ uid: m.catalogUid as string, entry: m.catalogEntry as string }));
}

/** Reads every catalog the refs name, at most `waitMs`; never rejects. */
export async function prefetchCatalogs(refs: CatalogRef[], waitMs = CATALOG_WAIT_MS): Promise<void> {
  const uids = [...new Set(refs.map((ref) => ref.uid))];
  if (uids.length === 0) {
    return;
  }
  const reads = Promise.allSettled(uids.map((uid) => rememberCatalog(uid)));
  await Promise.race([reads, new Promise((resolve) => setTimeout(resolve, waitMs))]);
}

/** A promise's value, or null when it rejects. */
async function settled<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}
const known = new Map<string, Map<string, string>>();

/** Records what a catalog read found (each entry's address for this map), for the synchronous lookups of a load. */
export async function rememberCatalog(uid: string): Promise<void> {
  const entries = await settled(catalogEntries(uid));
  if (entries) {
    known.set(uid, new Map(entries.map((entry) => [entry.id, addressOf(entry)])));
  }
}

/** For tests: set what a catalog read found. */
export function rememberCatalogForTests(uid: string, addresses: Record<string, string>): void {
  known.set(uid, new Map(Object.entries(addresses)));
}

/** A dataset's metadata pointed at another address, or null when it already points there or cannot be moved. */
function followed(type: string, metadata: Record<string, unknown>, address: string): Record<string, unknown> | null {
  switch (type) {
    case 'tile-3d':
      return metadata.tile3dUrl === address ? null : { ...metadata, tile3dUrl: address };
    case COG_PAINTED_TYPE:
      return metadata.sourceUrl === address ? null : { ...metadata, sourceUrl: address };
    case 'raster-tile': {
      if (metadata.pmtilesType) {
        return metadata.metadataUrl === address ? null : { ...metadata, metadataUrl: address };
      }
      const servers = metadata.rasterTileServerUrls;
      const server = Array.isArray(servers) && typeof servers[0] === 'string' ? servers[0] : null;
      const url = server ? metadataUrlFor(server, address) : null;
      return url && url !== metadata.metadataUrl ? { ...metadata, metadataUrl: url } : null;
    }
    default:
      return null;
  }
}

/**
 * A saved dataset that came from a catalog, its address taken again from the catalog when the catalog has been read
 * and still lists the entry; otherwise as saved.
 */
export function withCatalogHref(saved: SavedRemoteDataset): SavedRemoteDataset {
  const metadata = saved.data.metadata;
  if (!metadata || typeof metadata.catalogEntry !== 'string' || typeof metadata.catalogUid !== 'string') {
    return saved;
  }
  const address = known.get(metadata.catalogUid)?.get(metadata.catalogEntry);
  const moved = address ? followed(saved.data.type, metadata, address) : null;
  return moved ? { ...saved, data: { ...saved.data, metadata: moved } } : saved;
}
