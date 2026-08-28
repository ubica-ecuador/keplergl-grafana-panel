import { shownInPane } from './paneVisibility';

describe('shownInPane', () => {
  it('shows the layer when kepler is not splitting the map', () => {
    // No split: `renderDeckGlLayer` finds no per-pane list and says `true`.
    expect(shownInPane({ visible: true })).toBe(true);
  });

  it('hides the layer in the pane that switched it off', () => {
    expect(shownInPane({ visible: false })).toBe(false);
  });

  it('hides the layer in a pane that has not listed it', () => {
    // kepler splits by giving the left pane every layer and leaving the right
    // one empty — `computeSplitMapLayers` says so in as many words. It then
    // reads that list as `!mapLayers || mapLayers[layer.id]`, which for the
    // empty pane is `undefined`, not `false`; deck reads undefined as its
    // default, `true`, so the pane it meant to leave empty draws everything
    // and the two halves come out identical. Honour the intent: a pane that
    // has not listed a layer does not draw it.
    expect(shownInPane({ visible: undefined })).toBe(false);
  });

  it('shows the layer when no one passed a verdict at all', () => {
    // Callers outside the split path hand over no such key; they are not
    // saying "hide it", they are saying nothing.
    expect(shownInPane(undefined)).toBe(true);
    expect(shownInPane({})).toBe(true);
  });
});
