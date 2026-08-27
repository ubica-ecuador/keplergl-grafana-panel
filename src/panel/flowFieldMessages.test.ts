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

  it('names every id the configurator asks for', () => {
    // An id with no message renders as the id, capitalised word by word by the
    // panel's CSS — the tell being a label that reads "Flowfield.Density".
    for (const id of Object.keys(FLOW_FIELD_MESSAGES)) {
      expect(FLOW_FIELD_MESSAGES[id]).not.toBe('');
    }
  });
});
