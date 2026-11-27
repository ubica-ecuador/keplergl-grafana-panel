import { css } from '@emotion/css';

/**
 * The map's controls in front of a swipe's left map.
 *
 * In a swipe, kepler stacks the two maps (`maps-layout.js`): the right-hand
 * one first, full size, then the left one over it, clipped (`clip-path`) to the
 * left of the handle. Each sits in a wrapper with `z-index: 0`, and kepler
 * draws the map's controls — the toolbar and the panels it opens, Light &
 * Shadow's among them — on the right-hand map only. So the controls were
 * confined to the bottom wrapper, and wherever the handle was dragged right
 * over them the left map covered them: a panel cut at the handle, its left part
 * gone and out of reach.
 *
 * The right-hand map's wrapper (the one followed by the clipped one) is made no
 * stacking context of its own (`z-index: auto`), so what it holds stands among
 * the maps' wrappers. The right-hand map itself (`z-index: 0`) comes first in
 * the page and so stays under the left map, while the controls (`z-index: 10`)
 * rise above it, as on a map that is not split. What else it holds with a
 * z-index of 1 — the scale and the credits, which read the same on both sides,
 * and kepler's transparent drop target — shows over the left map too. Dual
 * maps, side by side, are not wrapped and are left as they are.
 */
export const swipeControlsStyles = css`
  & .maps > div:has(+ div[style*='clip-path']) {
    z-index: auto;
  }
`;
