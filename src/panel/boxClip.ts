import { ClipExtension } from '@deck.gl/extensions';

/**
 * The one clip extension every picture cut to its box shares: a WMS's
 * (`wmsDeckLayer.ts`) and every tile of a query's tiles (`xyzTileDeckLayer.ts`).
 *
 * One instance rather than one per render: deck compares a layer's extensions
 * on every update, and a new instance each time reads as a new extension, which
 * recompiles the bitmap's shaders on every frame the view moves.
 *
 * deck's own, from `@deck.gl/extensions` — the copy kepler already loads for
 * its data filter, pinned to the same version by the overrides, so no second
 * deck comes with it.
 */
export const BOX_CLIP = new ClipExtension();
