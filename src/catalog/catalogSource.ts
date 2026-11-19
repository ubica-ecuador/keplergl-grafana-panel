import { dateTime, type DataFrame, type DataQueryRequest, type DataQueryResponse } from '@grafana/data';
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
 * A collection of rasters may be a series, and the data source says how (its `series` column, read off the
 * collection or said by the catalog):
 * - `items`: few dated items, each the whole collection (a map a year). One entry in the list; added, a raster whose
 *   scene the map's time filter picks, saved with its scenes (`catalogSeries`, `catalogScenes`) and taking them again
 *   from the catalog on load. Each year can also be added alone.
 * - `search`: a STAC API collection, or listed tiles, or too many to list. One entry; added, it is searched over the
 *   map's view in the dashboard's time range (the data source's STAC search) and saved as that search
 *   (`catalogSearch`), never as scenes: they are searched again on load and when the time range changes.
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
  /** A series only: its entries, oldest first, each of which can also be added alone (to compare two years). */
  members?: CatalogEntry[];
  /** How its collection is a series, as the data source says; null when not one, undefined when it does not say. */
  series?: 'items' | 'search' | null;
  /** A searched series: what the data source's STAC search is asked for (an entry or a collection id). */
  search?: { target: string };
  /** A series found by some of its entries rather than by itself: `members` holds those, to show open. */
  foundByMembers?: boolean;
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
  /** The map's view, `[west, south, east, north]`: where a searched series is searched. */
  viewBounds?: () => [number, number, number, number] | null;
  tileServerUrls: readonly string[];
  /** The dashboard's time range, for the list's "In the time range". */
  timeRange?: { from: number; to: number };
  /** Whether the dashboard's time range drives the map's time filter, and so which scene of a series it draws. */
  followsDashboard?: boolean;
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
  entry: Pick<CatalogEntry, 'kind' | 'href' | 'serverHref' | 'search'>,
  context: AddContext = NO_CONTEXT
): string | null {
  switch (entry.kind) {
    case '3d-tiles':
      return null;
    case 'raster':
      return (rasterKind(addressOf(entry)) === 'pmtiles' && !entry.search) || context.tileServerUrls.length > 0
        ? null
        : 'A raster: this map has no tile server to draw it (Raster tile server, in the panel options).';
    case 'gltf-model':
      return 'A glTF model: Kepler Plus draws it, with the 4D Model layer.';
    case 'external':
      if (entry.search) {
        return context.tileServerUrls.length > 0
          ? null
          : 'Searched scenes: this map has no tile server to draw them (Raster tile server, in the panel options).';
      }
      return 'A catalog of its own: search it from a query.';
    default:
      return 'This map cannot draw this kind of entry.';
  }
}

/** Where an entry that this map cannot draw is used instead: a short label for its row. */
export function whereInstead(entry: Pick<CatalogEntry, 'kind' | 'search'>): string {
  if (entry.search) {
    return 'No tile server';
  }
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
    series,
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
    'series',
  ].map(column);
  const hasSeries = frame.fields.some((field) => field.name === 'series');
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
      ...(hasSeries ? { series: series[i] === 'items' || series[i] === 'search' ? series[i] : null } : {}),
    });
  }
  return entries.filter((entry) => entry.id !== '' && entry.href !== '');
}

/**
 * The entries with each collection's dated rasters folded into one series: a map a year is one thing to add, and the
 * map's time range picks the year. Fewer than two, or undated, they stay as they are.
 */
export function withSeries(entries: CatalogEntry[]): CatalogEntry[] {
  // The data source's word when it gives one; an older one's frame: dated rasters of a collection are listed.
  const modeOf = (entry: CatalogEntry) =>
    entry.series !== undefined
      ? entry.series
      : entry.kind === 'raster' && entry.start !== null && entry.collection !== ''
        ? 'items'
        : null;
  const folds = (entry: CatalogEntry) => entry.kind === 'raster' && entry.collection !== '' && modeOf(entry) !== null;
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of entries.filter(folds)) {
    groups.set(entry.collection, [...(groups.get(entry.collection) ?? []), entry]);
  }
  const folded: CatalogEntry[] = [];
  const done = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === 'external' && entry.series === 'search') {
      folded.push({ ...entry, search: { target: entry.id } });
      continue;
    }
    const group = folds(entry) ? groups.get(entry.collection) : undefined;
    if (!group || (modeOf(entry) === 'items' && group.length < 2)) {
      folded.push(entry);
    } else if (!done.has(entry.collection)) {
      done.add(entry.collection);
      folded.push(modeOf(entry) === 'search' ? searchEntry(group) : seriesEntry(group));
    }
  }
  return folded;
}

/** Listed rasters that are searched (tiles, or too many): one entry, searched as a STAC API collection is. */
function searchEntry(group: CatalogEntry[]): CatalogEntry {
  const newest = [...group].sort((a, b) => (a.start ?? 0) - (b.start ?? 0))[group.length - 1];
  return {
    ...newest,
    id: newest.collection,
    title: newest.collectionTitle || newest.collection,
    search: { target: newest.collection },
  };
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
    members: sorted,
    scenes: sorted.map((entry) => ({
      entry: entry.id,
      start: entry.start as number,
      end: entry.end,
      address: addressOf(entry),
    })),
  };
}

