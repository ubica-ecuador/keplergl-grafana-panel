import type { DataFrame, DataQueryRequest, DataQueryResponse } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import { isObservable, lastValueFrom } from 'rxjs';

import type { SavedMapConfig, SavedRemoteDataset } from '../data/mapConfig';

/**
 * Spatial catalogs as a data source (the Ubica Catalog data source, `ubica-catalog-datasource`): what the map's
 * "Add from catalog" lists, and how a tileset added from one keeps following its entry.
 *
 * A dataset added from a catalog is saved like any tileset, its URL included, plus where it came from
 * (`catalogEntry`, `catalogUid` in its metadata). On load the URL is taken again from the catalog, so moving a file
 * means changing one entry, not every dashboard; with the catalog out of reach the saved URL still loads.
 */

export const CATALOG_DATASOURCE_TYPE = 'ubica-catalog-datasource';

/** How long a catalog's entries are kept; one read serves every map of the dashboard. */
const KEEP_MS = 5 * 60 * 1000;

/** How long a map with catalog datasets waits for their catalogs before loading with the saved URLs. */
export const CATALOG_WAIT_MS = 3000;

export type CatalogKind = 'gltf-model' | '3d-tiles' | 'raster' | 'vector' | 'external' | 'other';

export interface CatalogEntry {
  id: string;
  title: string;
  kind: CatalogKind | string;
  collection: string;
  href: string;
  license: string;
  thumbnail: string | null;
  bbox: [number, number, number, number] | null;
}

export interface CatalogRef {
  uid: string;
  entry: string;
}

/** The dataset type, and the metadata key holding the URL, a catalog entry of each kind becomes. */
const ADDABLE: Partial<Record<string, { type: string; urlKey: string }>> = {
  '3d-tiles': { type: 'tile-3d', urlKey: 'tile3dUrl' },
};

/** Where an entry that this map cannot draw is used instead: a short label for its row. */
export function whereInstead(entry: Pick<CatalogEntry, 'kind'>): string {
  return entry.kind === 'gltf-model' ? 'In Plus' : 'By query';
}

/** Why an entry cannot be added to this map, or null when it can. */
export function whyNotAddable(entry: Pick<CatalogEntry, 'kind'>): string | null {
  if (ADDABLE[entry.kind]) {
    return null;
  }
  switch (entry.kind) {
    case 'gltf-model':
      return 'A glTF model: Kepler Plus draws it, with the 4D Model layer.';
    case 'raster':
      return 'A raster: give its address to a query as raster_url.';
    case 'external':
      return 'A catalog of its own: search it from a query.';
    default:
      return 'This map cannot draw this kind of entry.';
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

/** The rows of a catalog search frame (title, kind, collection, id, href, license, thumbnail, box). */
export function entriesOf(frame: DataFrame | undefined): CatalogEntry[] {
  if (!frame) {
    return [];
  }
  const column = (name: string) => frame.fields.find((field) => field.name === name)?.values ?? [];
  const [ids, titles, kinds, collections, hrefs, licenses, thumbnails] = [
    'id',
    'title',
    'kind',
    'collection',
    'href',
    'license',
    'thumbnail',
  ].map(column);
  const [xmin, ymin, xmax, ymax] = ['xmin', 'ymin', 'xmax', 'ymax'].map(column);
  const entries: CatalogEntry[] = [];
  for (let i = 0; i < frame.length; i++) {
    const box = [xmin[i], ymin[i], xmax[i], ymax[i]].map(Number);
    entries.push({
      id: String(ids[i] ?? ''),
      title: String(titles[i] ?? ids[i] ?? ''),
      kind: String(kinds[i] ?? 'other'),
      collection: String(collections[i] ?? ''),
      href: String(hrefs[i] ?? ''),
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

/** The saved form of a tileset added from a catalog: what kepler's Add Data → Tileset makes, plus its origin. */
export function catalogDataset(entry: CatalogEntry, uid: string): SavedRemoteDataset | null {
  const addable = ADDABLE[entry.kind];
  if (!addable) {
    return null;
  }
  return {
    version: 'v1',
    data: {
      id: `catalog-${entry.id}`,
      label: entry.title,
      color: [0, 92, 255],
      type: addable.type,
      fields: [],
      allData: [],
      disableDataOperation: true,
      metadata: { [addable.urlKey]: entry.href, catalogEntry: entry.id, catalogUid: uid },
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

/** Records what a catalog read found, for the synchronous lookups of a load. */
export async function rememberCatalog(uid: string): Promise<void> {
  const entries = await settled(catalogEntries(uid));
  if (entries) {
    known.set(uid, new Map(entries.map((entry) => [entry.id, entry.href])));
  }
}

/** For tests: set what a catalog read found. */
export function rememberCatalogForTests(uid: string, hrefs: Record<string, string>): void {
  known.set(uid, new Map(Object.entries(hrefs)));
}

/**
 * A saved dataset that came from a catalog, its URL taken again from the catalog when the catalog has been read
 * and still lists the entry; otherwise as saved.
 */
export function withCatalogHref(saved: SavedRemoteDataset): SavedRemoteDataset {
  const metadata = saved.data.metadata;
  const addable = Object.values(ADDABLE).find((a) => a?.type === saved.data.type);
  if (!metadata || !addable || typeof metadata.catalogEntry !== 'string' || typeof metadata.catalogUid !== 'string') {
    return saved;
  }
  const href = known.get(metadata.catalogUid)?.get(metadata.catalogEntry);
  return href && href !== metadata[addable.urlKey]
    ? { ...saved, data: { ...saved.data, metadata: { ...metadata, [addable.urlKey]: href } } }
    : saved;
}
