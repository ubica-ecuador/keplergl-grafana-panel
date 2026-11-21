import { useEffect, useRef } from 'react';
import type { DataFrame } from '@grafana/data';
import type { Store } from 'redux';

import { decideFit, FIT_ARM_MAX_MS } from './fitOnVariables';
import { fitMapToBounds, fitMapToBox, readLayerBoundsUnion, sizeMapForFit } from './keplerAdapter';
import { armLayerFraming, decideLayerFraming, type LayerArm, queryDatasetIds, queryLayerAnswers } from './layerFraming';
import type { BoxedLayer } from './useBoxFraming';
import { type BoxFrame, unionOfBounds } from './wmsExtent';

/**
 * How long the rows of a query switched to another layer get to move its
 * layers' bounds before the map is framed on what those layers hold: the new
 * layer may lie where the old one did.
 */
const SETTLE_MS = 800;

interface Params {
  store: Store;
  isReady: boolean;
  /** The queries' frames, as the panel received them: what they say about their layers. */
  frames: readonly DataFrame[];
  /** The layers `useBoxFraming` frames on a box of their own: their queries are left to it. */
  boxed: readonly BoxedLayer[];
  width: number;
  height: number;
  /** Told what the view was just framed on, so the viewport guard defends it. */
  onFramed: (frame: BoxFrame) => void;
}

const boundsKey = (bounds: unknown) => JSON.stringify(bounds ?? null);

/**
 * Frames the map on a query that has been pointed at another layer; see
 * `layerFraming.ts` for the rules.
 *
 * Declared before the load effect, and that order is the point: the effect on
 * each new answer runs before the load effect hands its rows to kepler, so the
 * arm it takes for a layer framed on its rows notes the old layer's bounds. A
 * box is framed on a microtask, once the load effect has dispatched, which a
 * replace of the rows does not undo: kepler frames a replaced dataset only for
 * a query that names no layer (`replaceDatasetData`).
 *
 * Same structural rule as the sibling hooks: every dispatch happens on a
 * microtask or a timer, never inside the store subscription.
 */
export function useLayerFraming({ store, isReady, frames, boxed, width, height, onFramed }: Params): void {
  const known = useRef(new Map<string, string | null>());
  const size = useRef({ width, height });
  const onFramedRef = useRef(onFramed);
  useEffect(() => {
    size.current = { width, height };
    onFramedRef.current = onFramed;
  });

  /** The arm of the last switch framed on rows, and how to let go of it. */
  const arm = useRef<LayerArm | null>(null);
  const release = useRef(() => {});
  useEffect(() => () => release.current(), []);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    const boxedIds = new Set(boxed.filter((layer) => layer.bbox).map((layer) => layer.id));
    const decision = decideLayerFraming(known.current, queryLayerAnswers(frames, boxedIds));
    known.current = decision.known;
    if (!decision.box && !decision.rows.length) {
      // A refresh of the same layer once its switch has framed something: the
      // view is the user's again, whatever its rows do.
      if (arm.current?.fittedBounds) {
        release.current();
        arm.current = null;
      }
      return;
    }

    // A newer switch decides instead of whatever the last one still waits for.
    release.current();
    arm.current = null;
    const fit = (bounds: Parameters<typeof fitMapToBounds>[1], box: boolean) => {
      sizeMapForFit(store, store.dispatch, size.current.width, size.current.height);
      if (box) {
        fitMapToBox(store, store.dispatch, { bounds });
        onFramedRef.current({ bounds });
      } else {
        fitMapToBounds(store.dispatch, bounds);
      }
    };

    const { box } = decision;
    if (box) {
      void Promise.resolve().then(() => fit(box, true));
    }
    if (!decision.rows.length) {
      return;
    }

    const ids = decision.rows.flatMap(queryDatasetIds);
    arm.current = armLayerFraming(Date.now(), boundsKey(readLayerBoundsUnion(store, ids)), ids, box);
    let settled = false;
    let pending = false;
    const check = () => {
      const current = arm.current;
      if (!current) {
        return;
      }
      const bounds = readLayerBoundsUnion(store, current.ids);
      const key = boundsKey(bounds);
      const decided = decideFit(current, Date.now(), bounds && (settled || key !== current.armBounds) ? key : null);
      // Spent once the rows are framed somewhere else than the old layer: the
      // answer that names a layer brings all of its rows, so no later step of
      // the switch is to come.
      arm.current = decided.arm && decided.arm.movedAt === null ? { ...current, ...decided.arm } : null;
      if (decided.fit && bounds) {
        const union = unionOfBounds(current.box ? [current.box, bounds] : [bounds]);
        if (union) {
          fit(union, false);
        }
      }
      if (!arm.current) {
        release.current();
      }
    };
    const schedule = () => {
      if (pending) {
        return;
      }
      pending = true;
      void Promise.resolve().then(() => {
        pending = false;
        check();
      });
    };
    const unsubscribe = store.subscribe(schedule);
    const settle = setTimeout(() => {
      settled = true;
      schedule();
    }, SETTLE_MS);
    const giveUp = setTimeout(() => {
      arm.current = null;
      release.current();
    }, FIT_ARM_MAX_MS);
    release.current = () => {
      unsubscribe();
      clearTimeout(settle);
      clearTimeout(giveUp);
      release.current = () => {};
    };
  }, [isReady, frames, boxed, store]);
}
