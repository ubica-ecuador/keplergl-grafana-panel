import type { DataFrame, DataQueryRequest, DataQueryResponse } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import { isObservable, lastValueFrom } from 'rxjs';

import type { SavedMapConfig, SavedRemoteDataset } from '../data/mapConfig';
import { metadataUrlFor, rasterKind, type RasterDataset, type RasterKind } from '../data/rasterDataset';
import { COG_PAINTED_TYPE } from '../panel/cogPaintedLayer';

/**
 * Spatial catalogs as a data source (the Ubica Catalog data source, `ubica-catalog-datasource`): what the map's
 * "Add from catalog" lists, and how a dataset added from one keeps following its entry.
 *
 * A dataset added from a catalog is saved like any tileset or raster, its address included, plus where it came from
 * (`catalogEntry`, `catalogUid` in its metadata). On load the address is taken again from the catalog, so moving a
 * file means changing one entry, not every dashboard; with the catalog out of reach the saved address still loads.
 *
 * A collection of dated rasters (a map a year) is one entry in the list, a series: added, it is a raster whose scene
 * the map's time filter picks, as for a query that returns a row per scene. It is saved with its scenes
 * (`catalogSeries`, `catalogScenes`) and takes them again from the catalog on load, so a new year shows by itself.
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
  /** When it stops holding (an item's end_datetime); null for an instant or when the catalog does not say. */
  end: number | null;
  /** The title of its collection, which names a series. */
  collectionTitle: string;
  license: string;
  thumbnail: string | null;
  bbox: [number, number, number, number] | null;
  /** A series only: the collection's dated rasters, oldest first. The entry's own address is the newest one's. */
  scenes?: CatalogScene[];
}

/** One scene of a series: the entry it is, when it holds, and where this map reads it. */
export interface CatalogScene {
  entry: string;
  start: number;
  end: number | null;
  address: string;
}

/** A series' scenes as a saved dataset keeps them (`catalogScenes`). */
interface SavedScene {
  time: number;
  end: number | null;
  url: string;
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
  const [
    ids,
    titles,
    kinds,
    collections,
    collectionTitles,
    hrefs,
    serverHrefs,
    painted,
    starts,
    ends,
    licenses,
    thumbnails,
  ] = [
    'id',
    'title',
    'kind',
    'collection',
    'collection_title',
    'href',
    'server_href',
    'painted',
    'start',
    'end',
    'license',
    'thumbnail',
  ].map(column);
  const time = (value: unknown) => {
    const n = Number(value);
    return value !== null && value !== undefined && Number.isFinite(n) ? n : null;
  };
  const [xmin, ymin, xmax, ymax] = ['xmin', 'ymin', 'xmax', 'ymax'].map(column);
  const entries: CatalogEntry[] = [];
  for (let i = 0; i < frame.length; i++) {
    const box = [xmin[i], ymin[i], xmax[i], ymax[i]].map(Number);
    entries.push({
      id: String(ids[i] ?? ''),
      title: String(titles[i] ?? ids[i] ?? ''),
      kind: String(kinds[i] ?? 'other'),
      collection: String(collections[i] ?? ''),
      collectionTitle: String(collectionTitles[i] ?? ''),
      href: String(hrefs[i] ?? ''),
      serverHref: serverHrefs[i] ? String(serverHrefs[i]) : null,
      painted: typeof painted[i] === 'boolean' ? painted[i] : null,
      start: time(starts[i]),
      end: time(ends[i]),
      license: String(licenses[i] ?? ''),
      thumbnail: thumbnails[i] ? String(thumbnails[i]) : null,
      bbox: box.every(Number.isFinite) ? (box as [number, number, number, number]) : null,
    });
  }
  return entries.filter((entry) => entry.id !== '' && entry.href !== '');
}

/**
 * The entries with each collection's dated rasters folded into one series: a map a year is one thing to add, and the
 * map's time range picks the year. Fewer than two, or undated, they stay as they are.
 */
export function withSeries(entries: CatalogEntry[]): CatalogEntry[] {
  const dated = (entry: CatalogEntry) => entry.kind === 'raster' && entry.start !== null && entry.collection !== '';
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of entries.filter(dated)) {
    groups.set(entry.collection, [...(groups.get(entry.collection) ?? []), entry]);
  }
  const folded: CatalogEntry[] = [];
  const done = new Set<string>();
  for (const entry of entries) {
    const group = dated(entry) ? groups.get(entry.collection) : undefined;
    if (!group || group.length < 2) {
      folded.push(entry);
    } else if (!done.has(entry.collection)) {
      done.add(entry.collection);
      folded.push(seriesEntry(group));
    }
  }
  return folded;
}

