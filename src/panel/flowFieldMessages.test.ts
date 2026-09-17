import { FLOW_FIELD_COLUMN_MODES, FLOW_FIELD_VIS_CONFIGS } from './flowFieldLayer';
import { FLOW_FIELD_MESSAGES, registerFlowFieldMessages } from './flowFieldMessages';
import { STREAMLINES_LABEL } from './localeMessages';
import { VECTOR_FIELD_VIS_CONFIGS } from './vectorFieldLayer';

describe('registerFlowFieldMessages', () => {
  it('teaches every locale the layer’s own words', () => {
    const catalogues: Record<string, Record<string, string>> = {
      en: { 'layer.type.point': 'Point' },
      es: { 'layer.type.point': 'Punto' },
    };

    registerFlowFieldMessages(catalogues);

    expect(catalogues.en['layer.type.streamlines']).toBe(STREAMLINES_LABEL);
    expect(catalogues.es['layer.type.streamlines']).toBe(STREAMLINES_LABEL);
    expect(catalogues.es['layer.type.point']).toBe('Punto');
  });

  it('does not name kepler’s own Flow Field', () => {
    // Both types lower-case to `flowfield`, so a message under that id would
    // be read out for kepler's layer as well as this one.
    const catalogues: Record<string, Record<string, string>> = { es: {} };

    registerFlowFieldMessages(catalogues);

    expect(catalogues.es['layer.type.flowfield']).toBeUndefined();
  });

  it('never overwrites a message kepler already has', () => {
    // A future kepler growing its own flow field should keep its own words.
    const catalogues: Record<string, Record<string, string>> = { en: { 'layer.type.streamlines': 'Wind' } };

    registerFlowFieldMessages(catalogues);

    expect(catalogues.en['layer.type.streamlines']).toBe('Wind');
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

  it('names every knob the vector field registers, and every choice it offers', () => {
    expect(FLOW_FIELD_MESSAGES['layer.type.vectorfield']).toBe('Vector field');

    for (const knob of Object.values(VECTOR_FIELD_VIS_CONFIGS) as Array<Record<string, unknown>>) {
      const label = knob?.label;
      if (typeof label !== 'string' || !/^(flowfield|vectorfield)\./.test(label)) {
        continue;
      }
      expect(FLOW_FIELD_MESSAGES[label]).toBeDefined();
      if (Array.isArray(knob.options)) {
        for (const option of knob.options as string[]) {
          expect(FLOW_FIELD_MESSAGES[`${label}.${option}`]).toBeDefined();
        }
      }
    }
  });
});
