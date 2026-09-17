import { IconLayer } from '@deck.gl/layers';

import { PictureError, pictureFetchFor } from './pictureFetch';
import { parsePictureKey } from './pictureKeys';
import { recordPictureLoad } from './pictureState';

/**
 * The deck.gl layer that draws a picture per row.
 *
 * Handed no atlas, `IconLayer` packs its own from the icons `getIcon` names,
 * loads each through `loadOptions`, and redraws itself as each one arrives —
 * nothing needs kepler to render again. What it loads with is this plugin's
 * picture fetch; see `pictureFetch.ts` for why it is not loaders.gl's.
 */

/** The symbol layer's props that only its glyph atlases read. deck keeps any prop it is given. */
const GLYPH_ONLY_PROPS = ['picture', 'keplerLayerId', 'symbols', 'shadow', 'outline', 'gradient'];

export function buildPictureDeckLayer(props: Record<string, unknown>): unknown {
  const layerId = String(props.keplerLayerId ?? '');
  const rest: Record<string, unknown> = { ...props };
  for (const key of GLYPH_ONLY_PROPS) {
    delete rest[key];
  }

  return new IconLayer({
    getPosition: (row: { position: [number, number, number] }) => row.position,
    // Pixels, so a picture reads the same at every zoom.
    sizeUnits: 'pixels',
    billboard: false,
    ...rest,
    // `core.fetch`, not a top-level `fetch`: loaders.gl 4.4 keeps the latter
    // only as a deprecated alias.
    loadOptions: { core: { fetch: pictureFetchFor(layerId) } },
    // Called for any failed icon: one the fetch refused, which already said
    // why, or bytes loaders.gl could not decode, which nobody has.
    onIconError: (event: { url: string; error: unknown }) => {
      const parsed = parsePictureKey(event.url);
      if (parsed) {
        recordPictureLoad(layerId, parsed.url, event.error instanceof PictureError ? event.error.problem : 'decode');
      }
    },
  } as never);
}
