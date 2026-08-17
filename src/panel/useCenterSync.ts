import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { centerMapOn, readPinnedCoordinate } from './keplerAdapter';
import { decideCenter } from './centerSync';
import { isCenterMapping, partitionMappings, type VariableMapping } from './variableSync';
import { readVariable } from './useVariableSync';

interface Params {
  store: Store;
  /** kepler only takes viewport updates once its instance has registered. */
  isReady: boolean;
  /** All the panel's mappings; only the `center` ones drive this hook. */
  mappings: VariableMapping[];
}

/**
 * Centres the map on its lat/lng variable pair when it changes from outside.
 *
 * The read-back direction of the coordinate channel: a table row's data link
 * writes the pair, a textbox edit writes the pair — and the map moves there,
 * jumping to the mapping's `zoom` if it names one.
 *
 * The first pass *adopts* the pair without moving the map — the same rule as
 * the area sync. Centring on load raced the saved-config restore, which
 * replaces the viewport when it lands, and whichever dispatch ran last won;
 * adopting instead means the author's saved viewport always frames the load,
 * and the pair moves the map only when someone actually changes it.
 *
 * The two silences — the echo of the map's own click publishing into the
 * same pair, and the stale pair riding an unrelated variable change — are
 * decided in `centerSync.ts` against the map's pinned coordinate and the
 * last pair seen.
 *
 * Listens to location changes only: variables live in the URL, and the panel
 * does not re-render when one it does not query on changes. Reconcile on a
 * microtask, like every sibling hook.
 */
export function useCenterSync({ store, isReady, mappings }: Params): void {
  const mappingsRef = useRef(mappings);
  // Updated in an effect, not during render: reconcile only runs on a microtask.
  useEffect(() => {
    mappingsRef.current = mappings;
  });

  /** Per-mapping key of the last pair seen, acted on or suppressed. */
  const lastCentered = useRef<Record<string, string>>({});

  /** True until the first reconcile has adopted the pairs without acting. */
  const firstPass = useRef(true);

  const reconcile = useRef(() => {
    const { center } = partitionMappings(mappingsRef.current);
    if (!center.length) {
      return;
    }
    const adopting = firstPass.current;
    firstPass.current = false;

    const pinned = readPinnedCoordinate(store);
    for (const mapping of center) {
      const variableValues: Record<string, unknown> = {};
      if (mapping.variable) {
        variableValues[mapping.variable] = readVariable(mapping.variable);
      }
      if (mapping.variableTo) {
        variableValues[mapping.variableTo] = readVariable(mapping.variableTo);
      }

      const slot = `${mapping.variable}/${mapping.variableTo}`;
      const { target, key } = decideCenter({
        variableValues,
        mapping,
        pinned: pinned ?? undefined,
        lastCentered: lastCentered.current[slot],
      });
      if (key !== undefined) {
        lastCentered.current[slot] = key;
      }
      if (target && !adopting) {
        centerMapOn(store, store.dispatch, target[0], target[1], mapping.zoom);
      }
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

  useEffect(() => {
    if (!isReady || !mappings.some(isCenterMapping)) {
      return;
    }

    schedule.current();
    // Variables land in the URL; the panel does not re-render for them.
    return locationService.getHistory().listen(schedule.current);
  }, [isReady, mappings, store]);
}
