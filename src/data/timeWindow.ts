/**
 * A time window, in epoch ms — kepler's time filter, as the panel reads it.
 */
export interface TimeWindow {
  from: number;
  to: number;
}

/**
 * The item a time window selects: the most recent one it contains.
 *
 * "Most recent inside the window" rather than "nearest" on purpose. Dragging
 * the end of the slider back through the calendar should show what was on the
 * ground at that moment, and an image captured after it was not.
 *
 * With no window at all the newest item wins, which is what a map should open
 * on: the freshest thing there is. With a window that contains nothing, the
 * answer is null — a real state, not an error. The satellite did not pass in
 * those days; the service has no picture of that hour.
 *
 * Undated items are skipped rather than treated as ancient. A list with no
 * dated item at all yields null, and it is the caller's business to decide what
 * that means, because it means different things: for a raster query without a
 * time column it means "there is no timeline here, draw the one scene", and for
 * a service's date axis it means "there is nothing to walk".
 */
export function pickLatestWithin<T>(
  items: readonly T[],
  timeOf: (item: T) => number | null,
  window: TimeWindow | null
): T | null {
  let picked: T | null = null;
  let pickedAt = -Infinity;

  for (const item of items) {
    const time = timeOf(item);
    if (time === null || !Number.isFinite(time)) {
      continue;
    }
    if (window && (time < window.from || time > window.to)) {
      continue;
    }
    // `>=` rather than `>`: with equal timestamps the later row wins, which
    // keeps the answer stable against a list that was not sorted.
    if (time >= pickedAt) {
      picked = item;
      pickedAt = time;
    }
  }

  return picked;
}
