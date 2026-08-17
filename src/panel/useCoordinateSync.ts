import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { ensureCoordinateInteraction, readCoordinateSlices, readPinnedCoordinate } from './keplerAdapter';
import { coordinateWrites } from './coordinateSync';
import { isCoordinateMapping, partitionMappings, type VariableMapping } from './variableSync';
import { readVariable } from './useVariableSync';
import { SliceWatcher } from './sliceWatcher';

interface Params {
  store: Store;
  /** kepler only exposes its pin state once its instance has registered. */
  isReady: boolean;
  /** All the panel's mappings; only the `coordinate` ones drive this hook. */
  mappings: VariableMapping[];
}

/**
 * Publishes the map coordinate clicked to a lat/lng dashboard variable pair.
 *
 * One direction only: a mapping with `source: 'coordinate'` writes the pinned
 * spot to its variables, and the panels that read them re-query — a coverage
 * radius around the click, say, computed by the datasource
 * (`ST_DWithin(geom, ST_MakePoint($lng, $lat)::geography, $radius)`) and
 * drawn back on the map as an ordinary query. The variables never drive the
 * map; there is nothing on it for them to drive.
 *
 * The channel rides kepler's coordinate interaction, which stores a click in
 * `visState.mousePos.pinned`. The hook switches the interaction on itself —
 * and back on after every saved-config restore, which replaces the
 * interaction switches wholesale — so configuring the mapping is all it
 * takes. The pin's toggle semantics and the write rules live in
 * `coordinateSync.ts`: publish on pin, keep the last value on unpin, never
 * write for the system's own resets.
 *
 * No debounce: a click is a discrete gesture, and the decision skips
 * variables that already hold the coordinate. An entity click also pins, so
 * both this channel and the click sync can publish from the same gesture —
 * deliberate: clicking a vehicle both selects it and recentres a coverage
 * query there, and a panel wanting only one of the two simply maps only that
 * one.
 *
 * Same structural rules as the sibling hooks: reconcile on a microtask, never
 * inside the store subscription, and react only when a watched slice moves.
 */
export function useCoordinateSync({ store, isReady, mappings }: Params): void {
  const mappingsRef = useRef(mappings);
  // Updated in an effect, not during render: reconcile only runs on a microtask.
  useEffect(() => {
    mappingsRef.current = mappings;
  });

  const reconcile = useRef(() => {
    const { coordinate } = partitionMappings(mappingsRef.current);
    if (!coordinate.length) {
      return;
    }

    ensureCoordinateInteraction(store, store.dispatch);

    const variableValues: Record<string, unknown> = {};
    for (const { variable, variableTo } of coordinate) {
      if (variable) {
        variableValues[variable] = readVariable(variable);
      }
      if (variableTo) {
        variableValues[variableTo] = readVariable(variableTo);
      }
    }

    const writes = Object.entries(
      coordinateWrites({
        coordinate: readPinnedCoordinate(store),
        mappings: coordinate,
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

  const pending = useRef(false);
  const schedule = useRef(() => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    void Promise.resolve().then(() => {
      pending.current = false;
      reconcile.current();
    });
  });

  const watcher = useRef(new SliceWatcher());
  const onStoreChange = useRef(() => {
    if (watcher.current.changed(readCoordinateSlices(store))) {
      schedule.current();
    }
  });

  useEffect(() => {
    if (!isReady || !mappings.some(isCoordinateMapping)) {
      return;
    }

    schedule.current();
    return store.subscribe(onStoreChange.current);
  }, [isReady, mappings, store]);
}
