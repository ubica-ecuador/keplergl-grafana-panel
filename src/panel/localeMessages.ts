/**
 * Names for the layer types this plugin adds.
 *
 * kepler renders a layer's type through `intl`, under `layer.type.<type>`, and
 * ships translations for its own types only. A type contributed by a plugin
 * therefore shows react-intl's rendering of a missing id — `Layer.Type.Zarr`,
 * `Layer.Type.Esriimage` — wherever a layer is named: the layer list, the "Add
 * Layer" menu, the tooltips.
 *
 * `KeplerGl` takes the whole message catalogue as a prop, so the fix is to hand
 * it kepler's own with these folded in.
 */

/**
 * The flow field's name as its messages show it: one word, with a soft hyphen.
 *
 * "Streamlines" is 70 px wide in kepler's layer menu, whose tile labels are
 * 50 px, and a word that cannot break runs into the tile beside it. The soft
 * hyphen shows nothing where the word fits — the layer card — and splits it as
 * "Stream-" / "lines" where it does not. The layer's `name`, which the menu's
 * search matches against, stays plain.
 */
export const STREAMLINES_LABEL = 'Stream\u00ADlines';

/**
 * Layer type → the name to show, keyed exactly as kepler will look it up.
 *
 * **Lower-case keys.** kepler builds the id from the layer's type run through
 * `toLowerCase`, so `esriImage` is looked up as `layer.type.esriimage`; a key
 * spelled the way the class spells it would never be found.
 *
 * **The flow field is the exception.** Its type, `flowfield`, lower-cases to
 * the same id as kepler's own `flowField`, so a name under `flowfield` would be
 * read out for both. It is named under `streamlines` — the id its name gives in
 * the layer menu, and the one `layerPanelHeader.tsx` sends its card to.
 */
export const OWN_LAYER_LABELS: Record<string, string> = {
  zarr: 'Zarr',
  cogpainted: 'Raster (painted)',
  esriimage: 'ArcGIS Image Service',
  streamlines: STREAMLINES_LABEL,
  vectorfield: 'Vector field',
  symbol: 'Symbols',
  markers: 'Markers',
};

/** kepler's message catalogue: locale → flat id → text. */
type Messages = Record<string, Record<string, string>>;

/**
 * kepler's catalogue with this plugin's layer names folded into every locale.
 *
 * A copy, never a mutation: `messages` is module state shared with anything
 * else that imports it, and a plugin quietly editing it would be a surprise
 * waiting for whoever imports it next.
 *
 * The same name goes into every language on purpose. These are proper nouns —
 * Zarr is Zarr, an ArcGIS Image Service is one in any language — and the
 * alternative is leaving every locale but English showing the raw id.
 */
export function withOwnLayerLabels(messages: Messages): Messages {
  const own = Object.fromEntries(
    Object.entries(OWN_LAYER_LABELS).map(([type, label]) => [`layer.type.${type}`, label])
  );

  return Object.fromEntries(
    Object.entries(messages).map(([locale, catalogue]) => [locale, { ...catalogue, ...own }])
  );
}
