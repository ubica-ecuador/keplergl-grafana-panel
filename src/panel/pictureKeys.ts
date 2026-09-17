/**
 * What names a picture, where it may come from, and how it sits in its cell.
 *
 * Pure, so everything that can be wrong about a picture before it loads is
 * testable without a browser: jest has neither a canvas nor image decoding.
 */

/** The side of the square every picture is rasterised into, in pixels. */
export const PICTURE_CELL = 128;

export type PictureAnchor = 'center' | 'bottom';

/** Why a picture is not drawn, as the layer panel names it. */
export type PictureProblem = 'scheme' | 'mixed-content' | 'load' | 'timeout' | 'decode';

/** An icon as deck's auto-packing `IconLayer` wants it from `getIcon`. */
export interface PictureIcon {
  id: string;
  url: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  mask: false;
}

export interface PictureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function pictureAnchorOf(value: unknown): PictureAnchor {
  return value === 'bottom' ? 'bottom' : 'center';
}

const KEY_PREFIX = 'picture:';
const KEY_SUFFIX = ':end';

/**
 * The string deck is handed as an icon's id and url, and that comes back to
 * this plugin's fetch.
 *
 * Never the picture's own URL: loaders.gl decides from the URL whether an
 * image is an SVG (`/\.svg((\?|#).*)?$/`), and decodes one through a `blob:`
 * URL that Grafana's `img-src * data:` does not allow. The suffix keeps a key
 * from ending in `.svg`, and `encodeURIComponent` escapes the `?` and `#` the
 * pattern also looks for. The anchor is part of the key because it changes the
 * pixels painted.
 */
export function pictureKey(url: string, anchor: PictureAnchor): string {
  return `${KEY_PREFIX}${anchor}:${encodeURIComponent(url)}${KEY_SUFFIX}`;
}

export function parsePictureKey(key: string): { url: string; anchor: PictureAnchor } | null {
  if (!key.startsWith(KEY_PREFIX) || !key.endsWith(KEY_SUFFIX)) {
    return null;
  }
  const body = key.slice(KEY_PREFIX.length, -KEY_SUFFIX.length);
  const colon = body.indexOf(':');
  const anchor = body.slice(0, colon);
  if (colon < 0 || (anchor !== 'center' && anchor !== 'bottom')) {
    return null;
  }
  try {
    return { url: decodeURIComponent(body.slice(colon + 1)), anchor };
  } catch {
    // A malformed escape: not a key this module made.
    return null;
  }
}

/**
 * Why a picture at this URL cannot load on this page, or null when it can.
 *
 * Resolved against the page, so a path on Grafana's own origin is as good as
 * a full URL. An `http:` picture on an `https:` page is refused here rather
 * than left to the browser, which blocks it as mixed content and says so only
 * in the console.
 */
export function checkPictureUrl(url: string, pageHref: string): PictureProblem | null {
  const trimmed = url.trim();
  if (trimmed === '') {
    return 'scheme';
  }
  if (/^data:image\//i.test(trimmed)) {
    return null;
  }
  let resolved: URL;
  try {
    resolved = new URL(trimmed, pageHref);
  } catch {
    return 'scheme';
  }
  if (resolved.protocol === 'https:') {
    return null;
  }
  if (resolved.protocol === 'http:') {
    return new URL(pageHref).protocol === 'https:' ? 'mixed-content' : null;
  }
  return 'scheme';
}

/**
 * Where a picture is drawn inside its cell: as large as fits, keeping its
 * proportions, centred across and either centred or resting on the bottom.
 *
 * A picture with no size of its own — an SVG without width, height or a
 * view box — counts as square.
 */
export function fitPicture(naturalWidth: number, naturalHeight: number, anchor: PictureAnchor): PictureRect {
  const width = naturalWidth > 0 ? naturalWidth : PICTURE_CELL;
  const height = naturalHeight > 0 ? naturalHeight : PICTURE_CELL;
  const scale = Math.min(PICTURE_CELL / width, PICTURE_CELL / height);
  const drawnWidth = width * scale;
  const drawnHeight = height * scale;
  return {
    x: (PICTURE_CELL - drawnWidth) / 2,
    y: anchor === 'bottom' ? PICTURE_CELL - drawnHeight : (PICTURE_CELL - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
  };
}

/**
 * The icon deck packs for a picture: exactly the cell the fetch paints.
 *
 * Exact on purpose. deck resizes an image that does not match what `getIcon`
 * declared, and when it does it updates the width and height but not the
 * anchor, which is in absolute pixels — a bottom anchor would float.
 */
export function pictureIcon(url: string, anchor: PictureAnchor): PictureIcon {
  const key = pictureKey(url, anchor);
  return {
    id: key,
    url: key,
    width: PICTURE_CELL,
    height: PICTURE_CELL,
    anchorX: PICTURE_CELL / 2,
    anchorY: anchor === 'bottom' ? PICTURE_CELL : PICTURE_CELL / 2,
    mask: false,
  };
}
