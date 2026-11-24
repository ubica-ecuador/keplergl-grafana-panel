import { dateTime, type DataFrame, type DataQueryRequest, type DataQueryResponse } from '@grafana/data';
import { config, getDataSourceSrv } from '@grafana/runtime';
import { isObservable, lastValueFrom } from 'rxjs';

import type { SavedCatalogLayer, SavedMapConfig, SavedRemoteDataset } from '../data/mapConfig';
import {
  groupScenes,
  metadataUrlFor,
  parseBox,
  rasterKind,
  type RasterDataset,
  type RasterKind,
  type ScenePart,
} from '../data/rasterDataset';
import { COG_PAINTED_TYPE } from '../panel/cogPaintedLayer';
import { ZARR_TILES_TYPE } from '../panel/zarrTileLayer';
import { xyzSavedDataset } from '../data/xyzTiles';
import { featureRequestUrl, type FeatureProtocol, type FeatureTarget, readFeatureRequest } from './featureRequests';

/**
 * Spatial catalogs and services as a data source (the Spatial Catalog data source, `ubica-spatialcatalog-datasource`:
 * STAC catalogs and APIs, OGC API Features, WFS, ArcGIS Server): what the map's
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

export const CATALOG_DATASOURCE_TYPE = 'ubica-spatialcatalog-datasource';

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
  /**
   * How the tile server paints it, as its query parameters (`bidx=1&colormap=…`), when the catalog says (its classes'
   * colours, a render): the data source's `paint` column.
   */
  paint?: string | null;
  /** A data file's PMTiles, the same data as tiles at every zoom (Portolan's visual archive beside its GeoParquet). */
  tiles?: CatalogTiles;
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
  /** A map service entry's service (STAC web-map-links), as the data source reads it. */
  service?: CatalogService;
  /** A series found by some of its entries rather than by itself: `members` holds those, to show open. */
  foundByMembers?: boolean;
  /** A file's size in bytes, when the catalog says (`file:size`). */
  size?: number | null;
  /** Its media type, when the catalog says. */
  mediaType?: string;
  /**
   * A features entry: where its features are asked for as GeoJSON, without area, time or limit (an OGC API
   * collection's items, a WFS's GetFeature, an ArcGIS layer's query); null when the service gives no GeoJSON.
   */
  itemsHref?: string | null;
  /** A features entry: how it is asked (see `featureRequests.ts`); absent, an OGC API collection. */
  featureProtocol?: FeatureProtocol;
  /** A features entry of a WFS or ArcGIS: the property (or field) its time range is kept to; none, no time. */
  timeProperty?: string | null;
  /** A Socrata dataset: its geometry column (`shape:<name>` when it is not points). */
  geometryField?: string;
  /** A data cube's variable (Zarr, Icechunk): its store as the tile server opens it, its axes. */
  cube?: CatalogCube;
  /** A Datastream, sensors or an EDR collection: what it measures. */
  parameters?: Array<{ id: string; label: string; unit: string }>;
}

/** A data file's PMTiles, as the data source gives it in its `tiles` column: the archive and its layers. */
export interface CatalogTiles {
  href: string;
  mediaType: string;
  service: CatalogService;
}

/** A data cube's variable, as the data source gives it in its `cube` column. */
export interface CatalogCube {
  storeUrl: string;
  variable: string;
  /** The temporal axis the clock walks, or null. */
  dimension: string | null;
  /** `axis=value` for the other axes. */
  selectors: string[];
  unit?: string;
  description?: string;
}

/** A map service that draws an entry (STAC web-map-links), as the data source gives it in its `service` column. */
export interface CatalogService {
  /** `arcgis-image`: an ArcGIS ImageServer or MapServer without Web Mercator tiles, a picture asked per tile. */
  protocol: 'wms' | 'wmts' | 'xyz' | 'tilejson' | 'pmtiles' | 'arcgis-image';
  layers: string[];
  styles: string[];
  transparent: boolean | null;
  dimensions: Record<string, string>;
  encoding: 'kvp' | 'rest' | null;
  uriTemplate: string | null;
  variables: Record<string, unknown>;
  servers: string[];
  mediaType: string;
  /** The zoom levels the service has tiles for, when the catalog says: past the last one, its tiles are enlarged. */
  minZoom?: number;
  maxZoom?: number;
  /** A WMTS's name for each zoom level's tile matrix, when it is not the number. */
  zoomIds?: Record<string, string>;
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
  /** The images of a scene of several (one pass's tiles), drawn together when the server paints them. */
  parts?: ScenePart[];
  /** How the server paints it (its query parameters), when the catalog says. */
  paint?: string;
}

const NO_CONTEXT: AddContext = { tileServerUrls: [] };

/** The address this map loads an entry from: for a raster, what its tile server reads. */
export function addressOf(entry: Pick<CatalogEntry, 'kind' | 'href' | 'serverHref'>): string {
  return entry.kind === 'raster' ? (entry.serverHref ?? entry.href) : entry.href;
}

/** A raster entry in the panel's terms: painted when the catalog says so, an archive by its name, else a COG. */
export function catalogRaster(
  entry: Pick<CatalogEntry, 'kind' | 'href' | 'serverHref' | 'painted' | 'paint'>,
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
    ...(kind === 'painted' && entry.paint ? { paint: entry.paint } : {}),
  };
}

