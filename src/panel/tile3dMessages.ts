/**
 * The English the 3D tile layer's two extra knobs need kepler to know.
 *
 * kepler renders every label in its side panel through react-intl, by message
 * id: an id with no message renders as the id itself, capitalised word by word
 * by the panel's CSS — so an unregistered label reads "Tile3D.GroundTileset"
 * where a sentence should be.
 *
 * The sibling of `flowFieldMessages.ts`, and deliberately a separate file: the
 * flow field's catalogue is already long, and these belong to a layer kepler
 * ships rather than to one this plugin adds.
 */

/** Message id → English, flat, the shape kepler's catalogues take. */
export const TILE3D_MESSAGES: Record<string, string> = {
  'tile3d.group.position': 'Position',
  'tile3d.groundTileset': 'Sit on the ground',
  'tile3d.altitudeOffset': 'Height adjustment (m)',
};

/**
 * Adds them to every locale kepler ships.
 *
 * The same English in all of them, for the reason the flow field gives: the
 * rest of this panel's interface is English, and a reader is better served by
 * "Sit on the ground" than by `tile3d.groundTileset`.
 *
 * Existing entries are never overwritten, so a future kepler that grows its own
 * altitude control keeps its own words.
 */
export function registerTile3dMessages(catalogues: Record<string, Record<string, string>>): void {
  for (const messages of Object.values(catalogues)) {
    for (const [id, text] of Object.entries(TILE3D_MESSAGES)) {
      if (!(id in messages)) {
        messages[id] = text;
      }
    }
  }
}
