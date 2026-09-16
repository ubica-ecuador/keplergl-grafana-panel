/**
 * Thins symbols that would overlap on screen.
 *
 * One per cell of a grid, keeping the heaviest — the fastest wind, the
 * largest magnitude — because that is the one a reader would have looked at
 * anyway. Off by default in the layer: hiding data nobody asked to hide is
 * worse than a crowded map.
 *
 * `spacing` is in whatever units `project` returns — this function has no
 * opinion on what those are. The symbol layer projects to ground degrees, not
 * screen pixels, so a floor written for pixels would silently round a small,
 * legitimate spacing up to a much larger one; the caller is what decides
 * whether a spacing is too small to use (`spacingDegrees > 0`).
 *
 * Ours rather than deck's `CollisionFilterExtension`: that lives in
 * `@deck.gl/extensions`, which is not a dependency of this plugin, and adding
 * it risks a second copy of deck in the bundle.
 */
export function thinBySpacing<T>(
  rows: T[],
  project: (row: T) => [number, number] | null,
  spacing: number,
  weightOf: (row: T) => number
): T[] {
  const best = new Map<string, { row: T; weight: number }>();

  for (const row of rows) {
    const point = project(row);
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      continue;
    }
    const cell = `${Math.floor(point[0] / spacing)},${Math.floor(point[1] / spacing)}`;
    const weight = Number(weightOf(row));
    const held = best.get(cell);
    if (!held || (Number.isFinite(weight) && weight > held.weight)) {
      best.set(cell, { row, weight: Number.isFinite(weight) ? weight : -Infinity });
    }
  }

  return [...best.values()].map((entry) => entry.row);
}