/** Why an entry cannot be added to this map, or null when it can. */
export function whyNotAddable(
  entry: Pick<CatalogEntry, 'kind' | 'href' | 'serverHref' | 'search'> & {
    service?: CatalogService;
    size?: number | null;
    itemsHref?: string | null;
    mediaType?: string;
    cube?: CatalogCube;
  },
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
    case 'features':
      return 'itemsHref' in entry && entry.itemsHref
        ? null
        : 'Features the service gives in no GeoJSON (GML or Esri JSON only): this map cannot read them.';
    case 'zarr':
      return !('cube' in entry) || !entry.cube
        ? 'A data cube without its variables described (STAC datacube): read it with a Zarr query naming one.'
        : context.tileServerUrls.length > 0
          ? null
          : 'A data cube: this map has no tile server to draw it (Raster tile server, in the panel options).';
    case 'geoparquet':
    case 'sensors':
    case 'datastream':
    case 'edr':
      return null;
    case 'vector': {
      const format = vectorFormat(entry);
      // A GeoParquet or a FlatGeobuf is read by area, whatever its size: only what lies over the view.
      if (format === 'pmtiles' || format === 'parquet' || format === 'fgb') {
        return null;
      }
      if (!format) {
        return 'A file this map does not read: read it by query (DuckDB).';
      }
      const size = 'size' in entry ? entry.size : null;
      return typeof size === 'number' && size > MAX_BROWSER_FILE
        ? `${Math.round(size / 1e6)} MB: too large for a browser, read it by query (DuckDB).`
        : null;
    }
    case 'map-service':
      return 'service' in entry &&
        entry.service &&
        !serviceTemplate(entry.service) &&
        serviceNeedsTemplate(entry.service)
        ? 'A WMTS layer without Web Mercator tiles, or given without its template: this map cannot draw it.'
        : null;
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
    services,
    sizes,
    itemsHrefs,
    mediaTypes,
    protocols,
    timeProperties,
    parameterLists,
    geometryFields,
    cubes,
    paints,
    tilesColumn,
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
    'service',
    'size',
    'items_href',
    'media_type',
    'feature_protocol',
    'time_property',
    'parameters',
    'geometry_field',
    'cube',
    'paint',
    'tiles',
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
      ...(typeof paints[i] === 'string' && paints[i] ? { paint: paints[i] as string } : {}),
      ...(typeof tilesColumn[i] === 'string' && tilesColumn[i] ? optional('tiles', parseTiles(tilesColumn[i])) : {}),
      start: time(starts[i]),
      end: time(ends[i]),
      license: String(licenses[i] ?? ''),
      thumbnail: thumbnails[i] ? String(thumbnails[i]) : null,
      bbox: box.every(Number.isFinite) ? (box as [number, number, number, number]) : null,
      ...(hasSeries ? { series: series[i] === 'items' || series[i] === 'search' ? series[i] : null } : {}),
      ...(typeof services[i] === 'string' && services[i] ? { service: parseService(services[i]) } : {}),
      ...(time(sizes[i]) !== null ? { size: time(sizes[i]) } : {}),
      ...(typeof itemsHrefs[i] === 'string' && itemsHrefs[i] ? { itemsHref: itemsHrefs[i] } : {}),
      ...(typeof mediaTypes[i] === 'string' && mediaTypes[i] ? { mediaType: mediaTypes[i] } : {}),
      ...(typeof geometryFields[i] === 'string' && geometryFields[i] ? { geometryField: geometryFields[i] } : {}),
      ...(typeof cubes[i] === 'string' && cubes[i] ? { cube: parseCube(cubes[i]) } : {}),
      ...(protocols[i] === 'wfs' ||
      protocols[i] === 'arcgis' ||
      protocols[i] === 'ogc-features' ||
      protocols[i] === 'socrata'
        ? { featureProtocol: protocols[i] }
        : {}),
      ...(typeof timeProperties[i] === 'string' && timeProperties[i] ? { timeProperty: timeProperties[i] } : {}),
      ...(typeof parameterLists[i] === 'string' && parameterLists[i]
        ? { parameters: parseParameters(parameterLists[i]) }
        : {}),
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
  // A collection of GeoParquet files is listed as one, read by area: its files are not listed apart.
  const parquetCollections = new Set(entries.filter((e) => e.kind === 'geoparquet').map((e) => e.collection));
  for (const entry of entries) {
    if (entry.kind === 'vector' && parquetCollections.has(entry.collection) && vectorFormat(entry) === 'parquet') {
      continue;
    }
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
    (!kind || entry.kind === kind || (kind === 'sensors' && entry.kind === 'datastream')) &&
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
  scenes: Array<{ time: number | null; end: number | null; url: string; item?: string | null; parts?: ScenePart[] }>
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
      ...(scene.parts ? { parts: scene.parts } : {}),
    })),
    ...(painted && scenes[scenes.length - 1].parts ? { parts: scenes[scenes.length - 1].parts } : {}),
    // How the server paints it, as the catalog said when it was added.
    ...(painted && typeof metadata.paint === 'string' && metadata.paint ? { paint: metadata.paint } : {}),
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
  /** Its images, when it is several (one pass's tiles, `raster_group`): `url` is the first. */
  parts?: ScenePart[];
}

/** What a search of a series found: its scenes, oldest first; whether the catalog says they are painted; whether cut. */
export interface SearchedScenes {
  scenes: SearchedScene[];
  painted: boolean | null;
  /** How the server paints them (its query parameters), when the catalog says: `raster_paint`. */
  paint?: string | null;
  truncated: boolean;
}

/** What a searched series is: the target of the data source's STAC search, and the area, saved with the dataset. */
export interface SeriesSearch {
  target: string;
  bbox: [number, number, number, number];
  /** Searched again over the map's view as it moves (`bbox` is then where it was added, the fallback). */
  followView?: boolean;
}

/** Views wider than this (degrees) keep the last area searched: a search's limit would not fill such a mosaic. */
export const MAX_FOLLOW_SPAN = 5;