/** Whether an entry holds at some moment of a time range: undated ones hold at every moment (a building, a model). */
export function holdsWithin(entry: Pick<CatalogEntry, 'start' | 'end'>, range: { from: number; to: number }): boolean {
  if (entry.start === null) {
    return true;
  }
  const end = entry.end !== null && entry.end > entry.start ? entry.end : entry.start;
  return entry.start <= range.to && end >= range.from;
}

/**
 * Entries whose title, id or collection hold every word of the text, of one kind when asked, and that hold within a
 * time range when one is given. A series is found by itself, or by some of its entries ("2010", or the years of the
 * range), and then carries only those, marked `foundByMembers` so the list shows them open.
 */
export function searchCatalog(
  entries: CatalogEntry[],
  text: string,
  kind: string,
  range: { from: number; to: number } | null = null
): CatalogEntry[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const byText = (entry: CatalogEntry) =>
    (!kind || entry.kind === kind) &&
    words.every((word) => `${entry.id} ${entry.title} ${entry.collection}`.toLowerCase().includes(word));
  const byTime = (entry: CatalogEntry) => range === null || holdsWithin(entry, range);
  const found: CatalogEntry[] = [];
  for (const entry of entries) {
    if (!entry.members) {
      if (byText(entry) && byTime(entry)) {
        found.push(entry);
      }
      continue;
    }
    const inTime = entry.members.filter(byTime);
    const members = byText(entry) ? inTime : inTime.filter(byText);
    if (members.length > 0) {
      const narrowed = members.length < entry.members.length;
      found.push(narrowed ? { ...entry, members, foundByMembers: true } : entry);
    }
  }
  return found;
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
  datasets: Record<string, CatalogDatasetLike>,
  searched: ReadonlyMap<string, SearchedScenes> = new Map()
): RasterDataset[] {
  const rasters: RasterDataset[] = [];
  for (const [id, dataset] of Object.entries(datasets)) {
    const metadata = dataset.metadata ?? {};
    const isSearch = searchOf(metadata) !== null;
    // A searched series moves with the clock from two scenes up; none and one are the hook's (useCatalogSeries).
    const scenes = isSearch ? (searched.get(id)?.scenes ?? []) : scenesOf(metadata.catalogScenes);
    const raster = scenes.length >= (isSearch ? 2 : 1) ? seriesRaster(id, dataset, scenes) : null;
    if (raster) {
      rasters.push(raster);
    }
  }
  return rasters;
}

/** A dataset of kepler's store, as far as a series needs it. */
export type CatalogDatasetLike = { type?: string; label?: string; metadata?: Record<string, unknown> };

/**
 * A dataset added from a catalog as a raster with the given scenes, drawn from the newest: a painted COG through its
 * server, an archive by itself, a COG through a tile server.
 */
