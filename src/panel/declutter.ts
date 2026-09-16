/**
 * Thins symbols that would overlap on screen.
 *
 * One per cell of a pixel grid, keeping the heaviest — the fastest wind, the
 * largest magnitude — because that is the one a reader would have looked at
 * anyway. Off by default in the layer: hiding data nobody asked to hide is
 * worse than a crowded map.
 *
 * Ours rather than deck's `CollisionFilterExtension`: that lives in
 * `@deck.gl/extensions`, which is not a dependency of this plugin, and adding
 * it risks a second copy of deck in the bundle.
 */
export function thinBySpacing<T>(
  rows: T[],
  project: (row: T) => [number, number] | null,
  spacingPx: number,
  weightOf: (row: T) => number
): T[] {
  const spacing = Math.max(1, spacingPx);
  const best = new Map<string, { row: T; weight: number }>();

  for (const row of rows) {
    const screen = project(row);
    if (!screen || !Number.isFinite(screen[0]) || !Number.isFinite(screen[1])) {
      continue;
    }
    const cell = `${Math.floor(screen[0] / spacing)},${Math.floor(screen[1] / spacing)}`;
    const weight = Number(weightOf(row));
    const held = best.get(cell);
    if (!held || (Number.isFinite(weight) && weight > held.weight)) {
      best.set(cell, { row, weight: Number.isFinite(weight) ? weight : -Infinity });
    }
  }

  return [...best.values()].map((entry) => entry.row);
}
