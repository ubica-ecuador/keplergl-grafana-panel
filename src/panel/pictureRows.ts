import { checkPictureUrl, PictureAnchor, PictureIcon, pictureIcon, PictureProblem } from './pictureKeys';

/**
 * Which picture each row of a symbol layer draws, and which rows draw none.
 *
 * Pure: the rows, the column's reader and the layer's settings in, the
 * decision out. `symbolLayer.ts` records it and hands it to deck.
 */

/**
 * The different pictures one layer draws at most.
 *
 * deck packs every picture into one texture 1024 px wide that grows in powers
 * of two: 96 cells of 128 px fit in 1024×2048, about 11 MB with mipmaps; 128
 * would jump to 4096 tall.
 */
export const MAX_PICTURES = 96;

export interface PictureFailure {
  url: string;
  problem: PictureProblem;
}

export interface PictureAssignment<R> {
  /** The rows that draw, in the order given. */
  rows: R[];
  /** Each drawn row's icon, by the row's index. */
  icons: Map<number, PictureIcon>;
  /** The icon keys the drawn rows use, in order of first use. */
  keys: string[];
  /** The URLs behind those keys, in the same order. */
  urls: string[];
  failures: PictureFailure[];
  /** Different URLs left over once the cap was reached. */
  overflow: number;
}

export interface AssignOptions<R> {
  /** Reads a row's own picture, or null when no picture column is bound. */
  urlOf: ((row: R) => unknown) | null;
  layerPicture: unknown;
  anchor: PictureAnchor;
  pageHref: string;
  max?: number;
}

export function assignPictures<R extends { index: number }>(rows: R[], options: AssignOptions<R>): PictureAssignment<R> {
  const max = options.max ?? MAX_PICTURES;
  const accepted = new Map<string, PictureIcon>();
  const rejected = new Map<string, PictureProblem>();
  const overflowing = new Set<string>();

  const admit = (url: string): PictureIcon | null => {
    const known = accepted.get(url);
    if (known) {
      return known;
    }
    if (rejected.has(url) || overflowing.has(url)) {
      return null;
    }
    const problem = checkPictureUrl(url, options.pageHref);
    if (problem) {
      rejected.set(url, problem);
      return null;
    }
    if (accepted.size >= max) {
      overflowing.add(url);
      return null;
    }
    const icon = pictureIcon(url, options.anchor);
    accepted.set(url, icon);
    return icon;
  };

  const layerUrl = typeof options.layerPicture === 'string' ? options.layerPicture.trim() : '';
  // Admitted before any row, so the fallback always has a slot of its own.
  const layerIcon = layerUrl === '' ? null : admit(layerUrl);

  const drawn: R[] = [];
  const icons = new Map<number, PictureIcon>();
  const used = new Map<string, string>();

  for (const row of rows) {
    const raw = options.urlOf ? options.urlOf(row) : null;
    const own = typeof raw === 'string' ? raw.trim() : '';
    let icon: PictureIcon | null;
    if (own === '') {
      icon = layerIcon;
    } else {
      // A URL that cannot load leaves its row out rather than falling back: a
      // row showing the layer's picture would hide that its own is broken.
      icon = admit(own) ?? (overflowing.has(own) ? layerIcon : null);
    }
    if (icon) {
      drawn.push(row);
      icons.set(row.index, icon);
      used.set(icon.id, icon === layerIcon ? layerUrl : own);
    }
  }

  return {
    rows: drawn,
    icons,
    keys: [...used.keys()],
    urls: [...used.values()],
    failures: [...rejected].map(([url, problem]) => ({ url, problem })),
    overflow: overflowing.size,
  };
}

export interface GenerationRecord {
  generation: number;
  /** Every key deck has been asked to pack since this generation began. */
  seen: string[];
}

/**
 * The generation of a deck icon layer's texture after drawing these keys.
 *
 * deck never forgets an icon: its mapping only grows while its icon manager
 * lives. A dashboard whose pictures change on every refresh would fill the
 * texture, so once everything asked for since the generation began passes the
 * cap, a new generation — a fresh icon manager and texture, see
 * `PictureIconLayer` — starts with only what is drawn now.
 */
export function nextGeneration(
  previous: GenerationRecord | undefined,
  keys: string[],
  max = MAX_PICTURES
): GenerationRecord {
  const current = previous ?? { generation: 0, seen: [] };
  const union = new Set([...current.seen, ...keys]);
  if (union.size <= max) {
    return previous && union.size === current.seen.length ? previous : { generation: current.generation, seen: [...union] };
  }
  return { generation: current.generation + 1, seen: [...new Set(keys)] };
}
