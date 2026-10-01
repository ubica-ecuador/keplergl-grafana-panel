import { ActionTypes, isForwardAction } from '@kepler.gl/actions';
import type { Reducer, UnknownAction } from 'redux';

import { layerGroupsIn, type LayerGroup } from './layerGroups';

interface LoadedEntry {
  style?: unknown;
  layerGroups?: LayerGroup[];
}

/**
 * `LOAD_MAP_STYLES` with each arriving document's entry cut down to the groups
 * that document has.
 *
 * kepler registers every entry before any document is in, and works out its
 * groups as `entry.layerGroups || groupsOf(style)`. With no document that is
 * `[]`, and `[]` is truthy, so the groups are never worked out again once the
 * document arrives: a self-hosted style showed no switches. Its first document
 * also emptied the switch states, because kepler merges them against the
 * defaults of that empty list.
 *
 * Every entry is registered with the full candidate list instead
 * (`STYLE_LAYER_GROUPS`), and this trims it as the document comes in — before
 * kepler's reducer reads it, so kepler's own merge keeps the states the map
 * held for every slug the two styles share. A pure rewrite of the action: no
 * subscriber and no second dispatch.
 */
export function withLoadedLayerGroups<A>(action: A): A {
  const a = action as UnknownAction & { payload?: any };
  if (isForwardAction(a)) {
    const inner = withLoadedLayerGroups(a.payload);
    return (inner === a.payload ? action : { ...a, payload: inner }) as A;
  }
  if (a?.type !== ActionTypes.LOAD_MAP_STYLES || !a.payload?.newStyles) {
    return action;
  }
  const newStyles = a.payload.newStyles as Record<string, LoadedEntry | undefined>;
  const trimmed = Object.fromEntries(
    Object.entries(newStyles).map(([id, entry]) => [
      id,
      entry?.style && entry.layerGroups
        ? { ...entry, layerGroups: layerGroupsIn(entry.layerGroups, entry.style) }
        : entry,
    ])
  );
  return { ...a, payload: { ...a.payload, newStyles: trimmed } } as A;
}

/** kepler's reducer, seeing every `LOAD_MAP_STYLES` through {@link withLoadedLayerGroups}. */
export function withPresentLayerGroups<S>(reducer: Reducer<S>): Reducer<S> {
  return (state, action) => reducer(state, withLoadedLayerGroups(action));
}
