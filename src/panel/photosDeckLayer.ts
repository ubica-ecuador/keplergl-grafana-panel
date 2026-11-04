import { IconLayer } from '@deck.gl/layers';

import type { PhotosDeckLayersFactory } from './photosLayer';

/**
 * The deck.gl layers for `photosLayer.ts`: a frame, then the picture over it.
 *
 * IconLayer fetches each picture by its address and packs it into its atlas,
 * so nothing here downloads anything. It cannot crop, so a round frame holds
 * the square picture inscribed in it.
 */

const FRAMES = {
  square: svg('<rect width="64" height="64"/>'),
  circle: svg('<circle cx="32" cy="32" r="32"/>'),
};

/** A transparent pixel, for a row without a picture. */
const EMPTY = svg('');

/** A picture is asked for at this size and scaled on the map. */
const PHOTO_PIXELS = 128;

/** The square inscribed in a circle is this much of its diameter. */
const INSCRIBED = Math.SQRT1_2;

export const buildPhotosDeckLayers: PhotosDeckLayersFactory = ({
  shared,
  getPhoto,
  size,
  kind,
  border,
  borderColor,
}) => {
  const id = String(shared.id);
  const picture = kind === 'circle' ? (size + 2 * border) * INSCRIBED : size;
  return [
    new IconLayer({
      ...shared,
      id: `${id}-frame`,
      getIcon: () => ({ url: FRAMES[kind], width: 64, height: 64, mask: true, id: `frame-${kind}` }),
      getColor: borderColor,
      getSize: size + 2 * border,
      sizeUnits: 'pixels',
    } as never),
    new IconLayer({
      ...shared,
      id: `${id}-photo`,
      getIcon: (d: { index: number }) => {
        const url = getPhoto(d);
        return { url: url ?? EMPTY, width: PHOTO_PIXELS, height: PHOTO_PIXELS, id: url ?? 'empty' };
      },
      getSize: picture,
      sizeUnits: 'pixels',
    } as never),
  ];
};

function svg(body: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="white">${body}</svg>`
  )}`;
}
