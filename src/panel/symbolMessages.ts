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

  'symbol.symbol': 'Shape',
  'symbol.directionConvention': 'Direction is',
  'symbol.directionConvention.from': 'Where it comes from',
  'symbol.directionConvention.towards': 'Where it goes',
  'symbol.angleDegrees': 'Angle (°), when no column',
  'symbol.symbolSize': 'Size (px)',
  'symbol.sizeRange': 'Size range (px)',
  'symbol.fixedAngle': 'Use the column’s degrees',
  'symbol.fixedSize': 'Use the column’s number',
  'symbol.declutter': 'Thin overlapping symbols',
  'symbol.declutterSpacingPx': 'Minimum spacing (px)',
  'symbol.gradient': 'Lighten towards the tail',
  'symbol.gradientTail': 'Tail lightness',
  'symbol.upright': 'Stand upright in 3D',
  'symbol.outline': 'Outline',
  'symbol.outlineColor': 'Outline colour',
  'symbol.outlineThickness': 'Outline thickness',
  'symbol.shadow': 'Shadow',
  'symbol.shadowOpacity': 'Shadow intensity',
  'symbol.shadowDistance': 'Shadow distance (px)',

  'symbol.symbolSource': 'Draw',
  'symbol.symbolSource.shape': 'A shape',
  'symbol.symbolSource.picture': 'A picture',
  'symbol.pictureUrl': 'Picture URL',
  'symbol.pictureAnchor': 'Anchor',
  'symbol.pictureAnchor.center': 'Centre',
  'symbol.pictureAnchor.bottom': 'Bottom',
  // kepler labels a column with the message `columns.<name>`.
  'columns.picture': 'picture URL',

  'symbol.picture.upload': 'Upload…',
  'symbol.picture.uploaded': 'Uploaded picture ({kb} KB)',
  'symbol.picture.useUrl': 'Use a URL instead',
  'symbol.picture.tooLarge': 'The file is larger than 75 KB',
  'symbol.picture.notImage': 'Not an image',
  'symbol.picture.failed': '{failed} of {total} pictures could not load',
  'symbol.picture.overflow': '{overflow} pictures over the {max} limit use the layer picture',
  'symbol.picture.problem.scheme': 'Only https, http and data:image URLs',
  'symbol.picture.problem.mixed-content': 'An http picture cannot load on an https Grafana',
  'symbol.picture.problem.load':
    'Could not load — the server may not allow cross-origin use (CORS), or the URL is wrong',
  'symbol.picture.problem.timeout': 'Timed out after 15 s',
  'symbol.picture.problem.decode': 'The file is not an image deck can read',
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
