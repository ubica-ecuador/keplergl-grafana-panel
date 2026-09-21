import { useEffect, useMemo, useRef } from 'react';
import type { Store } from 'redux';

import {
  readClickedPosition,
  readClickSlices,
  readFigures,
  readSyncSlices,
  removeFigure,
  replaceFiguresWithSquare,
} from './keplerAdapter';
import { decideClickArea, isSquareSuperseded } from './clickArea';
import { SliceWatcher } from './sliceWatcher';

interface Params {
  store: Store;
  /** kepler only exposes its click state once its instance has registered. */
  isReady: boolean;
  /** Off unless the panel asks for it: a click on an entity then sets the area. */
  enabled: boolean;
  /** Side of the square, in metres. */
  sideMetres: number;
  /**
   * Whether the click only opens the popup, leaving the square to its button.
   *
   * The panel's confirm mode, shared with `useClickSync`: what a click used to
   * do, the popup's "Select" does instead.
   */
  confirm?: boolean;
}

/** What the popup's button calls to place the square. */
export interface ClickAreaActions {
  select: () => void;
}

/**
 * Clicking an entity on the map sets the drawn area to a fixed square around it.
 *
 * Never writes the dashboard variable. The square becomes a figure in kepler's
 * editor, as if drawn by hand, and `useAreaSync` publishes it the way it
 * publishes any drawing — see `clickArea.ts` for why that, and not a second
 * writer of the variable, is the design. The two hooks meet only in kepler's
 * store.
 *
 * Two slices, two jobs:
 *
 * - `clicked` moving is a click. One that resolved to a position replaces every
 *   figure on the map with the square; one on bare map, or while the draw
 *   toolbar owns the click, does nothing; one on an entity that yields no
 *   position is logged, with the layer and the reason, so it can be told apart
 *   from a click on bare map.
 * - the figures moving may be the user drawing after a click. The square was
 *   the only figure when it was placed, so a second one means a newer drawing:
 *   `useAreaSync` already publishes it, and this removes the stale square so the
 *   map shows only what is being searched.
 *
 * Same structural rules as the sibling hooks: every dispatch happens on a
 * microtask, never inside the store subscription.
 */
export function useClickArea({ store, isReady, enabled, sideMetres, confirm = false }: Params): ClickAreaActions {
  const sideRef = useRef(sideMetres);
  const confirmRef = useRef(confirm);
  const enabledRef = useRef(enabled);
  // Updated in an effect, not during render: reconcile only runs on a microtask.
  useEffect(() => {
    sideRef.current = sideMetres;
    confirmRef.current = confirm;
    enabledRef.current = enabled;
  });

  /** The id of the square this hook last placed, while it may still be on the map. */
  const squareId = useRef<string | null>(null);

  const clickPending = useRef(false);
  const figuresPending = useRef(false);

  /** Puts the square around whatever is clicked; true when it placed one. */
  const place = useRef(() => {
    const decision = decideClickArea({
      clicked: readClickedPosition(store),
      sideMetres: sideRef.current,
      figures: readFigures(store),
    });
    if (decision.action === 'warn') {
      console.warn(`[kepler panel] ${decision.message}`);
    } else if (decision.action === 'place') {
      squareId.current = replaceFiguresWithSquare(store.dispatch, decision.square, decision.replace);
      return true;
    }
    return false;
  });

  const reconcile = useRef(() => {
    const onClick = clickPending.current;
    const onFigures = figuresPending.current;
    clickPending.current = false;
    figuresPending.current = false;

    // In confirm mode the click only opens the popup; `select` places the square.
    if (onClick && !confirmRef.current && place.current()) {
      // The figures just changed because of this very placement; that is not
      // the user drawing, so there is nothing more to check on this pass.
      return;
    }

    if (onFigures || onClick) {
      const figures = readFigures(store);
      if (!figures.some((figure) => figure.id === squareId.current)) {
        // Deleted with kepler's tool, or replaced: forget it.
        squareId.current = null;
        return;
      }
      if (isSquareSuperseded({ squareId: squareId.current, figures })) {
        const square = figures.find((figure) => figure.id === squareId.current);
        squareId.current = null;
        if (square) {
          removeFigure(store.dispatch, square);
        }
      }
    }
  });

  const scheduled = useRef(false);
  const schedule = useRef(() => {
    if (scheduled.current) {
      return;
    }
    scheduled.current = true;
    void Promise.resolve().then(() => {
      scheduled.current = false;
      reconcile.current();
    });
  });

  const clickWatcher = useRef(new SliceWatcher());
  const figureWatcher = useRef(new SliceWatcher());
  const onStoreChange = useRef(() => {
    if (clickWatcher.current.changed(readClickSlices(store))) {
      clickPending.current = true;
      schedule.current();
    }
    if (figureWatcher.current.changed(readSyncSlices(store))) {
      figuresPending.current = true;
      schedule.current();
    }
  });

  useEffect(() => {
    if (!isReady || !enabled) {
      return;
    }
    // Seed both watchers with what is already there, so whatever click state or
    // figures the map loaded with are not taken for a click or a drawing.
    clickWatcher.current.changed(readClickSlices(store));
    figureWatcher.current.changed(readSyncSlices(store));
    return store.subscribe(onStoreChange.current);
  }, [isReady, enabled, store]);

  // Stable, like its sibling in `useClickSync`: the popup holds it through a
  // context.
  return useMemo<ClickAreaActions>(
    () => ({
      select: () => {
        // The popup calls this on every confirm-mode panel, and most of them
        // select by publishing variables alone: no square unless asked for.
        if (enabledRef.current) {
          place.current();
        }
      },
    }),
    []
  );
}
