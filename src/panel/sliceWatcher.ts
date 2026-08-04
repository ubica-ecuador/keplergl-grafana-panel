/**
 * A memory of which parts of a redux state a subscriber last saw.
 *
 * `store.subscribe` fires for every action, and kepler dispatches a great many
 * that have nothing to do with time: panning the map, hovering a point, opening
 * a panel. Each of those used to cost every sync hook a scheduled reconcile —
 * a `getState`, a handful of lookups, and for the variable syncs a fresh
 * `URLSearchParams` — once per pointer event, four hooks over.
 *
 * A redux reducer hands back a new object only for the slice it changed, so
 * comparing slice identity is enough to tell whether a notification is worth
 * reacting to, and it costs one reference comparison each.
 *
 * Free of kepler and React so it can be unit-tested with plain objects.
 */
export class SliceWatcher {
  private last: readonly unknown[] | null = null;

  /**
   * True when any slice differs from the last observation, and always on the
   * first. Adopts `slices` either way, so a repeat of a change is quiet.
   */
  changed(slices: readonly unknown[]): boolean {
    const previous = this.last;
    this.last = slices;

    if (previous === null || previous.length !== slices.length) {
      return true;
    }
    return slices.some((slice, i) => slice !== previous[i]);
  }
}
