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

/** The atlas, painted the first time a vector field is drawn and shared after. */
function vectorFieldAtlas() {
  if (!atlas) {
    const glyphs = glyphCatalogue();
    const { width, height } = atlasSize(glyphs.length);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('vector field: no 2D canvas to paint the symbols into');
    }
    atlas = { canvas, mapping: paintAtlas(glyphs, ctx as unknown as Painter) };
  }
  return atlas;
}

/** Builds the icon layer, in the shape `makeVectorFieldLayer` asks for. */
export const buildVectorFieldDeckLayer = (props: Record<string, unknown>): unknown => {
  const { canvas, mapping } = vectorFieldAtlas();
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
