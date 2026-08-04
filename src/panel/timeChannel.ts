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
  /**
   * Whether the sender is playing its clock rather than being moved by hand.
   *
   * A follower cannot work this out for itself: an animation reaching it over
   * this bus is an ordinary filter change, and its own `isAnimating` stays
   * false. Anything that must treat playback differently from a drag — the
   * variable sync, which would otherwise publish a window per step — needs the
   * sender to say so.
   */
  playing?: boolean;
}

export type TimeListener = (message: TimeMessage) => void;

export interface TimeChannel {
  /** A fresh id for one map instance. */
  nextId(): string;
  /** Listens for what the other maps are doing. Returns an unsubscribe. */
  subscribe(id: string, listener: TimeListener): () => void;
  /** Tells the other maps where this one is. */
  publish(message: TimeMessage): void;
  /**
   * Whether any map on the bus is currently playing its clock.
   *
   * Includes the caller: a map that is animating locally already knows, and
   * counting it costs nothing. A sender that leaves is forgotten, so a panel
   * removed mid-animation cannot leave the others believing forever that
   * something is still playing.
   */
  anyPlaying(): boolean;
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
  /** The last thing each sender said about whether its clock is running. */
  const playing = new Map<string, boolean>();
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
        playing.delete(id);
      };
    },

    publish(message) {
      if (message.playing !== undefined) {
        playing.set(message.senderId, message.playing);
      }
      for (const [id, listener] of listeners) {
        if (id !== message.senderId) {
          listener(message);
        }
      }
    },

    anyPlaying() {
      for (const [id, isPlaying] of playing) {
        // A sender that never subscribed, or has left, does not count.
        if (isPlaying && listeners.has(id)) {
          return true;
        }
      }
      return false;
    },
  };
}

/** The bus every panel instance on the page shares. */
export const timeChannel = createTimeChannel();