function seriesEntry(group: CatalogEntry[]): CatalogEntry {
  const sorted = [...group].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const newest = sorted[sorted.length - 1];
  return {
    ...newest,
    id: newest.collection,
    title: newest.collectionTitle || newest.collection,
    start: sorted[0].start,
    end: newest.end ?? newest.start,
    thumbnail: sorted.find((entry) => entry.thumbnail)?.thumbnail ?? null,
    scenes: sorted.map((entry) => ({
      entry: entry.id,
      start: entry.start as number,
      end: entry.end,
      address: addressOf(entry),
    })),
  };
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
  const origin = entry.scenes
    ? { catalogSeries: entry.collection, catalogUid: uid, catalogScenes: savedScenes(entry.scenes) }
    : { catalogEntry: entry.id, catalogUid: uid };
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

/** The catalog entries (or series) a saved map's datasets came from. */
export function catalogRefsOf(saved: SavedMapConfig | null | undefined): CatalogRef[] {
  return (saved?.datasets ?? [])
    .map((dataset) => dataset.data.metadata ?? {})
    .map((m) => ({ uid: m.catalogUid, entry: m.catalogEntry ?? m.catalogSeries }))
    .filter((ref): ref is CatalogRef => typeof ref.uid === 'string' && typeof ref.entry === 'string');
}

function savedScenes(scenes: CatalogScene[]): SavedScene[] {
  return scenes.map((scene) => ({ time: scene.start, end: scene.end, url: scene.address }));
}

/** A saved dataset's `catalogScenes`, the malformed ones left out. */
function scenesOf(value: unknown): SavedScene[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((scene) => typeof scene?.time === 'number' && typeof scene?.url === 'string')
    .map((scene) => ({ time: scene.time, end: typeof scene.end === 'number' ? scene.end : null, url: scene.url }));
}

/**
 * The series a map holds (datasets added from a catalog with their scenes), as rasters its time filter moves
 * through: a painted one by `sourceUrl`, an archive by `metadataUrl`, a tiled COG through its tile server.
 */
export function catalogSeriesRasters(
  datasets: Record<string, { type?: string; label?: string; metadata?: Record<string, unknown> }>
): RasterDataset[] {
  const rasters: RasterDataset[] = [];
  for (const [id, dataset] of Object.entries(datasets)) {
    const metadata = dataset.metadata ?? {};
    const scenes = scenesOf(metadata.catalogScenes);
    if (scenes.length === 0) {
      continue;
    }
    const newest = scenes[scenes.length - 1].url;
    const painted = dataset.type === COG_PAINTED_TYPE;
    const kind: RasterKind = painted ? 'painted' : metadata.pmtilesType ? 'pmtiles' : 'cog';
    const servers = painted ? [metadata.serverUrl] : kind === 'pmtiles' ? [] : metadata.rasterTileServerUrls;
    const tileServerUrls = (Array.isArray(servers) ? servers : []).filter(
      (url): url is string => typeof url === 'string' && url !== ''
    );
    const sourceUrl =
      painted && typeof metadata.sourceUrl === 'string'
        ? metadata.sourceUrl
        : kind === 'pmtiles' && typeof metadata.metadataUrl === 'string'
          ? metadata.metadataUrl
          : newest;
    rasters.push({
      id,
      label: dataset.label ?? id,
      kind,
      sourceUrl,
      metadataUrl: kind === 'cog' ? metadataUrlFor(tileServerUrls[0] ?? '', sourceUrl) : sourceUrl,
      tileServerUrls,
      scenes: scenes.map((scene) => ({ time: scene.time, end: scene.end, sourceUrl: scene.url, itemUrl: null })),
      // What a rebuild of the dataset must keep, or it would stop being a series.
      keepMetadata: {
        catalogSeries: metadata.catalogSeries,
        catalogUid: metadata.catalogUid,
        catalogScenes: metadata.catalogScenes,
      },
    });
  }
  return rasters;
}

/** The moments a series' time filter spans: each scene's start, and the end of the last. */
export function seriesCalendar(raster: RasterDataset): number[] {
  const times = raster.scenes.map((scene) => scene.time).filter((time): time is number => time !== null);
  const last = raster.scenes[raster.scenes.length - 1];
  return typeof last?.end === 'number' && last.end > (last.time ?? -Infinity) ? [...times, last.end] : times;
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
const knownSeries = new Map<string, Map<string, SavedScene[]>>();

/**
 * Records what a catalog read found (each entry's address for this map, each series' scenes), for the synchronous
 * lookups of a load.
 */
export async function rememberCatalog(uid: string): Promise<void> {
  const entries = await settled(catalogEntries(uid));
  if (entries) {
    rememberEntries(uid, entries);
  }
}

function rememberEntries(uid: string, entries: CatalogEntry[]): void {
  known.set(uid, new Map(entries.map((entry) => [entry.id, addressOf(entry)])));
  knownSeries.set(
    uid,
    new Map(
      withSeries(entries)
        .filter((entry) => entry.scenes)
        .map((entry) => [entry.collection, savedScenes(entry.scenes ?? [])])
    )
  );
}

/** For tests: set what a catalog read found, as addresses by entry id or as whole entries. */
export function rememberCatalogForTests(uid: string, found: Record<string, string> | CatalogEntry[]): void {
  if (Array.isArray(found)) {
    rememberEntries(uid, found);
  } else {
    known.set(uid, new Map(Object.entries(found)));
    knownSeries.delete(uid);
  }
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
  if (metadata && typeof metadata.catalogSeries === 'string' && typeof metadata.catalogUid === 'string') {
    return withCatalogScenes(saved, metadata);
  }
  if (!metadata || typeof metadata.catalogEntry !== 'string' || typeof metadata.catalogUid !== 'string') {
    return saved;
  }
  const address = known.get(metadata.catalogUid)?.get(metadata.catalogEntry);
  const moved = address ? followed(saved.data.type, metadata, address) : null;
  return moved ? { ...saved, data: { ...saved.data, metadata: moved } } : saved;
}

/** A saved series with the catalog's scenes, pointed at the newest; as saved when the catalog does not list it. */
function withCatalogScenes(saved: SavedRemoteDataset, metadata: Record<string, unknown>): SavedRemoteDataset {
  const scenes = knownSeries.get(metadata.catalogUid as string)?.get(metadata.catalogSeries as string);
  if (!scenes?.length) {
    return saved;
  }
  const moved = followed(saved.data.type, metadata, scenes[scenes.length - 1].url) ?? metadata;
  if (moved === metadata && JSON.stringify(scenesOf(metadata.catalogScenes)) === JSON.stringify(scenes)) {
    return saved;
  }
  return { ...saved, data: { ...saved.data, metadata: { ...moved, catalogScenes: scenes } } };
}
