import { messages as keplerMessages } from '@kepler.gl/localization';

import { OWN_LAYER_LABELS, withOwnLayerLabels } from './localeMessages';

const SOFT_HYPHEN = '\u00AD';

/**
 * The names kepler shows for the layer types this plugin adds.
 *
 * kepler renders a layer type through `intl`, under `layer.type.<type>`, and
 * ships translations only for its own. A type a plugin contributes therefore
 * shows react-intl's fallback rendering of the missing id — `Layer.Type.Zarr`,
 * `Layer.Type.Esriimage` — in the layer list, in "Add Layer" and in every
 * tooltip that names a layer.
 */
describe('withOwnLayerLabels', () => {
  const merged = withOwnLayerLabels(keplerMessages);

  it('names every layer this plugin adds', () => {
    for (const [type, label] of Object.entries(OWN_LAYER_LABELS)) {
      expect(merged.en[`layer.type.${type}`]).toBe(label);
    }
  });

  it('uses the type kepler will actually look up, lower-cased', () => {
    // kepler lower-cases the layer type before building the id, so a key
    // spelled `esriImage` would never be found and the fallback would stand.
    for (const type of Object.keys(OWN_LAYER_LABELS)) {
      expect(type).toBe(type.toLowerCase());
    }
  });

  it('adds the names to every language kepler ships, not only English', () => {
    // A layer type is a proper noun here — "Zarr" is Zarr in any language — so
    // the same label goes everywhere rather than leaving other locales with the
    // raw id.
    for (const locale of Object.keys(keplerMessages)) {
      expect(merged[locale]['layer.type.zarr']).toBe(OWN_LAYER_LABELS.zarr);
    }
  });

  it('names the flow field Streamlines and leaves kepler’s Flow Field its own name', () => {
    // kepler's `flowField` and this plugin's `flowfield` both look their name
    // up as `layer.type.flowfield`; the panel header asks for this one under
    // `streamlines` instead (see `layerPanelHeader.tsx`).
    expect(merged.en['layer.type.streamlines'].replaceAll(SOFT_HYPHEN, '')).toBe('Streamlines');
    expect(merged.en['layer.type.flowfield']).toBe(keplerMessages.en['layer.type.flowfield']);
  });

  it('lets Streamlines break inside the layer menu’s tile', () => {
    // The tile's label is 50 px wide and "Streamlines" is one 70 px word: left
    // unbroken it runs into the tile beside it. A soft hyphen shows nothing
    // where the word fits — the layer card — and "Stream-" / "lines" where not.
    expect(merged.en['layer.type.streamlines']).toBe(`Stream${SOFT_HYPHEN}lines`);
  });

  it('leaves kepler’s own translations untouched', () => {
    expect(merged.en['layer.type.point']).toBe(keplerMessages.en['layer.type.point']);
    expect(Object.keys(merged.en).length).toBeGreaterThan(Object.keys(keplerMessages.en).length);
  });

  it('does not mutate the messages kepler exported', () => {
    // They are module state, shared with anything else that imports them.
    expect(keplerMessages.en['layer.type.zarr']).toBeUndefined();
  });
});
