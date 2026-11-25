import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { PluginContextProvider, type PluginMeta, usePluginContext } from '@grafana/data';
import { usePluginFunctions, type UsePluginFunctionsResult } from '@grafana/runtime';

/**
 * What other plugins of the same family lend this panel, through Grafana's plugin extensions: an app plugin
 * registers a function (`AppPlugin.addFunction`) for an extension point this panel names, and the panel asks
 * Grafana for it (`usePluginFunctions`). No event bus, no globals: Grafana loads the app that offers the
 * function, from what its plugin.json declares, and hands the function over.
 *
 * Two links, each optional. Without the app that offers it (a Grafana without Chaski, or without Kepler Plus)
 * the panel draws as ever; only what the link carries is missing.
 *
 * - **Chaski** (`<panel id>/chaski/v1`, offered by the Chaski app): its DuckDB-WASM engine's activity, so a
 *   map writing variables while it plays waits for the panels that answer them, and its Mosaic runtime, for a
 *   map in a Mosaic Selection.
 * - **Time window** (`<panel id>/time-window/v1`, offered by the Kepler Plus app): where a Time Brush's window
 *   is, every frame, ahead of the variables it writes.
 *
 * An extension point's id starts with the id of the plugin that renders it, as Grafana asks. Kepler Plus builds
 * its own map and Time Brush from this code: each asks under its own id, which the apps' plugin.json list. A panel
 * renders `PluginLinks` at its root; the hooks read what it found.
 */
export const PANEL_PLUGIN_ID = 'ubica-keplergl-panel';

export const chaskiExtensionPoint = (pluginId: string) => `${pluginId}/chaski/v1`;
export const timeWindowExtensionPoint = (pluginId: string) => `${pluginId}/time-window/v1`;

/** What the Chaski app lends (`apiVersion` 1). Payloads are checked where they are read. */
export interface ChaskiLink {
  /** Calls `listener` with each activity payload of the engine; returns the unsubscribe. */
  subscribeActivity(listener: (payload: unknown) => void): () => void;
  /** Mosaic as Chaski's own panels share it: one copy, one coordinator. */
  mosaicRuntime(): Promise<unknown>;
}

/** What the Kepler Plus app lends (`apiVersion` 1). */
export interface TimeWindowLink {
  /** Says where a window is. */
  say(said: unknown): void;
  /** Calls `listener` with each window said; returns the unsubscribe. */
  subscribe(listener: (said: unknown) => void): () => void;
}

const isFunction = (value: unknown): value is (...args: unknown[]) => unknown => typeof value === 'function';

/** The Chaski app's link from what its function returns, or null when it is not one this panel knows. */
export function chaskiLinkOf(value: unknown): ChaskiLink | null {
  const api = value as Partial<ChaskiLink> & { apiVersion?: unknown };
  if (!api || api.apiVersion !== 1 || !isFunction(api.subscribeActivity) || !isFunction(api.mosaicRuntime)) {
    return null;
  }
  return { subscribeActivity: api.subscribeActivity.bind(api), mosaicRuntime: api.mosaicRuntime.bind(api) };
}

/** The Kepler Plus app's link from what its function returns, or null when it is not one this panel knows. */
export function timeWindowLinkOf(value: unknown): TimeWindowLink | null {
  const api = value as Partial<TimeWindowLink> & { apiVersion?: unknown };
  if (!api || api.apiVersion !== 1 || !isFunction(api.say) || !isFunction(api.subscribe)) {
    return null;
  }
  return { say: api.say.bind(api), subscribe: api.subscribe.bind(api) };
}

const NONE: UsePluginFunctionsResult<() => unknown> = { isLoading: false, functions: [] };

/**
 * Each link, by the object the app's function returned: the apps return the same object on every call, so a
 * panel keeps the same link across renders however Grafana hands the functions over.
 */
const parsedLinks = new WeakMap<object, unknown>();

function parseOnce<T>(api: unknown, parse: (value: unknown) => T | null): T | null {
  if (!api || typeof api !== 'object') {
    return parse(api);
  }
  if (!parsedLinks.has(api)) {
    parsedLinks.set(api, parse(api));
  }
  return parsedLinks.get(api) as T | null;
}

