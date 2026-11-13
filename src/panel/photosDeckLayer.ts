import { buildPictureDeckLayer } from './pictureDeckLayer';
import { PictureIcon, pictureIcon } from './pictureKeys';
import type { PhotoKind, PhotoRow, PhotosDeckLayersFactory } from './photosLayer';

/**
 * The deck.gl layers for `photosLayer.ts`: a frame for every row, then the
 * picture over it for the rows that have one.
 *
 * Both are the symbol layer's picture icon layer (`pictureDeckLayer.ts`): deck
 * packs each icon into its own atlas, but every picture, the frames included,
 * loads through the plugin's picture fetch — the icons are named by key, never
 * by their URL — so nothing here asks loaders.gl to fetch a URL. An icon cannot
 * be cropped, so a round frame holds the square picture inscribed in it.
 */

const FRAMES: Record<PhotoKind, string> = {
  square: svg('<rect width="64" height="64"/>'),
  circle: svg('<circle cx="32" cy="32" r="32"/>'),
};

type FrameIcon = Omit<PictureIcon, 'mask'> & { mask: true };

/** A mask, so deck paints the frame in the layer's colour. */
const FRAME_ICONS: Record<PhotoKind, FrameIcon> = {
  square: { ...pictureIcon(FRAMES.square, 'center'), mask: true },
  circle: { ...pictureIcon(FRAMES.circle, 'center'), mask: true },
};

/** The square inscribed in a circle is this much of its diameter. */
const INSCRIBED = Math.SQRT1_2;

export const buildPhotosDeckLayers: PhotosDeckLayersFactory = ({
  shared,
  pictured,
  size,
  kind,
  border,
  borderColor,
}) => {
  const id = String(shared.id);
  const triggers = (shared.updateTriggers ?? {}) as Record<string, unknown>;
  const picture = kind === 'circle' ? (size + 2 * border) * INSCRIBED : size;
  const frame = FRAME_ICONS[kind];
  return [
    buildPictureDeckLayer({
      ...shared,
      id: `${id}-frame`,
      getIcon: () => frame,
      getColor: borderColor,
      getSize: size + 2 * border,
      // Facing the viewer on a tilted map, as Geomap's photos do.
      billboard: true,
      updateTriggers: { ...triggers, getIcon: kind },
    }),
    buildPictureDeckLayer({
      ...shared,
      id: `${id}-photo`,
      // Only the rows with a picture that can load: deck throws on a row with no icon.
      data: pictured.rows,
      getIcon: (row: PhotoRow) => pictured.icons.get(row.index),
      getSize: picture,
      billboard: true,
      updateTriggers: { ...triggers, getIcon: pictured.keys },
    }),
  ];
};

function svg(body: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="white">${body}</svg>`
  )}`;
}
