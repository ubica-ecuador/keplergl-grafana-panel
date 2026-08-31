/**
 * Paces a job that reacts to the map's clock.
 *
 * The timelines all reconcile from the map's time window, and the window moves
 * continuously while the slider is dragged: every bin the drag crosses is a
 * scene, and each one used to be fetched in full. Measured on the Image Service
 * timeline — one drag across seven years asked the service for **126 tiles**
 * across all seven, when only the year the drag ends on is ever seen.
 *
 * It is worse than wasted bandwidth. The browser opens six connections per
 * origin, so the tiles of the scene you actually stopped on queue behind every
 * obsolete one, and kepler does not pass deck's abort signal to its fetch —
 * measured elsewhere in this repo at zero aborts in 350 requests. Nothing
 * cancels; the map simply takes a long time to show what you asked for.
 *
 * So this runs the job **once at the start** of a burst and **once more at the
 * end** of it, and never in between.
 *
 * Both edges are load-bearing, and each was learned by breaking it:
 *
 * - Without the leading run, the opening reconcile — the one that finds the
 *   time filter and opens it — lands after the panel has synced the dashboard's
 *   range into it, and nothing arrives afterwards to put the order right. A map
 *   opened on a range covering 2016-2019 drew 2025.
 * - The leading run must still be **asynchronous**. `schedule` is called from
 *   inside kepler's store subscription, and dispatching there re-enters its
 *   reducer; that is what the microtask this grew out of was for. Running the
 *   job synchronously looked like an obvious simplification and quietly stopped
 *   the clock from moving the map at all.
 *
 * Free of React and kepler so the timing can be tested with fake timers rather
 * than with a rendered map.
 */

/** A job paced by the calls asking for it. */
export interface Settler {
  /** Ask for a run, paced against the calls around it. */
  schedule(): void;
  /**
   * Ask for a run on the next microtask, with no pacing at all.
   *
   * For the opening frames, which are a conversation rather than a burst: the
   * first reconcile finds the map's time filter, a later one opens it, and the
   * panel's range sync lands somewhere among them. Pacing that sequence reorders
   * it — the widening of the filter to its full domain arrives *after* the
   * dashboard's range has been synced in, and the map opens on the newest scene
   * instead of the one the range asked for. Measured: a range covering
   * 2016-2019 drew 2025.
   *
   * So the timelines pace only once they have opened. There is nothing to save
   * before then: the map is loading, not being dragged.
   */
  scheduleNow(): void;
  /** Drop anything still owed — the hooks call this on unmount. */
  cancel(): void;
}

/**
 * How long the window must hold still before the map acts on it again.
 *
 * Long enough to swallow a drag, short enough that letting go feels immediate.
 * A drag emits a value every few milliseconds, so anything above ~100 ms
 * collapses one into a single trailing run; a fifth of a second after the mouse
 * comes up is below what reads as lag.
 */
export const SETTLE_MS = 200;

/**
 * Whether a change to the map's clock should be paced or acted on at once.
 *
 * Two things move the window, and they want opposite treatment:
 *
 * - A **drag** passes through every bin between where it starts and where it
 *   ends, and only the one it lands on is ever seen. Pacing swallows the rest —
 *   which is the whole point of `makeSettler`.
 * - **Playback** passes through the same bins, and every one of them is the
 *   thing being watched. Pacing swallows the animation whole: the window moves
 *   every frame, so the cooldown restarts before it can expire, and the scene
 *   changes only when the play button is pressed again. Measured on the smoke
 *   layer: twelve seconds of playback asked the tile server for one date, and
 *   the second one arrived three seconds after pausing.
 *
 * Letting playback through costs nothing it does not already spend, because the
 * reconcile it triggers is idempotent: `applyZarrLabel` and
 * `setRasterLayerVisible` both return early when the layer already shows what
 * was asked for. So a frame that lands inside the same bin dispatches nothing,
 * and the scene changes exactly once per bin crossed — at whatever speed the
 * animation is set to, which is the user's own control rather than a constant
 * invented here.
 *
 * Before the map has opened, nothing is paced either: those frames are a
 * conversation rather than a burst — see `scheduleNow`.
 *
 * Kept here, taking plain booleans, so the rule can be read and tested without
 * a store: the timelines are the ones that know how to ask kepler.
 */
export function pacingFor({ opened, animating }: { opened: boolean; animating: boolean }): 'paced' | 'immediate' {
  return opened && !animating ? 'paced' : 'immediate';
}

/** Runs `job` at the start of a burst of calls and once more at its end. */
export function makeSettler(waitMs: number, job: () => void): Settler {
  let cooldown: ReturnType<typeof setTimeout> | null = null;
  let leadingQueued = false;
  /** Something asked while the job was cooling down. */
  let owed = false;

  const startCooldown = () => {
    cooldown = setTimeout(() => {
      cooldown = null;
      if (owed) {
        owed = false;
        job();
        // Another quiet period, so the run just made cannot itself count as
        // the start of the next burst.
        startCooldown();
      }
    }, waitMs);
  };

  return {
    schedule() {
      if (cooldown !== null) {
        // Restart the wait rather than letting it expire mid-drag. A drag longer
        // than `waitMs` would otherwise get a run per interval — a throttle —
        // and each of those is a whole screen of tiles for a scene nobody
        // stopped on. What is wanted is the bin the drag ends on, and only it.
        owed = true;
        clearTimeout(cooldown);
        startCooldown();
        return;
      }
      if (leadingQueued) {
        return;
      }
      // A microtask, not a synchronous call: this runs inside kepler's store
      // subscription, and dispatching from there re-enters its reducer.
      leadingQueued = true;
      void Promise.resolve().then(() => {
        leadingQueued = false;
        if (cooldown === null) {
          job();
          startCooldown();
        }
      });
    },

    scheduleNow() {
      if (leadingQueued) {
        return;
      }
      leadingQueued = true;
      void Promise.resolve().then(() => {
        leadingQueued = false;
        job();
      });
    },

    cancel() {
      if (cooldown !== null) {
        clearTimeout(cooldown);
        cooldown = null;
      }
      owed = false;
      leadingQueued = false;
    },
  };
}