/**
 * The area a view is searched over: the view widened to a grid of an eighth of its size, so a small pan asks
 * nothing new; null for a view too wide to follow.
 */
export function followedArea(view: [number, number, number, number] | null): [number, number, number, number] | null {
  if (!view) {
    return null;
  }
  const [west, south, east, north] = view;
  const span = Math.max(east - west, north - south);
  if (!(span > 0) || span > MAX_FOLLOW_SPAN) {
    return null;
  }
  const step = span / 8;
  const snap = (value: number, round: (n: number) => number) => Math.round(round(value / step) * step * 1e5) / 1e5;
  return [snap(west, Math.floor), snap(south, Math.floor), snap(east, Math.ceil), snap(north, Math.ceil)];
}

/**
 * The area features are asked over: the followed grid's (`followedArea`), or the view itself, kept to the world and
 * rounded, when it is too wide to follow. A features service answers at most a count, so a wide view costs one
 * request, unlike a search of scenes; the view is rounded to a hundredth so a small pan asks nothing new.
 */
export function featuresArea(view: [number, number, number, number] | null): [number, number, number, number] | null {
  if (!view) {
    return null;
  }
  const near = followedArea(view);
  if (near) {
    return near;
  }
  const [west, south, east, north] = view;
  const round = (value: number, way: (n: number) => number) => way(value * 100) / 100;
  const area: [number, number, number, number] = [
    round(Math.max(-180, west), Math.floor),
    round(Math.max(-85, south), Math.floor),
    round(Math.min(180, east), Math.ceil),
    round(Math.min(85, north), Math.ceil),
  ];
  return area[2] > area[0] && area[3] > area[1] ? area : null;
}

/** A dataset's saved search, or null when it is none. */
export function searchOf(metadata: Record<string, unknown> | undefined): SeriesSearch | null {
  const search = metadata?.catalogSearch as Partial<SeriesSearch> | undefined;
  const bbox = search?.bbox;
  return typeof search?.target === 'string' &&
    Array.isArray(bbox) &&
    bbox.length === 4 &&
    bbox.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? { target: search.target, bbox: bbox as SeriesSearch['bbox'], ...(search.followView ? { followView: true } : {}) }
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
  const paints = column('raster_paint');
  const groups = column('raster_group');
  const boxes = column('raster_bbox');
  const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  const rows = [];
  for (let i = 0; i < frame.length; i++) {
    if (typeof urls[i] !== 'string' || !urls[i]) {
      continue;
    }
    const time = number(times?.[i]);
    const end = number(ends?.[i]);
    rows.push({
      time: time !== null && Number.isFinite(time) ? time : null,
      ...(end !== null && Number.isFinite(end) ? { end } : {}),
      sourceUrl: urls[i] as string,
      itemUrl: typeof items?.[i] === 'string' ? (items[i] as string) : null,
      group: typeof groups?.[i] === 'string' ? (groups[i] as string) : null,
      bbox: parseBox(boxes?.[i]),
    });
  }
  // The pieces of one pass are one scene of several images.
  const scenes: SearchedScene[] = groupScenes(rows)
    .map((scene) => ({
      time: scene.time,
      end: scene.end ?? null,
      url: scene.sourceUrl,
      item: scene.itemUrl,
      ...(scene.parts ? { parts: scene.parts } : {}),
    }))
    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  const flag = painted?.find((value: unknown) => typeof value === 'boolean');
  const paint = paints?.find((value: unknown) => typeof value === 'string' && value !== '');
  return {
    scenes,
    painted: typeof flag === 'boolean' ? flag : null,
    ...(typeof paint === 'string' ? { paint } : {}),
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
  const raster = {
    ...catalogRaster(
      { kind: 'raster', href: newest.url, serverHref: null, painted: found.painted, paint: found.paint },
      context.tileServerUrls
    ),
    ...(newest.parts ? { parts: newest.parts } : {}),
  };
  // Already on the grid the map follows the view on (`followedArea`), so the map's first search is this one.
  const area = bbox;
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
        catalogSearch: { target: entry.search.target, bbox: area, followView: true },
        catalogUid: uid,
      },
    },
  };
}

