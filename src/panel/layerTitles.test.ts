import { toDataFrame } from '@grafana/data';

import { keplerCut, layerTitleRenames, wantedTitles } from './layerTitles';

const frame = (refId: string, title?: string, name?: string) =>
  toDataFrame({ refId, name, fields: [], meta: (title ? { custom: { layer: { key: title, title } } } : {}) as never });

const layer = (id: string, dataId: string, label: string) => ({ id, config: { dataId, label } });

describe("a map's layers named as their data source names them", () => {
  it("names the layers of a titled query that still carry the frame's name or the query's", () => {
    const { wanted } = wantedTitles([frame('A', 'Land cover 2020', 'features')], new Map());
    const renames = layerTitleRenames(
      [
        layer('1', 'grafana-A', 'features'),
        layer('2', 'grafana-A-tiles', 'Query A'),
        layer('3', 'grafana-A', 'My land cover'),
        layer('4', 'grafana-A', 'Land cover 2020'),
        layer('5', 'grafana-B', 'features'),
      ],
      wanted
    );
    expect(renames.map(({ layer: l, label }) => [l.id, label])).toEqual([
      ['1', 'Land cover 2020'],
      ['2', 'Land cover 2020'],
    ]);
  });

  it("undoes kepler's cut of what looked like an extension", () => {
    expect(keplerCut('CCI Biomass v5.01')).toBe('CCI Biomass v5');
    const { wanted } = wantedTitles([frame('A', 'CCI Biomass v5.01')], new Map());
    expect(layerTitleRenames([layer('1', 'grafana-A', 'CCI Biomass v5')], wanted)).toEqual([
      { layer: layer('1', 'grafana-A', 'CCI Biomass v5'), label: 'CCI Biomass v5.01' },
    ]);
  });

  it('follows a query pointed at another layer, and not a layer the user renamed', () => {
    const first = wantedTitles([frame('A', 'Rivers')], new Map());
    const { wanted, named } = wantedTitles([frame('A', 'Lakes')], first.named);
    expect(named.get('A')).toEqual(['Rivers', 'Lakes']);
    const renames = layerTitleRenames(
      [
        layer('1', 'grafana-A', 'Rivers'),
        layer('2', 'grafana-A', 'Water'),
        layer('3', 'grafana-A-route', 'Rivers · route'),
      ],
      wanted
    );
    expect(renames.map(({ layer: l, label }) => [l.id, label])).toEqual([
      ['1', 'Lakes'],
      ['3', 'Lakes · route'],
    ]);
  });

  it('names nothing for a query whose frames name no title', () => {
    const { wanted } = wantedTitles([frame('A', undefined, 'features')], new Map());
    expect(wanted.size).toBe(0);
    expect(layerTitleRenames([layer('1', 'grafana-A', 'features')], wanted)).toEqual([]);
  });
});
