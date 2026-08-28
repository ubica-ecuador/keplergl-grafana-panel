import { getApplicationConfig } from '@kepler.gl/utils';

import { configureKepler } from './keplerConfig';

describe('configureKepler', () => {
  /**
   * kepler ships two ways of splitting the map and only one of them works.
   *
   * `SplitMapButton` opens a Single/Dual/Swipe menu whenever `enableSwipeMode`
   * is on — kepler's default — and every entry dispatches `setMapSplitMode`,
   * which writes `mapState.mapSplitMode` and nothing else. But `KeplerGl`
   * builds its panes from `visState.splitMaps` (`kepler-gl.js`: `!isSplit ? [one]
   * : splitMaps.map(...)`), and only the older `TOGGLE_SPLIT_MAP` action ever
   * fills that array. So with the menu the map never divides: one pane keeps
   * drawing every layer.
   *
   * Turning swipe mode off makes the same button dispatch `toggleSplitMap`,
   * which fills `splitMaps` — giving both the second pane and the per-pane
   * visibility toggles the legend already knows how to draw.
   */
  it('disables swipe mode, whose menu sets a mode that never creates a pane', () => {
    configureKepler();

    expect(getApplicationConfig().enableSwipeMode).toBe(false);
  });
});
