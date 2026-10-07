/**
 * What sets the Plus pages apart from the free panel's: they live under
 * `/plus/`, and carry the Plus edition's name and logo in the nav bar and the
 * browser tab.
 */
export const PLUS_TITLE = 'Kepler Geospatial Maps Plus';
export const PLUS_LOGO = '/logo-plus.svg';

/** `relativePath` is the page's source path, e.g. `plus/layers/gauge.md`. */
export function isPlusPage(relativePath: string): boolean {
  return relativePath.startsWith('plus/');
}
