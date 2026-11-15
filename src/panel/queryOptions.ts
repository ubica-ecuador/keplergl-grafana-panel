import type { TripLayerMode } from '../data/buildTripLayer';
import { GAZETTEERS } from '../data/placeLookup';
import type { KeplerPanelOptions, QueryOptions } from '../types';

/**
 * Options set per query (`KeplerPanelOptions.queryOptions`), and the panel-wide
 * options of 1.9 and earlier they replace.
 *
 * Up to 1.9 a panel had one Trip layer shape and one gazetteer for all of its
 * queries, so a map could not fold one trajectory query into paths and keep
 * another's rows, or look one query's codes up among airports and another's
 * among countries. Each query now has its own, under its refId.
 */

/**
 * The entry that holds what every query without its own takes.
 *
 * Where a panel saved by 1.9 or earlier keeps its panel-wide value: Grafana
 * hands a migration handler the panel's options but not its queries (Scenes
 * builds it a panel model of title, options and field config), so the value
 * cannot be copied to each query's refId there. A refId is a query's name in
 * the editor and is never `*`.
 */
export const EVERY_QUERY = '*';

/** The panel-wide options of 1.9 and earlier, now set per query. */
export const MOVED_TO_QUERY = ['tripLayerMode', 'gazetteer'] as const;

/** A panel's options as 1.9 and earlier saved them, with the panel-wide values. */
export type WithLegacyQueryOptions = Pick<KeplerPanelOptions, 'queryOptions'> & {
  tripLayerMode?: TripLayerMode;
  gazetteer?: string;
};

/**
 * A panel-wide value worth keeping: one that differs from the default. The
 * defaults are what a query with no entry takes anyway, and Grafana saved them
 * into every panel's JSON, so carrying them over would only add noise.
 */
function legacyEntry(options: Record<string, unknown>): QueryOptions {
  const entry: QueryOptions = {};
  if (options.tripLayerMode === 'geojson') {
    entry.tripLayerMode = 'geojson';
  }
  if (typeof options.gazetteer === 'string' && options.gazetteer.trim() && options.gazetteer !== GAZETTEERS.countries) {
    entry.gazetteer = options.gazetteer;
  }
  return entry;
}

/**
 * The options with the panel-wide values of 1.9 and earlier moved into
 * `queryOptions`, under {@link EVERY_QUERY}; `options` itself when it has none.
 * An `*` entry already there keeps what it sets.
 */
export function withQueryOptionsMoved<T extends object>(options: T): T {
  if (!options || !MOVED_TO_QUERY.some((key) => key in options)) {
    return options;
  }
  const kept: Record<string, unknown> = { ...(options as Record<string, unknown>) };
  const legacy = legacyEntry(kept);
  for (const key of MOVED_TO_QUERY) {
    delete kept[key];
  }
  if (Object.keys(legacy).length === 0) {
    return kept as T;
  }
  const queryOptions = { ...((kept.queryOptions as Record<string, QueryOptions> | undefined) ?? {}) };
  queryOptions[EVERY_QUERY] = { ...legacy, ...queryOptions[EVERY_QUERY] };
  return { ...kept, queryOptions } as T;
}

/**
 * What a query is drawn with: its own entry, then the {@link EVERY_QUERY} one,
 * then, for a panel the migration did not reach, the panel-wide value 1.9 and
 * earlier saved. Absent keys take the defaults (`table`, the countries).
 */
export function queryOptionsFor(options: WithLegacyQueryOptions, refId: string): QueryOptions {
  const own = options.queryOptions?.[refId] ?? {};
  const every = options.queryOptions?.[EVERY_QUERY] ?? {};
  const legacy = legacyEntry(options as Record<string, unknown>);
  const tripLayerMode = own.tripLayerMode ?? every.tripLayerMode ?? legacy.tripLayerMode;
  const gazetteer = own.gazetteer || every.gazetteer || legacy.gazetteer;
  return { ...(tripLayerMode ? { tripLayerMode } : {}), ...(gazetteer ? { gazetteer } : {}) };
}

/** {@link queryOptionsFor} for each of these refIds. */
export function resolveQueryOptions(options: WithLegacyQueryOptions, refIds: string[]): Record<string, QueryOptions> {
  return Object.fromEntries(refIds.map((refId) => [refId, queryOptionsFor(options, refId)]));
}
