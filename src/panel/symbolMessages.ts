/**
 * The English the symbol layer needs kepler to know.
 *
 * kepler renders every label in its side panel through react-intl, by id: an id
 * with no message renders as the id itself, capitalised word by word by the
 * panel's CSS. `flowFieldMessages.ts` says the rest.
 *
 * The symbol selector is deliberately absent from this catalogue: its options
 * are the glyph names, several hundred of them, and a name like `airport` is
 * already the word a person wants to read.
 */
export const SYMBOL_MESSAGES: Record<string, string> = {
  'layer.type.symbol': 'Symbols',

  'symbol.group.symbol': 'Symbol',
  'symbol.group.rotation': 'Rotation',
  'symbol.group.size': 'Size',

  'symbol.symbol': 'Symbol',
  'symbol.directionConvention': 'Direction is',
  'symbol.directionConvention.from': 'Where it comes from',
  'symbol.directionConvention.towards': 'Where it goes',
  'symbol.angleDegrees': 'Angle (°), when no column',
  'symbol.symbolSize': 'Size (px)',
  'symbol.sizeRange': 'Size range (px)',
  'symbol.fixedAngle': 'Use the column’s degrees',
  'symbol.fixedSize': 'Use the column’s number',
};

/** Adds them to every locale kepler ships, never overwriting an existing entry. */
export function registerSymbolMessages(catalogues: Record<string, Record<string, string>>): void {
  for (const messages of Object.values(catalogues)) {
    for (const [id, text] of Object.entries(SYMBOL_MESSAGES)) {
      if (!(id in messages)) {
        messages[id] = text;
      }
    }
  }
}
