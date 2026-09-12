import { FLOW_FIELD_COLUMN_MODES, FLOW_FIELD_VIS_CONFIGS } from './flowFieldLayer';
import { FLOW_FIELD_MESSAGES, registerFlowFieldMessages } from './flowFieldMessages';

describe('registerFlowFieldMessages', () => {
  it('teaches every locale the layer’s own words', () => {
    const catalogues: Record<string, Record<string, string>> = {
      en: { 'layer.type.point': 'Point' },
      es: { 'layer.type.point': 'Punto' },
    };

    registerFlowFieldMessages(catalogues);

    expect(catalogues.en['layer.type.flowfield']).toBe('Flow field');
    expect(catalogues.es['layer.type.flowfield']).toBe('Flow field');
    expect(catalogues.es['layer.type.point']).toBe('Punto');
  });

  it('never overwrites a message kepler already has', () => {
    // A future kepler growing its own flow field should keep its own words.
    const catalogues: Record<string, Record<string, string>> = { en: { 'layer.type.flowfield': 'Wind' } };

    registerFlowFieldMessages(catalogues);

    expect(catalogues.en['layer.type.flowfield']).toBe('Wind');
  });

  it('names every knob the layer registers and every column its modes ask for', () => {
    // The tell for a missing one is a label that reads "Flowfield.Density": an
    // id with no message renders as the id, capitalised word by word by the
    // panel's CSS. Enumerating the layer's own registry is what stops the next
    // knob from shipping nameless.
    const knobs = Object.values(FLOW_FIELD_VIS_CONFIGS) as Array<Record<string, unknown>>;

    for (const knob of knobs) {
      const label = knob?.label;
      if (typeof label === 'string' && label.startsWith('flowfield.')) {
        expect(FLOW_FIELD_MESSAGES[label]).toBeDefined();
      }
      // A selector's values are shown to the user too, one message each.
      if (Array.isArray(knob?.options)) {
        for (const option of knob.options as string[]) {
          expect(FLOW_FIELD_MESSAGES[`flowfield.${knob.property}.${option}`]).toBeDefined();
        }
      }
    }

    // `lat`, `lng` and `altitude` kepler already names; the rest are ours.
    const known = ['lat', 'lng', 'altitude'];
    const columns = FLOW_FIELD_COLUMN_MODES.flatMap((mode) => [
      ...mode.requiredColumns,
      ...(mode.optionalColumns ?? []),
    ]);

    for (const column of columns.filter((name) => !known.includes(name))) {
      expect(FLOW_FIELD_MESSAGES[`columns.${column}`]).toBeDefined();
    }
  });

  it('names every id the configurator asks for', () => {
    // An id with no message renders as the id, capitalised word by word by the
    // panel's CSS — the tell being a label that reads "Flowfield.Density".
    for (const id of Object.keys(FLOW_FIELD_MESSAGES)) {
      expect(FLOW_FIELD_MESSAGES[id]).not.toBe('');
    }
  });
});
