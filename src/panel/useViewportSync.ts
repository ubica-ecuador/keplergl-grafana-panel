import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { readMapState, readViewportBounds } from './keplerAdapter';
import { hasViewportVariables, viewportVariableWrites, type ViewportVariables } from './viewportSync';
import { readVariable } from './useVariableSync';
import { sameMapState, type MapStateLike } from './windViewport';

interface Params {
  store: Store;
  /** kepler only has a measurable viewport once its instance has registered. */
  isReady: boolean;
  /** The variables the four edges are published to. */
  variables?: ViewportVariables;
}

/**
 * How long the map must rest before its bbox reaches the dashboard.
 *
 * A pan or zoom moves the viewport on every animation frame, and each
 * variable write re-runs every panel that reads an edge — the shape of the
 * 92-queries-in-10-s incident the time sync already survived. One gesture
 * must cost one write, so the publish waits for the gesture to end. Same
 * figure as the range and time channels.
 */
const PUBLISH_DELAY_MS = 300;

/**
 * Publishes the map's viewport as a bbox of dashboard variables.
 *
 * One way only: the panels that read `$west`/`$south`/`$east`/`$north`
 * re-query to what the map is showing. Nothing reads them back — a viewport
 * driven from outside is what the centre mapping is for.
 *
 * Publishes on load too, once the map has settled: a consuming panel should
 * open with a bbox rather than an empty variable it has to defend against.
 * That the bbox *describes* the map rather than directing it is also why a
 * shared link's value is not defended here, unlike every other channel — the
 * map is the source of truth for where it is looking.
 *
 * Same structural rules as the sibling hooks: react only when the watched
 * state actually moves, and write on a timer rather than inside the store
 * subscription.
 */
export function useViewportSync({ store, isReady, variables }: Params): void {
  const variablesRef = useRef(variables);
  // Updated in an effect, not during render: reconcile runs on a timer.
  useEffect(() => {
    variablesRef.current = variables;
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The last map state seen, so a store notification that did not move the view is free. */
  const lastSeen = useRef<MapStateLike | null>(null);

  const publish = useRef(() => {
    timer.current = null;
    const named = variablesRef.current;
    if (!hasViewportVariables(named)) {
      return;
    }

    const variableValues: Record<string, unknown> = {};
    for (const name of [named!.west, named!.south, named!.east, named!.north]) {
      if (name) {
        variableValues[name] = readVariable(name);
      }
    }

    const writes = Object.entries(
      viewportVariableWrites({
        bounds: readViewportBounds(store),
        variables: named!,
        variableValues,
      })
    );
    if (writes.length) {
      locationService.partial(
        Object.fromEntries(writes.map(([name, value]) => [`var-${name}`, value])),
        true
      );
    }
  });

  const schedule = useRef(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => publish.current(), PUBLISH_DELAY_MS);
  });

  // kepler dispatches on every pointer move over the map; only a change to
  // the view itself is worth a publish, and the raw state is what tells them
  // apart — the derived bbox would recompute for nothing.
  const onStoreChange = useRef(() => {
    const mapState = readMapState(store);
    if (sameMapState(lastSeen.current, mapState)) {
      return;
    }
    lastSeen.current = mapState;
    schedule.current();
  });

  useEffect(() => {
    if (!isReady || !hasViewportVariables(variables)) {
      return;
    }

    // The load publish: the map has a viewport before anyone touches it, and
    // a consuming panel should not have to open without one.
    lastSeen.current = readMapState(store);
    schedule.current();

    const unsubscribe = store.subscribe(onStoreChange.current);
    return () => {
      unsubscribe();
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [isReady, variables, store]);
}
