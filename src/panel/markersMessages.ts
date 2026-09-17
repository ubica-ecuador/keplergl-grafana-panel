/**
 * The English the markers layer needs kepler to know — see `symbolMessages.ts`
 * for why a layer kepler does not ship has to register its own labels.
 */
export const MARKERS_MESSAGES: Record<string, string> = {
  'layer.type.markers': 'Markers',

  'markers.group.markers': 'Markers',
  'markers.group.display': 'Display',
  'markers.markers': 'Markers',
  'markers.symbol': 'Symbol',
  'markers.angleDegrees': 'Rotation (°)',
  'markers.markerRadius': 'Marker size (px)',
};

/** Adds them to every locale kepler ships, never overwriting an existing entry. */
export function registerMarkersMessages(catalogues: Record<string, Record<string, string>>): void {
  for (const messages of Object.values(catalogues)) {
    for (const [id, text] of Object.entries(MARKERS_MESSAGES)) {
      if (!(id in messages)) {
        messages[id] = text;
      }
    }
  }
}
