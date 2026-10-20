/**
 * A dataset kepler holds by URL rather than by rows.
 *
 * Structurally kepler's `SavedDatasetV1`, declared here rather than imported so
 * this module — which the options editor pulls into the eager bundle — stays
 * free of kepler.
 */
export interface SavedRemoteDataset {
  version: string;
  data: {
    id: string;
    label?: string;
    color?: number[];
    /** One of {@link REMOTE_DATASET_TYPES}; what makes the dataset restorable. */
    type: string;
    /** Where the tiles live: `tilesetDataUrl`, `imageUrl`, `tile3dUrl`, … */
    metadata?: Record<string, unknown>;
    fields?: unknown[];
    /** Always empty: these datasets carry no rows. */
    allData?: unknown[][];
    disableDataOperation?: boolean;
  };
}

/**
 * The dataset types whose whole content is a URL — kepler's Add Data → Tileset
 * form produces exactly these five.
 *
 * Mirrors `DatasetType` in `@kepler.gl/constants`, minus `local`. A dataset the
 * panel built from a query has `type: ''` and a file dropped into Add Data has
 * `local`; neither is here, so neither is ever written into the dashboard JSON —
 * the first because the queries rebuild it, the second because persisting it
 * would mean embedding its rows.
 */
export const REMOTE_DATASET_TYPES = ['vector-tile', 'raster-tile', 'wms-tile', 'tile-3d', 'bitmap'];

/** The map's name and description, as kepler's `info` carries them. */
export interface SavedMapInfo {
  title?: string;
  description?: string;
}

/** A kepler saved config: `{version, config}`, as produced by `getConfigToSave`. */
export interface SavedMapConfig {
  version: string;
  config: Record<string, unknown>;
  /**
   * The URL-backed datasets the config's layers are built on.
   *
   * kepler's own `{version, config}` has no room for datasets — its layers name
   * a `dataId` and the host application is expected to supply the data. That
   * works for the panel's queries, which re-run on every load, but not for a
   * tileset added inside kepler: it lives only in kepler's store, so without
   * this the layer came back pointing at nothing and silently disappeared.
   *
   * kepler ignores the key (`parseSavedConfig` reads `version` and `config`
   * only), so a config carrying it is still a config kepler can parse.
   */
  datasets?: SavedRemoteDataset[];
  /**
   * The map's name and description, **Interactions → Map info** in kepler.
   *
   * `getConfigToSave` leaves them out: kepler keeps them in the vis state but
   * exports them only as the `info` of a whole map, `{datasets, config, info}`,
   * and `addDataToMap` takes them back as an `info` of its own. Without this a
   * map lost its name and description on every load. Absent when the map has
   * neither, so a config saved without them is unchanged.
   */
  info?: SavedMapInfo;
}

/**
 * Reads a kepler map configuration out of pasted JSON.
 *
 * Accepts both shapes users actually have to hand:
 *
 * - the bare saved config, `{version, config}`
 * - a full exported map, `{datasets, config, info}` — what kepler's "Export map"
 *   and Dekart produce. Only the config half, the URL-backed datasets and the
 *   map's name and description are kept; the rest of the data comes from the
 *   panel's own queries.
 *
 * Returns null rather than throwing, so a typo in a textarea cannot take the
 * panel down.
 */
export function parseMapConfigJson(text: string): SavedMapConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  // A full exported map nests the saved config under `config` and keeps its
  // datasets and info as siblings.
  if (isSavedConfig(parsed.config)) {
    return cleanSavedConfig(parsed.config, parsed.datasets, parsed.info);
  }

  // The bare saved config — including one this panel wrote, whose datasets and
  // info are already siblings of `config` rather than of the wrapper.
  return isSavedConfig(parsed) ? cleanSavedConfig(parsed, parsed.datasets, parsed.info) : null;
}

/**
 * The name and description in `value`, when it has either, and nothing else.
 *
 * An export's `info` carries more — kepler's own `save` adds `app` and
 * `created_at` — and none of it belongs in the dashboard JSON.
 */
export function keepMapInfo(value: unknown): SavedMapInfo | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const info: SavedMapInfo = {};
  for (const key of ['title', 'description'] as const) {
    const text = value[key];
    if (typeof text === 'string' && text.trim() !== '') {
      info[key] = text;
    }
  }
  return Object.keys(info).length > 0 ? info : undefined;
}

/**
 * The URL-backed datasets among `value`, with their rows dropped and their field
 * list guaranteed.
 *
 * The `allData: []` is not cosmetic: an exported map carries every dataset's
 * rows, and a tileset that somehow arrived with some would otherwise write them
 * into the dashboard JSON. The `fields: []` is what keeps a hand-edited paste
 * from reaching kepler's `DatasetSchema.load`, which indexes `fields[0]`
 * unguarded.
 */
export function keepRemoteDatasets(value: unknown): SavedRemoteDataset[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const kept: SavedRemoteDataset[] = [];
  for (const entry of value) {
    if (isRemoteDataset(entry)) {
      const fields = Array.isArray(entry.data.fields) ? entry.data.fields : [];
      kept.push({ ...entry, data: { ...entry.data, fields, allData: [] } });
    }
  }
  return kept;
}

function isRemoteDataset(value: unknown): value is SavedRemoteDataset {
  if (!isRecord(value) || typeof value.version !== 'string' || !isRecord(value.data)) {
    return false;
  }
  const { id, type } = value.data;
  return typeof id === 'string' && typeof type === 'string' && REMOTE_DATASET_TYPES.includes(type);
}

/**
 * The config with its restorable datasets and its map info attached, and
 * nothing else.
 *
 * Rebuilt from its known keys rather than spread, so a config that arrives
 * carrying datasets of its own — one this panel wrote, or a hand-edited one —
 * cannot keep the ones the filter rejected.
 */
function cleanSavedConfig(config: SavedMapConfig, datasets: unknown, info: unknown): SavedMapConfig {
  const cleaned: SavedMapConfig = { version: config.version, config: config.config };
  const kept = keepRemoteDatasets(datasets);
  const keptInfo = keepMapInfo(info);
  return {
    ...cleaned,
    ...(kept.length > 0 ? { datasets: kept } : {}),
    ...(keptInfo ? { info: keptInfo } : {}),
  };
}

/**
 * Does this saved config actually choose a base map?
 *
 * A saved config outranks the **Base map** panel option, which is right when
 * the config names a style and wrong when it does not — and plenty of them do
 * not. `KeplerGlSchema.getConfigToSave` writes a full `mapStyle`, so anything
 * this panel captures names one; but a config *pasted* into **Import
 * configuration** need not. One written by hand to place a layer is usually
 * `visState` and `mapState` and nothing else, and the panel accepts those on
 * purpose — pasting from kepler.gl, Foursquare Studio or Dekart is a
 * documented feature.
 *
 * Treating the mere presence of a config as a base-map choice left the option
 * dead for exactly those: the option was skipped and nothing set a style in its
 * place, so the map kept kepler's default with nothing in the console to say
 * why. Asking whether a style is actually named is the whole of the fix.
 */
export function namesBasemap(config: SavedMapConfig | null | undefined): boolean {
  const mapStyle = config?.config?.mapStyle;
  return isRecord(mapStyle) && typeof mapStyle.styleType === 'string' && mapStyle.styleType !== '';
}

function isSavedConfig(value: unknown): value is SavedMapConfig {
  return isRecord(value) && typeof value.version === 'string' && isRecord(value.config);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