export function seriesRaster(
  id: string,
  dataset: CatalogDatasetLike,
  scenes: Array<{ time: number | null; end: number | null; url: string; item?: string | null }>
): RasterDataset | null {
  if (scenes.length === 0) {
    return null;
  }
  const metadata = dataset.metadata ?? {};
  const sourceUrl = scenes[scenes.length - 1].url;
  const painted = dataset.type === COG_PAINTED_TYPE;
  const kind: RasterKind = painted ? 'painted' : metadata.pmtilesType ? 'pmtiles' : 'cog';
  const servers = painted ? [metadata.serverUrl] : kind === 'pmtiles' ? [] : metadata.rasterTileServerUrls;
  const tileServerUrls = (Array.isArray(servers) ? servers : []).filter(
    (url): url is string => typeof url === 'string' && url !== ''
  );
  return {
    id,
    label: dataset.label ?? id,
    kind,
    sourceUrl,
    metadataUrl: kind === 'cog' ? metadataUrlFor(tileServerUrls[0] ?? '', sourceUrl) : sourceUrl,
    tileServerUrls,
    scenes: scenes.map((scene) => ({
      time: scene.time,
      end: scene.end,
      sourceUrl: scene.url,
      itemUrl: scene.item ?? null,
    })),
    // What a rebuild of the dataset must keep, or it would stop being a series.
    keepMetadata:
      searchOf(metadata) !== null
        ? { catalogSearch: metadata.catalogSearch, catalogUid: metadata.catalogUid }
        : {
            catalogSeries: metadata.catalogSeries,
            catalogUid: metadata.catalogUid,
            catalogScenes: metadata.catalogScenes,
          },
  };
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

/** One scene a search found, as the map keeps it: its time (null when the search found one alone), the picture, the item. */
export interface SearchedScene {
  time: number | null;
  end: number | null;
  url: string;
  item: string | null;
}

/** What a search of a series found: its scenes, oldest first; whether the catalog says they are painted; whether cut. */
export interface SearchedScenes {
  scenes: SearchedScene[];
  painted: boolean | null;
  truncated: boolean;
}

/** What a searched series is: the target of the data source's STAC search, and the area, saved with the dataset. */
export interface SeriesSearch {
  target: string;
  bbox: [number, number, number, number];
}

/** A dataset's saved search, or null when it is none. */
export function searchOf(metadata: Record<string, unknown> | undefined): SeriesSearch | null {
  const search = metadata?.catalogSearch as Partial<SeriesSearch> | undefined;
  const bbox = search?.bbox;
  return typeof search?.target === 'string' &&
    Array.isArray(bbox) &&
    bbox.length === 4 &&
    bbox.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? { target: search.target, bbox: bbox as SeriesSearch['bbox'] }
    : null;
}

/** The scenes of a STAC search frame (the data source's `stac` query): raster_url, time, raster_end, raster_item_url. */
export function scenesOfFrame(frame: DataFrame | undefined): SearchedScenes {
  if (!frame) {
    return { scenes: [], painted: null, truncated: false };
  }
  const column = (name: string) => frame.fields.find((field) => field.name === name)?.values;
  const urls = column('raster_url') ?? [];
  const times = column('time');
  const ends = column('raster_end');
  const items = column('raster_item_url');
  const painted = column('raster_painted');
  const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  const scenes: SearchedScene[] = [];
  for (let i = 0; i < frame.length; i++) {
    if (typeof urls[i] !== 'string' || !urls[i]) {
      continue;
    }
    const time = number(times?.[i]);
    const end = number(ends?.[i]);
    scenes.push({
      time: time !== null && Number.isFinite(time) ? time : null,
      end: end !== null && Number.isFinite(end) ? end : null,
      url: urls[i],
      item: typeof items?.[i] === 'string' ? items[i] : null,
    });
  }
  scenes.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  const flag = painted?.find((value: unknown) => typeof value === 'boolean');
  return {
    scenes,
    painted: typeof flag === 'boolean' ? flag : null,
    truncated: (frame.meta?.notices ?? []).some((notice) => notice.severity === 'warning'),
  };
}

const searches = new Map<string, { at: number; answer: Promise<SearchedScenes> }>();
/** A search answered is kept this long: Add from catalog and the map's first search are the same question. */
const SEARCH_KEEP_MS = 2 * 60 * 1000;

/**
 * A series searched over an area in a time range, through its catalog's data source (the `stac` query), so the same
 * search a dashboard's query makes: a STAC API's collection or a catalog's listed tiles alike.
 */
export function searchScenes(
  uid: string,
  search: SeriesSearch,
  range: { from: number; to: number }
): Promise<SearchedScenes> {
  const key = JSON.stringify([uid, search.target, search.bbox, range.from, range.to]);
  const kept = searches.get(key);
  if (kept && Date.now() - kept.at < SEARCH_KEEP_MS) {
    return kept.answer;
  }
  const answer = (async () => {
    const ds = await getDataSourceSrv().get({ uid });
    const from = dateTime(range.from);
    const to = dateTime(range.to);
    const request = {
      targets: [{ refId: 'search', queryType: 'stac', entries: [search.target], bbox: search.bbox.join(',') }],
      range: { from, to, raw: { from, to } },
      scopedVars: {},
      requestId: `catalog-search-${uid}-${search.target}`,
      interval: '1m',
      intervalMs: 60_000,
      timezone: 'utc',
      app: 'panel',
      startTime: Date.now(),
    } as unknown as DataQueryRequest;
    const reply = ds.query(request) as unknown;
    const response = (isObservable(reply) ? await lastValueFrom(reply) : await reply) as DataQueryResponse;
    if (response.errors?.length) {
      throw new Error(response.errors[0].message ?? 'The search failed');
    }
    return scenesOfFrame(response.data?.[0]);
  })();
  answer.catch(() => searches.delete(key));
  searches.set(key, { at: Date.now(), answer });
  return answer;
}

/**
 * The saved form of a searched series: drawn at the newest scene found, and saved as its search (`catalogSearch`:
 * target and area) with no scenes, which are searched again on load and with every change of the time range.
 */
export function searchDataset(
  entry: CatalogEntry,
  uid: string,
  context: AddContext,
  found: SearchedScenes,
  bbox: [number, number, number, number]
): SavedRemoteDataset | null {
  const newest = found.scenes[found.scenes.length - 1];
  if (!entry.search || !newest || whyNotAddable(entry, context)) {
    return null;
  }
  const raster = catalogRaster(
    { kind: 'raster', href: newest.url, serverHref: null, painted: found.painted },
    context.tileServerUrls
  );
  const area = bbox.map((n) => Math.round(n * 1e5) / 1e5) as SeriesSearch['bbox'];
  return {
    version: 'v1',
    data: {
      id: `catalog-${entry.search.target}`,
      label: entry.title,
      color: [0, 92, 255],
      fields: [],
      allData: [],
      disableDataOperation: true,
      type: raster.kind === 'painted' ? COG_PAINTED_TYPE : 'raster-tile',
      metadata: {
        ...(context.rasterMetadata?.(raster) ?? {}),
        catalogSearch: { target: entry.search.target, bbox: area },
        catalogUid: uid,
      },
    },
  };
}
