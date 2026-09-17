import { SYMBOL_MESSAGES, registerSymbolMessages } from './symbolMessages';
import { SYMBOL_VIS_CONFIGS } from './symbolLayer';

describe('registerSymbolMessages', () => {
  it('teaches every locale the layer’s words without overwriting kepler’s', () => {
    const catalogues: Record<string, Record<string, string>> = {
      en: { 'layer.type.point': 'Point' },
      es: { 'layer.type.point': 'Punto' },
    };

    registerSymbolMessages(catalogues);

    expect(catalogues.en['symbol.symbol']).toBe('Shape');
    expect(catalogues.es['symbol.symbol']).toBe('Shape');
    expect(catalogues.es['layer.type.point']).toBe('Punto');
  });

  it('names every knob the layer registers, and every choice it offers', () => {
    // A label with no message renders as its own id, capitalised word by word
    // by the panel's CSS: the tell is a label reading "Symbol.Symbolsize".
    for (const knob of Object.values(SYMBOL_VIS_CONFIGS) as Array<Record<string, unknown>>) {
      const label = knob?.label;
      if (typeof label !== 'string' || !label.startsWith('symbol.')) {
        continue;
      }
      expect(SYMBOL_MESSAGES[label]).toBeDefined();
      // The symbol selector's options are the whole catalogue, which is named
      // by the glyph names themselves — only the small enumerations need one
      // message per option.
      if (Array.isArray(knob.options) && knob.options.length <= 8) {
        for (const option of knob.options as string[]) {
          expect(SYMBOL_MESSAGES[`${label}.${option}`]).toBeDefined();
        }
      }
    }
  });

  it('names the columns the layer asks for', () => {
    expect(SYMBOL_MESSAGES['layer.type.symbol']).toBe('Symbols');
  });
});
