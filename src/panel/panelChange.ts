import type { KeplerPanelOptions } from '../types';

/** The commercial panel, whose options are a superset of this one's under the same paths. */
export const PLUS_PANEL_ID = 'ubica-keplerplus-panel';

/**
 * What a Kepler Plus panel keeps when its visualization changes to this one:
 * every option, its saved map included, as Plus keeps a free panel's.
 *
 * The options only Plus reads ride along unread, so going back to Plus finds
 * them where they were. In the saved map, a layer of a type only Plus draws is
 * left out by kepler when the map loads, and the rest of the map draws.
 */
export function fromPlusPanel(prevOptions: Record<string, unknown> | undefined): Partial<KeplerPanelOptions> {
  return { ...(prevOptions as Partial<KeplerPanelOptions> | undefined) };
}
