import { useCallback, useSyncExternalStore } from 'react';
import type { Store } from 'redux';

import { KEPLER_INSTANCE_ID } from './constants';

/**
 * Whether kepler's side panel is open: `activeSidePanel` names its tab, and is
 * empty once the toggle or **Show side panel** has closed it. The panel's own
 * overlays steer around it.
 *
 * One boolean read on every dispatch, which is cheap, and compared by value,
 * so the hovering and panning kepler dispatches for all the time re-render
 * nothing.
 */
export function useSidePanelOpen(store: Store): boolean {
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  return useSyncExternalStore(subscribe, () => {
    const state = store.getState() as {
      keplerGl?: Record<string, { uiState?: { activeSidePanel?: string | null } }>;
    };
    return Boolean(state.keplerGl?.[KEPLER_INSTANCE_ID]?.uiState?.activeSidePanel);
  });
}
