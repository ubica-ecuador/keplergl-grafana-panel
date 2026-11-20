import { fromPlusPanel } from './panelChange';

describe('fromPlusPanel', () => {
  it('keeps every option of a Plus panel, its map included', () => {
    const prev = {
      showSidePanel: false,
      mapConfig: '{"version":"v1","config":{}}',
      fleetAssetField: 'vehicle',
    };
    const next = fromPlusPanel(prev);
    expect(next).toEqual(prev);
    expect(next).not.toBe(prev);
  });

  it('starts from the defaults when there is nothing to keep', () => {
    expect(fromPlusPanel(undefined)).toEqual({});
  });
});
