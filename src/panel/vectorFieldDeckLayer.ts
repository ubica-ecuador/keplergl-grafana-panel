import { IconLayer } from '@deck.gl/layers';

import { atlasSize, glyphCatalogue, IconFrame, paintAtlas, Painter } from './vectorFieldGlyphs';

/**
 * The deck.gl layer that draws a vector field's symbols.
 *
 * The atlas is handed to deck as a canvas, never as a URL. Given a URL,
 * `IconLayer` fetches it, and Grafana's strict Content-Security-Policy has no
 * `data:` in `connect-src` — `img-src` allows it, but a fetch is not an image
 * request — so a data URL atlas draws nothing on :3001 and says why nowhere.
 * deck turns an image object straight into a texture.
 */

let atlas: { canvas: HTMLCanvasElement; mapping: Record<string, IconFrame> } | null = null;

/**
 * The atlas, painted the first time a vector field is drawn and shared after.
 *
 * Returns null rather than throwing when there is no 2D context to paint
 * into — a browser out of canvas contexts, say. This runs inside kepler's own
 * layer rendering, one layer among many on the map; a thrown error there
 * would take the whole render pass down instead of costing just this layer's
 * symbols. Nothing is cached on that path, so the next call tries again
 * rather than remembering the failure as if it were a built atlas.
 */
function vectorFieldAtlas(): { canvas: HTMLCanvasElement; mapping: Record<string, IconFrame> } | null {
  if (!atlas) {
    const glyphs = glyphCatalogue();
    const { width, height } = atlasSize(glyphs.length);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    atlas = { canvas, mapping: paintAtlas(glyphs, ctx as unknown as Painter) };
  }
  return atlas;
}

/** Builds the icon layer, in the shape `makeVectorFieldLayer` asks for — or null when the atlas could not be painted. */
export const buildVectorFieldDeckLayer = (props: Record<string, unknown>): unknown => {
  const built = vectorFieldAtlas();
  if (!built) {
    return null;
  }
  const { canvas, mapping } = built;
  return new IconLayer({
    iconAtlas: canvas,
    iconMapping: mapping,
    getPosition: (symbol: { position: [number, number, number] }) => symbol.position,
    // Pixels, so a symbol reads the same at every zoom — the screen grid is
    // spaced in pixels too.
    sizeUnits: 'pixels',
    // Lying on the map rather than facing the camera, so a symbol turns with
    // the map's bearing and tilts with its pitch: its angle is a compass
    // bearing on the ground, not on the screen.
    billboard: false,
    ...props,
  } as never);
};
