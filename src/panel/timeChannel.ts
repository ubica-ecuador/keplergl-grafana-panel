import type { TimeRangeMs } from './timeSync';

/**
 * What one map tells the others about where it is in time.
 *
 * The two clocks travel together but independently: a map showing flows has a
 * time filter and no playhead, a map showing trips in GeoJSON mode has a
 * playhead and no filter, and one showing trips from table columns has both.
 * Each field is simply absent when that map has nothing to say about it.
 */
export interface TimeMessage {
  /** Identifies the map that sent it, so it can ignore its own echo. */
  senderId: string;
  /** The time filter window. */
  filter?: TimeRangeMs | null;
  /** The trip animation playhead, in epoch milliseconds. */
  playhead?: number | null;
}

export type TimeListener = (message: TimeMessage) => void;

export interface TimeChannel {
  /** A fresh id for one map instance. */
  nextId(): string;
  /** Listens for what the other maps are doing. Returns an unsubscribe. */
  subscribe(id: string, listener: TimeListener): () => void;
  /** Tells the other maps where this one is. */
  publish(message: TimeMessage): void;
}

/**
 * An in-memory bus shared by the panels on a page.
 *
 * Routing time between panels through the Grafana time range works — it is what
 * `bidirectional` mode does — but every frame of an animation becomes a fresh
 * range, and a fresh range re-runs every query on the dashboard: measured at 92
 * queries in ten seconds on a two-panel dashboard. Panels cannot reach each
 * other's kepler stores, but they do share this module, because Grafana loads a
 * panel plugin's chunk once per page. So the maps talk here instead, and the
 * database is left alone.
 *
 * Deliberately in-page: `BroadcastChannel` would couple dashboards open in
 * other tabs, which is not what "the maps on this dashboard" means.
 *
 * Exported as a factory so tests get an isolated bus rather than the singleton
 * every panel shares.
 */
export function createTimeChannel(): TimeChannel {
  const listeners = new Map<string, TimeListener>();
  let seq = 0;

  return {
    nextId() {
      seq += 1;
      return `map-${seq}`;
    },

    subscribe(id, listener) {
      listeners.set(id, listener);
      return () => {
        listeners.delete(id);
      };
    },

    publish(message) {
      for (const [id, listener] of listeners) {
        if (id !== message.senderId) {
          listener(message);
        }
      }
    },
  };
}

/** The bus every panel instance on the page shares. */
export const timeChannel = createTimeChannel();
