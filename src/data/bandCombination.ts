/**
 * The band combinations a raster query can be drawn with, and how each reaches
 * the screen.
 *
 * One table rather than conditionals spread across the panel: what changes
 * between "true colour" and "forest burn" is which url of the row is drawn,
 * who turns it into pixels, and with what — and every one of those answers
 * belongs in the same place, where they can be read against each other.
 *
 * Why three paths and not one, measured on this deployment's own TiTiler:
 * compositing three bands server-side is one request of ~116 KB, while kepler's
 * own raster layer fetches each band as `.npy` — three requests and ~768 KB for
 * the same picture. The indices cannot take that road: `/stac/tiles` rejects
 * `expression` here (400 "Invalid band/asset name" for every spelling tried),
 * so kepler fetches their two bands and colours them in its shader. True colour
 * keeps the already-composed `visual` image it has always used: it is the one
 * path that works today and the one nobody needs restyled.
 */
export type BandCombination = 'trueColor' | 'forestBurn' | 'infrared' | 'nbr' | 'ndmi';

/** How one combination is drawn. */
export interface BandRecipe {
  /** Which url of the scene it draws: the composed image, or the STAC item. */
  source: 'visual' | 'item';
  /** Who turns it into pixels: the tile server, or kepler's raster layer. */
  renderer: 'painted' | 'kepler';
  /** Assets to composite, in RGB order — painted combinations only. */
  assets?: string[];
  /** One stretch per asset, as TiTiler's `min,max` — painted combinations only. */
  rescale?: string[];
  /** kepler's preset id — kepler-rendered combinations only. */
  preset?: string;
  /** Colour ramp for an index — kepler-rendered combinations only. */
  colormap?: string;
}

/**
 * The stretches are starting values for Sentinel-2 surface reflectance, chosen
 * to be checked by eye rather than trusted: a stretch too wide washes the scene
 * out, too narrow and it clips to black.
 */
export const BAND_COMBINATIONS: Record<BandCombination, BandRecipe> = {
  trueColor: { source: 'visual', renderer: 'kepler' },
  forestBurn: {
    source: 'item',
    renderer: 'painted',
    assets: ['swir22', 'nir', 'blue'],
    rescale: ['0,4000', '0,4000', '0,4000'],
  },
  infrared: {
    source: 'item',
    renderer: 'painted',
    assets: ['nir', 'red', 'green'],
    rescale: ['0,3000', '0,3000', '0,3000'],
  },
  nbr: { source: 'item', renderer: 'kepler', preset: 'nbr', colormap: 'rdylgn' },
  ndmi: { source: 'item', renderer: 'kepler', preset: 'ndmi', colormap: 'rdylbu' },
};

/**
 * The combination a panel option names, or true colour.
 *
 * An unrecognised value degrades to true colour rather than drawing nothing: a
 * dashboard variable that has not resolved yet arrives as its own name, and a
 * map that shows yesterday's picture beats a map that shows nothing while
 * someone works out why.
 */
export function resolveBandCombination(raw?: string): BandCombination {
  const value = (raw ?? '').trim();
  return value in BAND_COMBINATIONS ? (value as BandCombination) : 'trueColor';
}
