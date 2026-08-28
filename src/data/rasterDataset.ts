import { DataFrame } from '@grafana/data';

import { detectFields, FieldRoleOverrides, resolveRoles } from './detectFields';
import { pickLatestWithin, type TimeWindow } from './timeWindow';

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
  /** How the imagery reaches the map — see {@link RasterKind}. */
  kind: RasterKind;
  /** The image currently being drawn: a COG, or a PMTiles archive. */
  sourceUrl: string;
  /**
   * What kepler asks for the imagery's shape.
   *
   * For a COG that is the tile server's STAC document about it; for a PMTiles
   * archive it is the archive itself, which carries its own header.
   */
  metadataUrl: string;
  /**
   * Tile servers kepler may draw from, in the order it should try them.
   *
   * Empty for a PMTiles archive, and not for want of configuration: kepler
   * reads that format itself and never asks a server anything.
   */
  tileServerUrls: string[];
  /**
   * Colour ramp for the layer, or undefined to leave kepler's default alone.
   *
   * Worth choosing rather than accepting: the default is `cfastie`, a palette
   * built for drone NDVI, and it is not monotonic — it steps through black,
   * grey, white, green, yellow, red and magenta. On a continuous field like
   * rainfall neighbouring cells of similar value land on unrelated colours, and
   * the map reads as confetti rather than as weather.
   */
  colormap?: string;
  /**
   * Every scene the query returned, oldest first.
   *
   * One row per pass of the satellite makes the query a small catalogue rather
   * than a single answer, and then the map's time filter decides which of them
   * is on screen. Carrying the whole series means moving that filter costs
   * nothing: the choice is made in the browser, against a list already here.
   */
  scenes: RasterScene[];
}

/**
 * How a raster's imagery reaches the map.
 *
 * `cog` is a GeoTIFF a tile server cuts into tiles on demand — the imagery
 * stays as it was measured, so the map can restyle it live: change the ramp,
 * move the range, pick another band. It needs that server to be reachable, and
 * to be able to reach the imagery.
 *
 * `pmtiles` is an archive of tiles already drawn, which kepler reads directly
 * over range requests. Nothing sits in between, which is what makes it the
 * answer for an install with nowhere to run a server — but the colours were
 * decided when the archive was built, so the layer panel offers only opacity.
 *
 * `painted` is the same GeoTIFF as `cog`, drawn by the tile server instead of
 * by the browser. kepler's own raster layer fetches raw arrays and colours them
 * in a shader, which suits imagery and cannot draw a *classified* raster at
 * all: measured on a nine-class land-cover COG, values 1-11 get rescaled over
 * the whole `uint8` range and every class lands on the same colour, so the map
 * draws one flat slab. Asking the server for a PNG lets it read the palette the
 * file carries. The cost is the PMTiles cost — the colours are decided before
 * they arrive, so the layer panel offers only opacity.
 *
 * Which of the first two a query means is read off its url, the same way kepler
 * reads it: the format is a property of the file, not a setting to keep in step
 * with it. `painted` is the exception, because it is not a property of the file
 * but a decision about how to draw it, so it comes from a panel option.
 */
export type RasterKind = 'cog' | 'pmtiles' | 'painted';

/** One dated image in a raster query's result. */
export interface RasterScene {
  /** Capture time in epoch ms, or null when the query carries no time column. */
  time: number | null;
  sourceUrl: string;
}

/**
 * A time window, in epoch ms — kepler's time filter, as the panel reads it.
 *
 * An alias rather than a second declaration: the WMS path walks the same clock
 * with the same rule, so the rule and its window live in one place now.
 */
export type SceneWindow = TimeWindow;

/**
 * The scene a time window selects: the most recent one it contains.
 *
 * "Most recent inside the window" rather than "nearest" on purpose. Dragging
 * the end of the slider back through the calendar should show what was on the
 * ground at that moment, and a scene captured after it was not.
 *
 * Undated scenes cannot be placed on the calendar, so a query without a time
 * column keeps its old meaning: the first row is the answer. That is the
 * ordinary case — `ORDER BY … LIMIT 1` in SQL — and it must not change
 * behaviour because a timeline exists elsewhere.
 */
export function pickScene(scenes: RasterScene[], window: SceneWindow | null): RasterScene | null {
  const dated = scenes.some((scene) => scene.time !== null);
  if (!dated) {
    return scenes[0] ?? null;
  }
  return pickLatestWithin(scenes, (scene) => scene.time, window);
}

/**
 * The same raster dataset, re-pointed at whichever scene a window selects.
 *
 * Returns null when the window contains no scene at all, which is a real state
 * and not an error: the satellite did not pass in those days, so there is
 * nothing to draw and the caller drops the layer.
 *
 * The id is deliberately preserved, so what reaches kepler is a replacement of
 * the dataset already on the map — the layer, and whatever the user styled on
 * it, survive the change of scene.
 */
