import { useEffect, useMemo, useRef } from 'react';
import type { DataFrame, InterpolateFunction, LinkModel } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import { closeMapPopover, readClickedEntity, readClickedRow, readClickSlices } from './keplerAdapter';
import { clickSelects, entityLinks, frameOfDataset, framesHaveLinks, linkNavigation, oneClickLink } from './dataLinks';
import { entityActions, framesHaveActions, type MapAction } from './mapActions';
import { isClickMapping, type VariableMapping } from './variableSync';
import { SliceWatcher } from './sliceWatcher';

interface Params {
  store: Store;
  isReady: boolean;
  /** The query results, as Grafana handed them: their fields carry the links and actions. */
  frames: readonly DataFrame[];
  /** The datasets built from them, for the columns kepler knows by another name. */
  datasets: readonly PanelDataset[];
  replaceVariables?: InterpolateFunction;
  timeZone?: string;
  /** The panel's mappings, kepler-named: a click that publishes one is a selection. */
  mappings: VariableMapping[];
  /** The click also places the search square. */
  clickArea: boolean;
  /**
   * Whether this viewer may run actions: Grafana's `canExecuteActions`, which is
   * "can edit this dashboard". Its own panels show no action to anyone else, so
   * an anonymous viewer of a public dashboard never sees one; nor does the map.
   */
  canExecuteActions: boolean;
  /** Opens the dialog an action goes through before it is sent (ActionDialog.tsx). */
  onAction: (action: MapAction) => void;
}

/** What the popup reads: the clicked entity's links and actions, and what to do with one. */
export interface LinksApi {
  /** The links of the entity in the pinned popup; empty when there is none, or no link. */
  links: () => LinkModel[];
  /** Follows a link the way Grafana's own link buttons do. */
  follow: (link: LinkModel, event?: unknown) => void;
  /** The actions of the entity in the pinned popup; empty for a viewer who may not run them. */
  actions: () => MapAction[];
  /** Asks for confirmation, then sends the action. */
  run: (action: MapAction) => void;
}

const NO_LINKS: LinkModel[] = [];
const NO_ACTIONS: MapAction[] = [];

interface Resolved {
  links: LinkModel[];
  actions: MapAction[];
}

const NOTHING: Resolved = { links: NO_LINKS, actions: NO_ACTIONS };

/** Follows `link` from a plain left click, as Grafana's link buttons do. */
export function followLink(link: LinkModel, event?: unknown): void {
  const how = linkNavigation(link, window.location.origin);
  if (how.kind === 'callback') {
    link.onClick?.(event ?? {});
  } else if (how.kind === 'inApp') {
    locationService.push(how.path);
  } else {
    window.open(how.href, how.target, how.target === '_blank' ? 'noopener,noreferrer' : undefined);
  }
}

/**
 * Grafana's data links and actions on the map: in the popup of a clicked
 * entity, and followed at once for one marked "one click" when the click
 * selects nothing else.
 *
 * They are resolved when the popup asks, from the click state in the store,
 * and remembered against that state's identity: kepler re-renders its popup on
 * every pointer move while one is pinned, and the answer only changes when the
 * click does — or when a refresh brings new frames, which also resets the click.
 *
 * The one-click path follows the click sync's structure: watch `clicked` alone,
 * act on a microtask, never inside the store subscription. It closes the popup
 * first, so a link that stays on this dashboard (a variable in the URL) does
 * not leave a popup pinned over the entity it just acted on. A one-click link
 * wins over a one-click action; an action still goes through its confirmation.
 */
