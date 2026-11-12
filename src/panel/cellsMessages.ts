/**
 * The English the Cells layer needs kepler to know — see `symbolMessages.ts` for why a layer kepler does not ship has
 * to register its own labels.
 */
export const CELLS_MESSAGES: Record<string, string> = {
  'cells.grid': 'Grid',
  'cells.system': 'Cell system',
  'cells.system.hint':
    'The global grid the points are counted in. Its level follows the zoom, so cells stay about the same size on screen.',
  'cells.system.h3': 'H3 (hexagons)',
  'cells.system.a5': 'A5 (equal-area pentagons)',
  'cells.system.s2': 'S2 (quads)',
  'cells.system.geohash': 'Geohash (rectangles)',
  'cells.size': 'Cell size (px)',
  'cells.size.hint': 'About how many pixels across a cell is drawn; the level is the one closest to it at this zoom.',
  'cells.transition': 'Transition (ms)',
  'cells.transition.hint':
    'How long a cell takes to reach its new colour (and height) when the zoom changes its level, a filter or a refresh: cells come out of their parent as you zoom in and merge into it as you zoom out. 0 snaps.',
  'cells.density': 'Per km²',
  'cells.density.hint': 'Divide each cell by its area, so the colours mean the same at every zoom.',
};

/** Adds them to every locale kepler ships, never overwriting an existing entry. */
export function registerCellsMessages(catalogues: Record<string, Record<string, string>>): void {
  for (const messages of Object.values(catalogues)) {
    for (const [id, text] of Object.entries(CELLS_MESSAGES)) {
      if (!(id in messages)) {
        messages[id] = text;
      }
    }
  }
}
