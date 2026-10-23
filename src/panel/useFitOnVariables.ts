import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { fitMapToBounds, readLayerBoundsUnion, sizeMapForFit } from './keplerAdapter';
import { armFit, armsFit, decideFit, variablesKey, type FitArm } from './fitOnVariables';
import { readVariable } from './useVariableSync';
import type { PanelDataset } from '../data/framesToDatasets';

/**
 * How long a refresh gets to reach the layers before the map is framed on what
 * they hold. kepler merges replaced rows through tasks that settle after the
 * load effect; usually the layers' bounds move well within this, and the
 * store subscription below frames as soon as they do.
 */
const SETTLE_MS = 800;

interface Params {
  store: Store;
  isReady: boolean;
  /** The variables whose change means the rows moved; empty for none. */
  variables: readonly string[];
  /** The rows the load effect just handed kepler: a new array on every refresh. */
  datasets: PanelDataset[];
  width: number;
  height: number;
}

const boundsKey = (bounds: unknown) => JSON.stringify(bounds ?? null);

/**
 * Frames the map on its data again when one of `variables` changes; see
 * `fitOnVariables.ts` for the rules.
 *
 * Two halves. A location listener arms the fit when the named variables'
 * values change — read from the URL like every sibling hook, since that is
 * what moves first — and notes where the layers are at that moment. An effect
 * on each new `datasets`, declared after the load effect so it runs once the
 * refresh is dispatched, waits for the rows to reach the layers and frames them
 * while the arm lasts.
 */
export function useFitOnVariables({ store, isReady, variables, datasets, width, height }: Params): void {
  const key = useRef<string | null>(null);
  const arm = useRef<FitArm | null>(null);
  const size = useRef({ width, height });
  useEffect(() => {
    size.current = { width, height };
  });

  useEffect(() => {
    key.current = null;
    arm.current = null;
    if (!variables.length) {
      return;
    }
    const update = () => {
      const next = variablesKey(variables, readVariable);
      if (armsFit(key.current, next)) {
        arm.current = armFit(Date.now(), boundsKey(readLayerBoundsUnion(store)));
      }
      key.current = next;
    };
    update();
    return locationService.getHistory().listen(update);
  }, [variables, store]);

  useEffect(() => {
    if (!isReady || !arm.current) {
      return;
    }
    // Rows, not bounds, say whether there is anything to frame: kepler keeps the
    // old bounds on a layer whose rows were replaced by none.
    const hasRows = datasets.some((dataset) => dataset.rows.length > 0);
    const before = boundsKey(readLayerBoundsUnion(store));
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      unsubscribe();
      clearTimeout(timer);
      const bounds = readLayerBoundsUnion(store);
      const decision = decideFit(arm.current, Date.now(), hasRows && bounds ? boundsKey(bounds) : null);
      arm.current = decision.arm;
      if (decision.fit && bounds) {
        sizeMapForFit(store, store.dispatch, size.current.width, size.current.height);
        fitMapToBounds(store.dispatch, bounds);
      }
    };
    const unsubscribe = store.subscribe(() => {
      if (boundsKey(readLayerBoundsUnion(store)) !== before) {
        finish();
      }
    });
    const timer = setTimeout(finish, SETTLE_MS);
    // A newer refresh supersedes this one before it was framed: it decides instead.
    return () => {
      if (!done) {
        done = true;
        unsubscribe();
        clearTimeout(timer);
      }
    };
  }, [isReady, datasets, store]);
}