export function useDataLinks({
  store,
  isReady,
  frames,
  datasets,
  replaceVariables,
  timeZone,
  mappings,
  clickArea,
  canExecuteActions,
  onAction,
}: Params): LinksApi {
  const inputs = useRef({
    frames,
    datasets,
    replaceVariables,
    timeZone,
    mappings,
    clickArea,
    canExecuteActions,
    onAction,
  });
  useEffect(() => {
    inputs.current = { frames, datasets, replaceVariables, timeZone, mappings, clickArea, canExecuteActions, onAction };
  });

  const cache = useRef<{
    clicked: unknown;
    frames: readonly DataFrame[];
    canExecute: boolean;
    resolved: Resolved;
  } | null>(null);

  const resolve = useRef((): Resolved => {
    const { frames, datasets, replaceVariables, timeZone, canExecuteActions } = inputs.current;
    const wantLinks = framesHaveLinks(frames);
    const wantActions = canExecuteActions && framesHaveActions(frames);
    if (!replaceVariables || !(wantLinks || wantActions)) {
      return NOTHING;
    }
    const [clicked] = readClickSlices(store);
    const cached = cache.current;
    if (cached && cached.clicked === clicked && cached.frames === frames && cached.canExecute === canExecuteActions) {
      return cached.resolved;
    }
    const row = readClickedRow(store);
    const frame = row ? frameOfDataset(frames, row.dataId) : undefined;
    let resolved = NOTHING;
    if (row && frame) {
      const renames = datasets.find((d) => d.id === row.dataId)?.renames;
      resolved = {
        links: wantLinks ? entityLinks({ frame, values: row.values, renames, replaceVariables, timeZone }) : NO_LINKS,
        actions: wantActions
          ? entityActions({ frame, values: row.values, renames, replaceVariables, origin: window.location.origin })
          : NO_ACTIONS,
      };
    }
    cache.current = { clicked, frames, canExecute: canExecuteActions, resolved };
    return resolved;
  });

  const oneClick = useRef(() => {
    const [clicked] = readClickSlices(store);
    if (!clicked) {
      return;
    }
    const { links, actions } = resolve.current();
    const link = oneClickLink(links);
    const action = link ? undefined : actions.find((a) => a.oneClick);
    if (!link && !action) {
      return;
    }
    const { mappings, clickArea, onAction } = inputs.current;
    const clickFields = mappings.filter(isClickMapping).map((m) => m.field);
    const mappedValues = clickFields.length ? readClickedEntity(store, clickFields) : undefined;
    if (clickSelects({ clickArea, mappedValues })) {
      return;
    }
    closeMapPopover(store.dispatch);
    if (link) {
      followLink(link);
    } else if (action) {
      onAction(action);
    }
  });

  const hasLinks = useMemo(() => framesHaveLinks(frames), [frames]);
  const hasActions = canExecuteActions && framesHaveActions(frames);
  const hasOneClick = useMemo(
    () =>
      frames.some((frame) =>
        frame.fields.some(
          (field) =>
            field.config?.links?.some((link) => link.oneClick) ||
            (canExecuteActions && field.config?.actions?.some((action) => action.oneClick))
        )
      ),
    [frames, canExecuteActions]
  );

  useEffect(() => {
    if (!isReady || !hasOneClick) {
      return;
    }
    const watcher = new SliceWatcher();
    // Adopt the click state as it stands: a pinned popup restored on mount is
    // not a click the user just made.
    watcher.changed(readClickSlices(store));
    let pending = false;
    return store.subscribe(() => {
      if (!watcher.changed(readClickSlices(store)) || pending) {
        return;
      }
      pending = true;
      void Promise.resolve().then(() => {
        pending = false;
        oneClick.current();
      });
    });
  }, [isReady, hasOneClick, store]);

  // One stable object per "are there links, are there actions": it travels
  // down a context to a popup kepler re-renders on every pointer move.
  return useMemo<LinksApi>(
    () => ({
      links: hasLinks ? () => resolve.current().links : () => NO_LINKS,
      follow: followLink,
      actions: hasActions ? () => resolve.current().actions : () => NO_ACTIONS,
      run: (action) => inputs.current.onAction(action),
    }),
    [hasLinks, hasActions]
  );
}