/** A moment's date as its row and dataset name it: the day, and the minute when it is not midnight. */
export function momentLabel(time: number | null): string {
  if (time === null) {
    return '';
  }
  const iso = new Date(time).toISOString();
  return iso.slice(11, 16) === '00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * One moment a search found, added alone: fixed whatever the date (to compare two), drawn as the series draws it,
 * its pieces together. Saved as any raster is, with where it came from (`catalogMoment`), and not searched again.
 */
export function momentDataset(
  entry: CatalogEntry,
  uid: string,
  context: AddContext,
  scene: SearchedScene,
  painted: boolean | null,
  paint: string | null = null
): SavedRemoteDataset | null {
  if (!entry.search || whyNotAddable(entry, context)) {
    return null;
  }
  const raster = {
    ...catalogRaster({ kind: 'raster', href: scene.url, serverHref: null, painted, paint }, context.tileServerUrls),
    ...(scene.parts ? { parts: scene.parts } : {}),
  };
  const when = scene.time !== null ? new Date(scene.time).toISOString() : 'undated';
  return {
    version: 'v1',
    data: {
      id: `catalog-${entry.search.target}-${when.slice(0, 16).replace(/[:]/g, '')}`,
      label: `${entry.title}, ${momentLabel(scene.time)}`,
      color: [0, 92, 255],
      fields: [],
      allData: [],
      disableDataOperation: true,
      type: raster.kind === 'painted' ? COG_PAINTED_TYPE : 'raster-tile',
      metadata: {
        ...(context.rasterMetadata?.(raster) ?? {}),
        catalogMoment: { target: entry.search.target, time: scene.time },
        catalogUid: uid,
      },
    },
  };
}

/** The `tiles` column's JSON: a PMTiles archive and its service; undefined when it is not one. */
function parseTiles(text: string): CatalogTiles | undefined {
  try {
    const tiles = JSON.parse(text);
    return typeof tiles?.href === 'string' && tiles.href && tiles.service?.protocol === 'pmtiles'
      ? {
          href: tiles.href,
          mediaType: typeof tiles.mediaType === 'string' ? tiles.mediaType : '',
          service: tiles.service,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

/** A key set only when it has a value, so an entry without one keeps no undefined key. */
function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/**
 * A data file's tiles as an entry of their own, a map service the map adds as any (`serviceDataset`): the PMTiles
 * archive, its layers, under the file's title. Null when the file has none.
 */
export function tilesEntry(entry: CatalogEntry): CatalogEntry | null {
  if (!entry.tiles) {
    return null;
  }
  return {
    ...entry,
    id: `${entry.id}:tiles`,
    kind: 'map-service',
    href: entry.tiles.href,
    mediaType: entry.tiles.mediaType,
    service: entry.tiles.service,
    serverHref: null,
    painted: null,
    paint: null,
    tiles: undefined,
    size: null,
  };
}

function parseService(text: string): CatalogService | undefined {
  try {
    const service = JSON.parse(text);
    return service && typeof service.protocol === 'string' ? (service as CatalogService) : undefined;
  } catch {
    return undefined;
  }
}

/** A WMTS needs a tile template: KVP needs its tile matrix set, which only its capabilities say. */
function serviceNeedsTemplate(service: CatalogService): boolean {
  return service.protocol === 'wmts';
}

/** A template's variable's value: as it is, its default, or the last of a list. */
function variableValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length ? variableValue(value[value.length - 1]) : null;
  }
  if (value && typeof value === 'object' && 'default' in value) {
    return variableValue((value as { default: unknown }).default);
  }
  return null;
}

/**
 * The `{z}/{x}/{y}` template a WMTS in REST draws from: its `uriTemplate` (or an href that is one) with its tile
 * matrix, row and column as z, y and x, and its other variables at their values or defaults (a dimension's value
 * when the link gives one). Null for KVP, or a variable left without a value. An XYZ link's own template likewise,
 * `{s}` its first server.
 */
export function serviceTemplate(service: CatalogService, href = ''): string | null {
  const servers = (template: string) =>
    service.servers.length ? template.replace(/\{s\}/g, service.servers[0]) : template;
  if (service.protocol === 'xyz') {
    return servers(href);
  }
  if (service.protocol !== 'wmts') {
    return null;
  }
  const template = service.uriTemplate ?? (/\{TileMatrix\}/.test(href) ? href : null);
  if (!template) {
    return null;
  }
  let unresolved = false;
  const filled = servers(template)
    .replace(/\{TileMatrix\}/g, '{z}')
    .replace(/\{TileRow\}/g, '{y}')
    .replace(/\{TileCol\}/g, '{x}')
    .replace(/\{([A-Za-z_][\w-]*)\}/g, (whole, name: string) => {
      if (['z', 'x', 'y'].includes(name)) {
        return whole;
      }
      const value = variableValue(service.variables[name]) ?? service.dimensions[name] ?? null;
      if (value === null) {
        unresolved = true;
        return whole;
      }
      return encodeURIComponent(value);
    });
  return unresolved ? null : filled;
}

/** A WMS endpoint, bare: kepler and loaders.gl append their own query. */
function bareUrl(url: string): string {
  return url.split('#')[0].split('?')[0];
}

/** Reads a TileJSON (vector or raster) from the browser. */
async function readTileJson(
  url: string
): Promise<{ tiles?: string[]; vector_layers?: unknown[]; minzoom?: number; maxzoom?: number }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} from the TileJSON`);
  }
  return response.json();
}

/**
 * An address kepler can load wherever it fetches from: a path of this Grafana (a catalog's file read through its
 * data source's proxy, `/api/datasources/proxy/…`) made absolute, under Grafana's sub-path when it has one. kepler
 * reads a PMTiles archive's tiles off the page (a worker started from a blob, where a bare path resolves to nothing),
 * so the archive's metadata was read and not one tile asked. Other addresses are left as they are.
 */
export function loadableUrl(href: string, origin: string = globalThis.location?.origin ?? ''): string {
  if (!href.startsWith('/') || href.startsWith('//')) {
    return href;
  }
  const sub = (config.appSubUrl ?? '').replace(/\/+$/, '');
  const path = sub && href !== sub && !href.startsWith(`${sub}/`) ? `${sub}${href}` : href;
  return `${origin}${path}`;
}

/** A PMTiles archive's tile type, from its header (byte 99: 1 is vector, 2–5 are images); null if unread. */
export async function pmtilesKind(url: string, read: typeof fetch = fetch): Promise<'vector' | 'raster' | null> {
  try {
    const response = await read(url, { headers: { Range: 'bytes=0-126' } });
    const header = new Uint8Array(await response.arrayBuffer());
    if (header.length < 100 || String.fromCharCode(...header.slice(0, 7)) !== 'PMTiles') {
      return null;
    }
    return header[99] === 1 ? 'vector' : header[99] >= 2 ? 'raster' : null;
  } catch {
    return null;
  }
}

/**
 * The saved form of a map service entry, as the map draws it: a WMS as kepler's WMS tiles with the entry's layer, an
 * XYZ or a WMTS (its REST template) as the panel's tile template, a TileJSON as vector tiles (it lists vector layers)
 * or a tile template, a PMTiles archive as vector or raster tiles (its layers, or its header, say which). With where
 * it came from (`catalogEntry`, `catalogUid`). No tile server needed: the service draws.
 */
export async function serviceDataset(entry: CatalogEntry, uid: string): Promise<SavedRemoteDataset | null> {
  const service = entry.service;
  if (!service || whyNotAddable(entry)) {
    return null;
  }
  const origin = { catalogEntry: entry.id, catalogUid: uid };
  const id = `catalog-${entry.id}`.replace(/[^\w-]+/g, '-');
  const remote = (type: string, metadata: Record<string, unknown>): SavedRemoteDataset => ({
    version: 'v1',
    data: {
      id,
      label: entry.title,
      color: [0, 92, 255],
      type,
      fields: [],
      allData: [],
      disableDataOperation: true,
      metadata: { ...metadata, ...origin },
    },
  });
  const tiles = (url: string, zoom: { minZoom?: number; maxZoom?: number } = {}) => {
    const levels = Object.fromEntries(Object.entries(zoom).filter(([, value]) => typeof value === 'number'));
    const saved = xyzSavedDataset(id, entry.title, {
      url,
      ...levels,
      ...(service.zoomIds ? { zoomIds: service.zoomIds } : {}),
    });
    return { ...saved, data: { ...saved.data, metadata: { ...saved.data.metadata, ...origin } } };
  };
  switch (service.protocol) {
    case 'wms': {
      const url = bareUrl(entry.href);
      const layer = service.layers.join(',');
      return remote('wms-tile', {
        type: 'remote',
        remoteTileFormat: 'wms',
        tilesetDataUrl: url,
        tilesetMetadataUrl: `${url}?service=WMS&request=GetCapabilities`,
        layers: [{ name: layer, title: entry.title, boundingBox: null, queryable: true }],
        version: '1.3.0',
        // The layer to draw, once kepler has read the service's own list (`useCatalogSeries`).
        catalogWmsLayer: layer,
      });
    }
    case 'xyz':
    case 'wmts': {
      const template = serviceTemplate(service, entry.href);
      return template ? tiles(template, { minZoom: service.minZoom, maxZoom: service.maxZoom }) : null;
    }
    case 'tilejson': {
      const tilejson = await readTileJson(entry.href);
      const first = tilejson.tiles?.[0];
      if (!first) {
        return null;
      }
      return Array.isArray(tilejson.vector_layers) && tilejson.vector_layers.length > 0
        ? remote('vector-tile', {
            type: 'remote',
            remoteTileFormat: 'mvt',
            tilesetDataUrl: first,
            tilesetMetadataUrl: entry.href,
          })
        : tiles(first, { minZoom: tilejson.minzoom, maxZoom: tilejson.maxzoom });
    }
    case 'pmtiles': {
      const url = loadableUrl(entry.href);
      const kind = service.layers.length > 0 ? 'vector' : await pmtilesKind(url);
      if (kind === 'vector') {
        // Both addresses, as kepler's own Tileset form saves them: without `tilesetMetadataUrl` kepler reads no
        // metadata (refreshVectorTileMetadata gives up) and the layer stays "Loading…", asking for no tile.
        return remote('vector-tile', {
          type: 'remote',
          remoteTileFormat: 'pmtiles',
          tilesetDataUrl: url,
          tilesetMetadataUrl: url,
        });
      }
      return kind === 'raster' ? remote('raster-tile', { metadataUrl: url, pmtilesType: 'raster' }) : null;
    }
    case 'arcgis-image':
      // The panel's own ArcGIS layer (`esriImageLayer.ts`), which asks the service a picture of each tile.
      return remote('esriImage', { serviceUrl: entry.href });
    default:
      return null;
  }
}

/** How a map service is named in the list. */
export function serviceLabel(service: CatalogService): string {
  return service.protocol === 'arcgis-image' ? 'ArcGIS' : service.protocol.toUpperCase();
}

/** The largest file a browser is asked to load whole; larger ones are read by query, filtered where they are. */
export const MAX_BROWSER_FILE = 50e6;

/** What kepler reads a vector file as (its loaders), from the name, or null for a file it does not read. */
export function vectorFormat(entry: Pick<CatalogEntry, 'href'> & { mediaType?: string }): string | null {
  const name = entry.href.split('?')[0].split('#')[0].toLowerCase();
  const byName: Array<[RegExp, string]> = [
    [/\.pmtiles$/, 'pmtiles'],
    [/\.(geojson|json)$/, 'geojson'],
    [/\.(geojsonl|ndjson)$/, 'geojsonl'],
    [/\.(csv|tsv)$/, 'csv'],
    [/\.(parquet|geoparquet)$/, 'parquet'],
    [/\.(arrow|feather)$/, 'arrow'],
    [/\.fgb$/, 'fgb'],
    [/\.kml$/, 'kml'],
    [/\.gpx$/, 'gpx'],
    [/\.shp$/, 'shp'],
  ];
  const found = byName.find(([pattern]) => pattern.test(name));
  if (found) {
    return found[1];
  }
  const type = (entry.mediaType ?? '').toLowerCase();
  const byType: Array<[string, string]> = [
    ['pmtiles', 'pmtiles'],
    ['geo+json', 'geojson'],
    ['text/csv', 'csv'],
    ['parquet', 'parquet'],
    ['arrow', 'arrow'],
    ['flatgeobuf', 'fgb'],
    ['kml', 'kml'],
    ['gpx', 'gpx'],
    ['shapefile', 'shp'],
  ];
  return byType.find(([t]) => type.includes(t))?.[1] ?? null;
}

/** What a query reads a vector file with in DuckDB, for an entry the map does not load itself. */
export function vectorQuery(entry: Pick<CatalogEntry, 'href' | 'serverHref'> & { mediaType?: string }): string {
  const where = entry.serverHref ?? entry.href;
  const format = vectorFormat(entry);
  return format === 'parquet'
    ? `SELECT * FROM read_parquet('${where}')`
    : format === 'csv'
      ? `SELECT * FROM read_csv('${where}')`
      : `SELECT * FROM ST_Read('${where}')`;
}

/**
 * A features request's address for an area, a time range (when the entry has time) and a limit: an OGC API
 * collection's items, a WFS's GetFeature or an ArcGIS layer's query (see `featureRequests.ts`).
 */
export function featuresUrl(
  target: FeatureTarget,
  area: [number, number, number, number] | null,
  range: { from: number; to: number } | null,
  limit: number
): string {
  return featureRequestUrl(target, area, range, limit);
}

/** Features a map loads at once from a catalog: the first ones the service gives over the view. */
export const FEATURES_LIMIT = 2000;

/**
 * What a features dataset is asked again with: its service and address, area (when it follows the view), time
 * (when it has one) and limit.
 */
export interface FeaturesSearch extends FeatureTarget {
  bbox: [number, number, number, number];
  followView: boolean;
  /** Whether the entry has time, so the dashboard's time range is asked too. */
  time: boolean;
  limit: number;
}

/**
 * The features search a dataset added from a catalog is loaded by, read off its address: kepler keeps nothing of a
 * file dataset's metadata but its address (and format), and the address is the whole search, its service, area,
 * time and limit. Null for any other dataset: one not added from a catalog (its id), or not over an area.
 */
export function featuresOfSource(id: string, source: unknown): FeaturesSearch | null {
  if (!id.startsWith('catalog-') || typeof source !== 'string') {
    return null;
  }
  const read = readFeatureRequest(source);
  if (!read?.bbox) {
    return null;
  }
  return {
    ...read.target,
    bbox: read.bbox,
    followView: true,
    time: read.time,
    limit: read.limit ?? FEATURES_LIMIT,
  };
}

/** A dataset's saved features search, or null. */
export function featuresOf(metadata: Record<string, unknown> | undefined): FeaturesSearch | null {
  const f = metadata?.catalogFeatures as Partial<FeaturesSearch> | undefined;
  return typeof f?.itemsHref === 'string' && Array.isArray(f.bbox) && f.bbox.length === 4
    ? {
        protocol:
          f.protocol === 'wfs' || f.protocol === 'arcgis' || f.protocol === 'socrata' ? f.protocol : 'ogc-features',
        ...(typeof f.geometryField === 'string' ? { geometryField: f.geometryField } : {}),
        itemsHref: f.itemsHref,
        timeProperty: typeof f.timeProperty === 'string' ? f.timeProperty : null,
        bbox: f.bbox as FeaturesSearch['bbox'],
        followView: f.followView !== false,
        time: f.time === true,
        limit: typeof f.limit === 'number' ? f.limit : FEATURES_LIMIT,
      }
    : null;
}

/**
 * Whether a features entry has time: a WFS by the property the catalog names, an ArcGIS layer by its time field,
 * an OGC API collection by its temporal extent.
 */
export function featuresHaveTime(entry: CatalogEntry): boolean {
  return entry.featureProtocol === 'wfs' || entry.featureProtocol === 'arcgis' || entry.featureProtocol === 'socrata'
    ? Boolean(entry.timeProperty)
    : entry.start !== null || entry.end !== null;
}

/** How a features entry is named in the list: its service, and what of it. */
export function featuresLabel(entry: CatalogEntry): string[] {
  return entry.featureProtocol === 'wfs'
    ? ['WFS', entry.id.includes(':wfs:') ? entry.id.split(':wfs:').pop()! : entry.id]
    : entry.featureProtocol === 'arcgis'
      ? ['ArcGIS', entry.collectionTitle]
      : entry.featureProtocol === 'socrata'
        ? ['Socrata', entry.collectionTitle]
        : ['OGC API Features', entry.collection];
}

/**
 * The saved form of a features entry added to a map: kepler loads its features as GeoJSON from the address of the
 * view's area and the dashboard's time range (when the entry has time), and the map asks again when either moves
 * (`useCatalogSeries`), keeping the layer. The same for an OGC API collection, a WFS type and an ArcGIS layer.
 */
export function featuresDataset(
  entry: CatalogEntry,
  uid: string,
  area: [number, number, number, number],
  range: { from: number; to: number } | null
): SavedRemoteDataset | null {
  if (entry.kind !== 'features' || !entry.itemsHref) {
    return null;
  }
  const time = featuresHaveTime(entry);
  const search: FeaturesSearch = {
    protocol: entry.featureProtocol ?? 'ogc-features',
    itemsHref: entry.itemsHref,
    timeProperty: entry.timeProperty ?? null,
    ...(entry.geometryField ? { geometryField: entry.geometryField } : {}),
    bbox: area,
    followView: true,
    time,
    limit: FEATURES_LIMIT,
  };
  return {
    version: 'v1',
    data: {
      id: `catalog-${entry.id}`.replace(/[^\w-]+/g, '-'),
      label: entry.title,
      color: [0, 92, 255],
      type: 'externally-hosted',
      fields: [],
      allData: [],
      metadata: {
        source: featuresUrl(search, area, time ? range : null, FEATURES_LIMIT),
        format: 'geojson',
        catalogFeatures: search,
        catalogEntry: entry.id,
        catalogUid: uid,
      },
    },
  };
}

/** The saved form of a vector file a map loads whole by its address (kepler reads it), or a PMTiles archive. */
/**
 * Whether a browser may read a file: its server answers this page (CORS), redirects included. Files a catalog of
 * records links to often live where only a server may read them (HDX's downloads redirect to storage that allows
 * its own site alone); those are read by query instead of failing on the map. Any answer, even an error, is yes:
 * only a refused request is no.
 */
export async function readableHere(url: string, read: typeof fetch = fetch): Promise<boolean> {
  try {
    await read(url, { method: 'HEAD' });
    return true;
  } catch {
    return false;
  }
}

export async function vectorDataset(entry: CatalogEntry, uid: string): Promise<SavedRemoteDataset | null> {
  const format = vectorFormat(entry);
  if (entry.kind !== 'vector' || !format || whyNotAddable(entry)) {
    return null;
  }
  if (format === 'pmtiles') {
    return serviceDataset({ ...entry, kind: 'map-service', service: { ...NO_SERVICE, protocol: 'pmtiles' } }, uid);
  }
  return {
    version: 'v1',
    data: {
      id: `catalog-${entry.id}`.replace(/[^\w-]+/g, '-'),
      label: entry.title,
      color: [0, 92, 255],
      type: 'externally-hosted',
      fields: [],
      allData: [],
      metadata: { source: entry.href, format, catalogEntry: entry.id, catalogUid: uid },
    },
  };
}

const NO_SERVICE: CatalogService = {
  protocol: 'xyz',
  layers: [],
  styles: [],
  transparent: null,
  dimensions: {},
  encoding: null,
  uriTemplate: null,
  variables: {},
  servers: [],
  mediaType: '',
};

/** Rows a map loads from a GeoParquet over its view, at most. */
export const PARQUET_LAYER_LIMIT = 100_000;
/** Sensors a sensors layer shows at most. */
const SENSORS_LAYER_LIMIT = 2000;
/** Values an EDR layer reads at most. */
const EDR_LAYER_LIMIT = 50_000;

/** Features a map loads from a FlatGeobuf over its view, at most. */
const FLATGEOBUF_LAYER_LIMIT = 20_000;
/** A FlatGeobuf this small, said so by the catalog, is loaded whole, as other files: it may have no index. */
const FLATGEOBUF_WHOLE_MAX = 10e6;

/** Whether an entry is a FlatGeobuf read by area, through its spatial index: one not known to be small. */
export function readsFlatGeobuf(
  entry: Pick<CatalogEntry, 'kind' | 'href'> & { mediaType?: string; size?: number | null }
): boolean {
  return (
    entry.kind === 'vector' &&
    vectorFormat(entry) === 'fgb' &&
    !(typeof entry.size === 'number' && entry.size <= FLATGEOBUF_WHOLE_MAX)
  );
}

/** Whether an entry is read by area: a GeoParquet (a collection of such files, or one), or a FlatGeobuf. */
export function readsByArea(
  entry: Pick<CatalogEntry, 'kind' | 'href'> & { mediaType?: string; size?: number | null }
): boolean {
  return (
    entry.kind === 'geoparquet' ||
    (entry.kind === 'vector' && vectorFormat(entry) === 'parquet') ||
    readsFlatGeobuf(entry)
  );
}

/** Whether an entry is added as a layer the data source reads over the view: GeoParquet, sensors, EDR. */
export function readsByQuery(
  entry: Pick<CatalogEntry, 'kind' | 'href'> & { mediaType?: string; size?: number | null }
): boolean {
  return readsByArea(entry) || entry.kind === 'sensors' || entry.kind === 'datastream' || entry.kind === 'edr';
}

/** EDR parameters a map asks of a collection added from the catalog: its first few (all would be heavy). */
const EDR_LAYER_PARAMETERS = 3;

/**
 * An entry added to a map as a layer the catalog data source reads over its view: a GeoParquet (by area), sensors
 * (their last value in the time range), an EDR collection (its first parameters over the area in the time range).
 */
export function parquetLayer(
  entry: CatalogEntry,
  uid: string,
  area: [number, number, number, number]
): SavedCatalogLayer {
  const base = {
    id: `catalog-${entry.id}`.replace(/[^\w-]+/g, '-'),
    label: entry.title,
    uid,
    columns: [],
    bbox: area,
    followView: true,
  };
  if (entry.kind === 'sensors' || entry.kind === 'datastream') {
    return { ...base, target: entry.id, queryType: 'sensors' };
  }
  if (entry.kind === 'edr') {
    const parameters = (entry.parameters ?? []).slice(0, EDR_LAYER_PARAMETERS).map((p) => p.id);
    return { ...base, target: entry.id, queryType: 'edr', parameters };
  }
  if (readsFlatGeobuf(entry)) {
    return { ...base, target: entry.id, queryType: 'flatgeobuf' };
  }
  return { ...base, target: entry.kind === 'geoparquet' ? entry.collection : entry.id };
}

/** What a file read by area is: its format, and its size. */
export function byAreaLabel(entry: CatalogEntry): string[] {
  return [
    readsFlatGeobuf(entry) ? 'FlatGeobuf' : 'GeoParquet',
    'read by area',
    typeof entry.size === 'number'
      ? entry.size >= 1e9
        ? `${(entry.size / 1e9).toFixed(entry.size < 1e10 ? 1 : 0)} GB`
        : `${Math.round(entry.size / 1e6)} MB`
      : '',
    // Its PMTiles, a second way to add it (the Tiles button).
    ...(entry.tiles ? ['and tiles'] : []),
  ];
}

/** What a sensors or EDR layer is: its service, and what of it. */
export function measuresLabel(entry: CatalogEntry): string[] {
  return entry.kind === 'edr'
    ? ['EDR', (entry.parameters ?? []).length ? `${entry.parameters!.length} parameters` : '', 'over the view']
    : ['SensorThings', entry.kind === 'sensors' ? 'last values over the view' : entry.collectionTitle];
}

/** The cube column of an entry, as JSON. */
function parseCube(text: string): CatalogCube | undefined {
  try {
    const cube = JSON.parse(text);
    return typeof cube?.storeUrl === 'string' && typeof cube?.variable === 'string' ? cube : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A data cube's variable added to a map: the panel's own Zarr layer (TiTiler renders its tiles), saved like a
 * tileset, and the variable it came from (`catalogZarr`), whose moments the map asks the data source for in each
 * time range (`useCatalogZarr`).
 */
export function zarrDataset(entry: CatalogEntry, uid: string, context: AddContext): SavedRemoteDataset | null {
  const cube = entry.cube;
  const serverUrl = context.tileServerUrls[0];
  if (entry.kind !== 'zarr' || !cube || !serverUrl) {
    return null;
  }
  return {
    version: 'v1',
    data: {
      id: `catalog-${entry.id}`.replace(/[^\w-]+/g, '-'),
      label: entry.title,
      color: [0, 92, 255],
      type: ZARR_TILES_TYPE,
      fields: [],
      allData: [],
      disableDataOperation: true,
      metadata: {
        serverUrl,
        storeUrl: cube.storeUrl,
        variable: cube.variable,
        selectors: cube.selectors,
        ...(cube.dimension ? { dimension: cube.dimension } : {}),
        colormap: 'viridis',
        catalogZarr: entry.id,
        catalogEntry: entry.id,
        catalogUid: uid,
      },
    },
  };
}

/** What a data cube entry is, for its row. */
export function cubeLabel(entry: CatalogEntry): string[] {
  return ['Zarr', entry.cube?.variable ?? '', entry.collectionTitle];
}

/**
 * A data cube variable's moments in a time range, and its ramp's range over an area, through its catalog's data
 * source (the Zarr query): the frame the panel reads a Zarr from.
 */
export async function readCatalogZarr(
  uid: string,
  target: string,
  serverUrl: string,
  area: [number, number, number, number] | null,
  timeRange: { from: number; to: number }
): Promise<DataFrame | undefined> {
  const ds = await getDataSourceSrv().get({ uid });
  const from = dateTime(timeRange.from);
  const to = dateTime(timeRange.to);
  const request = {
    targets: [
      { refId: 'zarr', queryType: 'zarr', entries: [target], serverUrl, ...(area ? { bbox: area.join(',') } : {}) },
    ],
    range: { from, to, raw: { from, to } },
    scopedVars: {},
    requestId: `catalog-zarr-${target}`,
    interval: '1m',
    intervalMs: 60_000,
    timezone: 'utc',
    app: 'panel',
    startTime: Date.now(),
  } as unknown as DataQueryRequest;
  const reply = ds.query(request) as unknown;
  const response = (isObservable(reply) ? await lastValueFrom(reply) : await reply) as DataQueryResponse;
  if (response.errors?.length) {
    throw new Error(response.errors[0].message ?? 'The read failed');
  }
  return response.data?.[0];
}

/** The parameters column of an entry, as JSON. */
function parseParameters(text: string): CatalogEntry['parameters'] {
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list : undefined;
  } catch {
    return undefined;
  }
}

/** A catalog layer's rows over an area, through its catalog's data source (a `parquet`, `flatgeobuf`, `sensors` or `edr` query). */
export async function readParquetLayer(
  layer: SavedCatalogLayer,
  area: [number, number, number, number],
  timeRange?: { from: number; to: number }
): Promise<DataFrame | undefined> {
  const ds = await getDataSourceSrv().get({ uid: layer.uid });
  const now = dateTime();
  const from = timeRange ? dateTime(timeRange.from) : now;
  const to = timeRange ? dateTime(timeRange.to) : now;
  const type = layer.queryType ?? 'parquet';
  const target =
    type === 'sensors'
      ? { queryType: 'sensors', entries: [layer.target], bbox: area.join(','), limit: SENSORS_LAYER_LIMIT }
      : type === 'flatgeobuf'
        ? { queryType: 'flatgeobuf', entries: [layer.target], bbox: area.join(','), limit: FLATGEOBUF_LAYER_LIMIT }
        : type === 'edr'
          ? {
              queryType: 'edr',
              entries: [layer.target],
              bbox: area.join(','),
              edrMode: 'area',
              parameters: (layer.parameters ?? []).join(','),
              limit: EDR_LAYER_LIMIT,
            }
          : {
              queryType: 'parquet',
              entries: [layer.target],
              bbox: area.join(','),
              columns: layer.columns.join(','),
              limit: PARQUET_LAYER_LIMIT,
            };
  const request = {
    targets: [{ refId: layer.id, ...target }],
    range: { from, to, raw: { from, to } },
    scopedVars: {},
    requestId: `catalog-layer-${layer.id}`,
    interval: '1m',
    intervalMs: 60_000,
    timezone: 'utc',
    app: 'panel',
    startTime: Date.now(),
  } as unknown as DataQueryRequest;
  const reply = ds.query(request) as unknown;
  const response = (isObservable(reply) ? await lastValueFrom(reply) : await reply) as DataQueryResponse;
  if (response.errors?.length) {
    throw new Error(response.errors[0].message ?? 'The read failed');
  }
  return response.data?.[0];
}
