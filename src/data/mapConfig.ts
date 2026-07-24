/** A kepler saved config: `{version, config}`, as produced by `getConfigToSave`. */
export interface SavedMapConfig {
  version: string;
  config: Record<string, unknown>;
}

/**
 * Reads a kepler map configuration out of pasted JSON.
 *
 * Accepts both shapes users actually have to hand:
 *
 * - the bare saved config, `{version, config}`
 * - a full exported map, `{datasets, config, info}` — what kepler's "Export map"
 *   and Dekart produce. Only the config half is kept; the data comes from the
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

  // A full exported map nests the saved config under `config`.
  if (isSavedConfig(parsed.config)) {
    return parsed.config;
  }

  return isSavedConfig(parsed) ? parsed : null;
}

function isSavedConfig(value: unknown): value is SavedMapConfig {
  return isRecord(value) && typeof value.version === 'string' && isRecord(value.config);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
