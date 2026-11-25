import { useMemo } from 'react';
import { usePluginContext } from '@grafana/data';
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
 * its own map and Time Brush from this code: each asks under its own id, which the apps' plugin.json list.
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

/** The first function offered at `extensionPointId` that `parse` accepts, called once; undefined until one is. */
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
  const { functions } = offered;
  return useMemo(() => {
    for (const { fn } of functions) {
      try {
        const link = isFunction(fn) ? parse(fn()) : null;
        if (link) {
          return link;
        }
      } catch {
        // A function that throws lends nothing.
      }
    }
    return undefined;
  }, [functions, parse]);
}

/** This panel's plugin id, or the free panel's outside a plugin context. */
function usePluginId(): string {
  return usePluginContext()?.meta?.id ?? PANEL_PLUGIN_ID;
}

/** The Chaski app's link, when the Grafana has one to lend. */
export function useChaskiLink(): ChaskiLink | undefined {
  return useLink(chaskiExtensionPoint(usePluginId()), chaskiLinkOf);
}

/** The Kepler Plus app's time window link, when the Grafana has one to lend. */
export function useTimeWindowLink(): TimeWindowLink | undefined {
  return useLink(timeWindowExtensionPoint(usePluginId()), timeWindowLinkOf);
}
