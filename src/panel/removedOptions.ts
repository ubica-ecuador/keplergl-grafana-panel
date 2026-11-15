import type { PanelModel } from '@grafana/data';

import { MOVED_TO_QUERY, withQueryOptionsMoved } from './queryOptions';

/**
 * Options the panel no longer offers, and drops from a panel saved with them.
 *
 * `cartoApiKey` (up to 1.6) kept CARTO's API key in the panel's options, which
 * Grafana saves in the dashboard's JSON: everyone who can view the dashboard
 * can read it there. CARTO's base maps are now asked for without a key; a key
 * of one's own goes in a self-hosted style (Base map → Self-hosted style.json).
 *
 * `flowRenderMode` (up to 1.9, "Flow line style") styled the flow layers the
 * panel adds by itself, once, before a map was saved; a saved map's flow
 * layers keep their own style, which kepler's layer panel sets (Rendering
 * mode), so the option did nothing on any saved map. A new flow layer starts
 * straight and is restyled in the layer.
 */
export const REMOVED_OPTIONS = ['cartoApiKey', 'flowRenderMode'] as const;

/** `options` without the removed options, or `options` itself when it has none. */
export function withoutRemovedOptions<T extends object>(options: T): T {
  if (!options || !REMOVED_OPTIONS.some((key) => key in options)) {
    return options;
  }
  const kept: Record<string, unknown> = { ...(options as Record<string, unknown>) };
  for (const key of REMOVED_OPTIONS) {
    delete kept[key];
  }
  return kept as T;
}

/**
 * Whether a saved panel still carries a removed option, or a panel-wide one now
 * set per query (`queryOptions.ts`), whatever version saved it.
 */
export function hasRemovedOptions(panel: Pick<PanelModel, 'options'>): boolean {
  const options = panel.options as object | undefined;
  return Boolean(options) && [...REMOVED_OPTIONS, ...MOVED_TO_QUERY].some((key) => key in (options as object));
}

/**
 * The panel's migration handler: the saved options without the removed ones,
 * and the panel-wide Trip layer shape and gazetteer moved into `queryOptions`,
 * so the next save of the dashboard leaves them out. Exported for an edition
 * that sets a migration handler of its own, which replaces this one: it should
 * call this first.
 */
export function migrateRemovedOptions(panel: Pick<PanelModel, 'options'>): Record<string, unknown> {
  return withQueryOptionsMoved(withoutRemovedOptions({ ...((panel.options ?? {}) as Record<string, unknown>) }));
}
