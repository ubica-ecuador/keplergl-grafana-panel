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
  /** The cloud-optimised GeoTIFF currently being drawn. */
  cogUrl: string;
  /** Where the tile server describes that COG as a STAC Item. */
  metadataUrl: string;
  /** Tile servers kepler may draw from, in the order it should try them. */
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

/** One dated image in a raster query's result. */
export interface RasterScene {
  /** Capture time in epoch ms, or null when the query carries no time column. */
  time: number | null;
  cogUrl: string;
}

/** A time window, in epoch ms — kepler's time filter, as the panel reads it. */
export interface SceneWindow {
  from: number;
  to: number;
}

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
  const dated = scenes.filter((scene): scene is RasterScene & { time: number } => scene.time !== null);
  if (dated.length === 0) {
    return scenes[0] ?? null;
  }
  if (!window) {
    return dated[dated.length - 1];
  }

  let picked: RasterScene | null = null;
  for (const scene of dated) {
    if (scene.time >= window.from && scene.time <= window.to) {
      picked = scene;
    }
  }
  return picked;
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
  if (scene.cogUrl === raster.cogUrl) {
    return raster;
  }
  return {
    ...raster,
    cogUrl: scene.cogUrl,
    metadataUrl: metadataUrlFor(raster.tileServerUrls[0], scene.cogUrl),
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
  opts: { tileServerUrls: string[]; colormap?: string }
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

    const scenes = readScenes(frame, roles.rasterUrl, roles.time);
    // No window yet: the freshest scene is the sensible thing to open on, and
    // the time filter moves it the moment there is one.
    const opening = pickScene(scenes, null);
    if (!opening) {
      return;
    }

    rasters.push({
      id: rasterDatasetId(refId),
      label: frame.name ?? `Query ${refId}`,
      cogUrl: opening.cogUrl,
      metadataUrl: metadataUrlFor(opts.tileServerUrls[0], opening.cogUrl),
      tileServerUrls: opts.tileServerUrls,
      ...(opts.colormap ? { colormap: opts.colormap } : {}),
      scenes,
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
    scenes.push({ time: Number.isFinite(raw) ? raw : null, cogUrl: url.trim() });
  }

  return scenes.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}