/** The first function offered at `extensionPointId` whose result `parse` accepts; undefined until one is. */
function useLink<T>(extensionPointId: string, parse: (value: unknown) => T | null): T | undefined {
  let offered: UsePluginFunctionsResult<() => unknown>;
  try {
    // Same order on every render: Grafana sets the registry's hook once, at start, so this either always
    // calls it or always throws before calling anything (outside a running Grafana: unit tests).
    // eslint-disable-next-line react-hooks/rules-of-hooks
    offered = usePluginFunctions<() => unknown>({ extensionPointId, limitPerPlugin: 1 });
  } catch {
    offered = NONE;
  }
  for (const { fn } of offered.functions) {
    try {
      const link = isFunction(fn) ? parseOnce(fn(), parse) : null;
      if (link) {
        return link;
      }
    } catch {
      // A function that throws lends nothing.
    }
  }
  return undefined;
}

/** The two links, as `PluginLinks` found them for the panel under it. */
interface Links {
  chaski?: ChaskiLink;
  timeWindow?: TimeWindowLink;
}

const LinksContext = createContext<Links>({});

/**
 * The extension points this panel names, as its plugin.json lists them. Grafana checks, in development mode
 * only, that a plugin asking for an extension point lists it in its plugin.json, reading the list from the
 * plugin's metadata; Grafana 13 gives a panel's metadata without its `extensions`, so the check would refuse
 * every point a panel names. The asking component gets the metadata with the list, the rest of the panel the
 * metadata Grafana gave.
 */
function withExtensionPoints(meta: PluginMeta): PluginMeta {
  const listed = meta.extensions?.extensionPoints ?? [];
  const ours = [chaskiExtensionPoint(meta.id), timeWindowExtensionPoint(meta.id)];
  if (ours.every((id) => listed.some((point) => point.id === id))) {
    return meta;
  }
  return {
    ...meta,
    extensions: {
      addedComponents: [],
      addedFunctions: [],
      addedLinks: [],
      exposedComponents: [],
      ...meta.extensions,
      extensionPoints: [
        ...listed,
        ...ours
          .filter((id) => !listed.some((point) => point.id === id))
          .map((id) => ({ id, title: id, description: '' })),
      ],
    },
  };
}

/** Asks Grafana for the links under `pluginId` and hands them up; draws nothing. */
function LinkFinder({ pluginId, onLinks }: { pluginId: string; onLinks: React.Dispatch<React.SetStateAction<Links>> }) {
  const chaski = useLink(chaskiExtensionPoint(pluginId), chaskiLinkOf);
  const timeWindow = useLink(timeWindowExtensionPoint(pluginId), timeWindowLinkOf);
  useEffect(
    () =>
      onLinks((found) => (found.chaski === chaski && found.timeWindow === timeWindow ? found : { chaski, timeWindow })),
    [chaski, timeWindow, onLinks]
  );
  return null;
}

/** The links other plugins lend, for `useChaskiLink` and `useTimeWindowLink` anywhere under it. */
export function PluginLinks({ children }: { children?: React.ReactNode }) {
  const context = usePluginContext();
  const meta = useMemo(() => {
    const own = context?.meta;
    return own ? withExtensionPoints(own) : undefined;
  }, [context]);
  const [links, setLinks] = useState<Links>({});
  return (
    <LinksContext.Provider value={links}>
      {meta ? (
        <PluginContextProvider meta={meta}>
          <LinkFinder pluginId={meta.id} onLinks={setLinks} />
        </PluginContextProvider>
      ) : (
        <LinkFinder pluginId={PANEL_PLUGIN_ID} onLinks={setLinks} />
      )}
      {children}
    </LinksContext.Provider>
  );
}

/** The Chaski app's link, when the Grafana has one to lend (under `PluginLinks`). */
export function useChaskiLink(): ChaskiLink | undefined {
  return useContext(LinksContext).chaski;
}

/** The Kepler Plus app's time window link, when the Grafana has one to lend (under `PluginLinks`). */
export function useTimeWindowLink(): TimeWindowLink | undefined {
  return useContext(LinksContext).timeWindow;
}
