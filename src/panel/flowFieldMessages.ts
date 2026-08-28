/**
 * The English the flow field layer needs kepler to know.
 *
 * kepler renders every label in its side panel through react-intl, by message
 * id: a component is handed `layer.type.flowfield` or `flowfield.density` and
 * looks it up. An id with no message renders as the id itself, capitalised word
 * by word by the panel's own CSS — which is why an unregistered layer type reads
 * "Layer.Type.Flowfield" under its name in the layer list.
 *
 * Registering rather than passing literal strings, because passing a literal
 * only moves the problem: it becomes the id, missing from every catalogue, and
 * react-intl logs it as such on every render.
 */

/** Message id -> English, flat, the shape kepler's catalogues take. */
export const FLOW_FIELD_MESSAGES: Record<string, string> = {
  'layer.type.flowfield': 'Flow field',

  'flowfield.group.streamlines': 'Streamlines',
  'flowfield.group.animation': 'Animation',
  'flowfield.group.field': 'Field',

  'flowfield.density': 'Lines per screen',
  'flowfield.lineLength': 'Line length',
  'flowfield.thickness': 'Line width',
  'flowfield.trailShare': 'Trail length (% of cycle)',
  'flowfield.cycleSeconds': 'Cycle (seconds)',
  'flowfield.lifeFraction': 'Line lifetime (share of cycle)',
  'flowfield.smoothing': 'Smoothing (cells)',
  'flowfield.heightMeters': 'Height (m), when no column',
  'flowfield.elevationScale': 'Vertical exaggeration',
  'flowfield.colorBySpeed': 'Colour by speed',

  // The column pickers kepler renders for this layer's two column modes. It
  // knows `lat`, `lng` and `altitude` already; the four that name a velocity
  // have never been columns of anything before — until now they were read from
  // the query and consumed to trace, and never reached kepler as columns at all.
  'columns.u': 'u (eastward)',
  'columns.v': 'v (northward)',
  'columns.speed': 'speed',
  'columns.direction': 'direction (from)',
};

/**
 * Adds them to every locale kepler ships.
 *
 * The same English in all eight: the rest of this panel's interface is English,
 * and a Spanish user reading "Lines per screen" is better served than one
 * reading `flowfield.density`. Existing entries are never overwritten, so a
 * future kepler that grows its own flow field keeps its own words.
 */
export function registerFlowFieldMessages(catalogues: Record<string, Record<string, string>>): void {
  for (const messages of Object.values(catalogues)) {
    for (const [id, text] of Object.entries(FLOW_FIELD_MESSAGES)) {
      if (!(id in messages)) {
        messages[id] = text;
      }
    }
  }
}