export function rasterForWindow(raster: RasterDataset, window: SceneWindow | null): RasterDataset | null {
  const scene = pickScene(raster.scenes, window);
  if (!scene) {
    return null;
  }
  if (scene.sourceUrl === raster.sourceUrl) {
    return raster;
  }
  return {
    ...raster,
    sourceUrl: scene.sourceUrl,
    metadataUrl: metadataUrlForScene(raster.kind, raster.tileServerUrls[0], scene.sourceUrl),
  };
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
 * A query that returns one row describes one scene, which is the ordinary case.
 * A query that returns many *dated* rows describes a catalogue, and the map's
 * time filter picks from it — see {@link pickScene}. Either way exactly one
 * scene is drawn: a table of ten is a choice still to be made, never ten layers
 * to stack.
 */
export function framesToRasters(
  frames: DataFrame[],
  overrides: Record<string, FieldRoleOverrides> = {},
  opts: { tileServerUrls: string[]; colormap?: string; painted?: boolean }
): RasterDataset[] {
  const rasters: RasterDataset[] = [];

  frames.forEach((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    const roles = resolveRoles(detectFields(frame), overrides[refId]);
    if (!roles.rasterUrl) {
      return;
    }

    const scenes = readScenes(frame, roles.rasterUrl, roles.time);
    // No window yet: the freshest scene is the sensible thing to open on, and
    // the time filter moves it the moment there is one.
    const opening = pickScene(scenes, null);
    if (!opening) {
      return;
    }

    // A COG with nowhere to be served is dropped here, on its own. Left in,
    // kepler's `getTitilerUrl` throws 'No raster tile servers' from inside the
    // layer's tile fetch, where it surfaces as a layer that draws nothing
    // rather than as anything anyone can act on. An archive beside it is
    // unaffected: it never wanted a server.
    const kind = rasterKind(opening.sourceUrl, opts.painted);
    if (kind !== 'pmtiles' && opts.tileServerUrls.length === 0) {
      return;
    }

    rasters.push({
      id: rasterDatasetId(refId),
      label: frame.name ?? `Query ${refId}`,
      kind,
      sourceUrl: opening.sourceUrl,
      metadataUrl: metadataUrlForScene(kind, opts.tileServerUrls[0], opening.sourceUrl),
      tileServerUrls: kind === 'pmtiles' ? [] : opts.tileServerUrls,
      ...(opts.colormap ? { colormap: opts.colormap } : {}),
      scenes,
    });
  });

  return rasters;
}

/**
 * What a raster url is, read the way kepler reads it.
 *
 * By extension rather than by configuration, and `includes` rather than
 * `endsWith` because a signed link carries a query string of its own. This is
 * `isPMTilesUrl` from `@kepler.gl/common-utils`, spelled out here so the pure
 * data modules stay free of kepler imports — the panel would otherwise drag
 * deck.gl into the main chunk to answer a question about a file name.
 */
export function rasterKind(url: string, painted = false): RasterKind {
  if (url.includes('.pmtiles')) {
    // An archive is already drawn tiles: it never wanted a server, and routing
    // it through one would ask for a COG that does not exist.
    return 'pmtiles';
  }
  return painted ? 'painted' : 'cog';
}

/** Where kepler should ask about a scene, given how that scene is served. */
function metadataUrlForScene(kind: RasterKind, tileServerUrl: string | undefined, sourceUrl: string): string {
  // Neither an archive nor a painted COG has a STAC document in the picture:
  // the first carries its own header, and the second is addressed by url alone.
  // So for both the image *is* the identity a refresh compares on.
  return kind === 'pmtiles' || kind === 'painted' ? sourceUrl : metadataUrlFor(tileServerUrl ?? '', sourceUrl);
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
export function metadataUrlFor(tileServerUrl: string, sourceUrl: string): string {
  const base = tileServerUrl.replace(/\/+$/, '');
  return `${base}/cog/stac?url=${encodeURIComponent(sourceUrl)}`;
}

/**
 * The scenes a frame describes, oldest first.
 *
 * Rows with no usable url are skipped rather than carried as holes: a scene
 * without a link to imagery is not a scene. Sorting here rather than trusting
 * the query's ORDER BY means the window logic can assume an ordering it did not
 * have to ask for.
 */
function readScenes(frame: DataFrame, urlColumn: string, timeColumn?: string): RasterScene[] {
  const urls = frame.fields.find((f) => f.name === urlColumn);
  if (!urls) {
    return [];
  }
  const times = timeColumn ? frame.fields.find((f) => f.name === timeColumn) : undefined;

  const scenes: RasterScene[] = [];
  for (let i = 0; i < frame.length; i++) {
    const url = urls.values[i];
    if (typeof url !== 'string' || !url.trim()) {
      continue;
    }
    const raw = times ? Number(times.values[i]) : NaN;
    scenes.push({ time: Number.isFinite(raw) ? raw : null, sourceUrl: url.trim() });
  }

  return scenes.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}
