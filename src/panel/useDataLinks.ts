import { useEffect, useMemo, useRef } from 'react';
import type { DataFrame, InterpolateFunction, LinkModel } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import { closeMapPopover, readClickedEntity, readClickedRow, readClickSlices } from './keplerAdapter';
import { clickSelects, entityLinks, frameOfDataset, framesHaveLinks, linkNavigation, oneClickLink } from './dataLinks';
import { isClickMapping, type VariableMapping } from './variableSync';
import { SliceWatcher } from './sliceWatcher';

interface Params {
  store: Store;
  isReady: boolean;
  /** The query results, as Grafana handed them: their fields carry the links. */
  frames: readonly DataFrame[];
  /** The datasets built from them, for the columns kepler knows by another name. */
  datasets: readonly PanelDataset[];
  replaceVariables?: InterpolateFunction;
  timeZone?: string;
  /** The panel's mappings, kepler-named: a click that publishes one is a selection. */
  mappings: VariableMapping[];
  /** The click also places the search square. */
  clickArea: boolean;
}

/** What the popup reads: the clicked entity's links, and how to follow one. */
export interface LinksApi {
  /** The links of the entity in the pinned popup; empty when there is none, or no link. */
  links: () => LinkModel[];
  /** Follows a link the way Grafana's own link buttons do. */
  follow: (link: LinkModel, event?: unknown) => void;
}

const NO_LINKS: LinkModel[] = [];

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
 * Grafana's data links on the map: in the popup of a clicked entity, and
 * followed at once for a link marked "one click" when the click selects
 * nothing else.
 *
 * The links are resolved when the popup asks, from the click state in the
 * store, and remembered against that state's identity: kepler re-renders its
 * popup on every pointer move while one is pinned, and the answer only changes
 * when the click does — or when a refresh brings new frames, which also resets
 * the click.
 *
 * The one-click path follows the click sync's structure: watch `clicked` alone,
 * act on a microtask, never inside the store subscription. It closes the popup
 * before navigating, so a link that stays on this dashboard (a variable in the
 * URL) does not leave a popup pinned over the entity it just acted on.
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
}: Params): LinksApi {
  const inputs = useRef({ frames, datasets, replaceVariables, timeZone, mappings, clickArea });
  useEffect(() => {
    inputs.current = { frames, datasets, replaceVariables, timeZone, mappings, clickArea };
  });

  const cache = useRef<{ clicked: unknown; frames: readonly DataFrame[]; links: LinkModel[] } | null>(null);

  const resolve = useRef((): LinkModel[] => {
    const { frames, datasets, replaceVariables, timeZone } = inputs.current;
    if (!replaceVariables || !framesHaveLinks(frames)) {
      return NO_LINKS;
    }
    const [clicked] = readClickSlices(store);
    if (cache.current && cache.current.clicked === clicked && cache.current.frames === frames) {
      return cache.current.links;
    }
    const row = readClickedRow(store);
    const frame = row ? frameOfDataset(frames, row.dataId) : undefined;
    const links =
      row && frame
        ? entityLinks({
            frame,
            values: row.values,
            renames: datasets.find((d) => d.id === row.dataId)?.renames,
            replaceVariables,
            timeZone,
          })
        : NO_LINKS;
    cache.current = { clicked, frames, links };
    return links;
  });

  const oneClick = useRef(() => {
    const [clicked] = readClickSlices(store);
    if (!clicked) {
      return;
    }
    const link = oneClickLink(resolve.current());
    if (!link) {
      return;
    }
    const { mappings, clickArea } = inputs.current;
    const clickFields = mappings.filter(isClickMapping).map((m) => m.field);
    const mappedValues = clickFields.length ? readClickedEntity(store, clickFields) : undefined;
    if (clickSelects({ clickArea, mappedValues })) {
      return;
    }
    closeMapPopover(store.dispatch);
    followLink(link);
  });

  const hasLinks = useMemo(() => framesHaveLinks(frames), [frames]);
  const hasOneClick = useMemo(
    () => frames.some((frame) => frame.fields.some((field) => field.config?.links?.some((link) => link.oneClick))),
    [frames]
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

  // One stable object per "are there links at all": it travels down a context
  // to a popup kepler re-renders on every pointer move.
  return useMemo<LinksApi>(
    () => ({
      links: hasLinks ? () => resolve.current() : () => NO_LINKS,
      follow: followLink,
    }),
    [hasLinks]
  );
}
