import { buildLayerConfig, paletteRange, visConfigFor } from './keplerLayers';

const base = { dataId: 'A', label: 'quakes', lat: 'latitude', lng: 'longitude' };
const mag = { name: 'mag', type: 'real' };

describe('keplerLayers', () => {
  it('builds a saved-format 3D hexagon layer sized from the data extent', () => {
    const layer = buildLayerConfig({ ...base, type: 'hexagon', colorBy: mag, threeD: true }, 'ask-1', 6000) as {
      config: { columns: unknown; visConfig: Record<string, unknown> };
      visualChannels: Record<string, unknown>;
    };
    expect(layer).toMatchObject({ id: 'ask-1', type: 'hexagon' });
    expect(layer.config.columns).toEqual({ lat: 'latitude', lng: 'longitude' });
    expect(layer.config.visConfig).toMatchObject({ worldUnitSize: 100, enable3d: true, elevationScale: 150, colorAggregation: 'average' });
    expect(layer.visualChannels).toEqual({ colorField: mag, colorScale: 'quantile' });
  });

  it('weights a heatmap by the colour column and turns on its surface for 3D', () => {
    const layer = buildLayerConfig({ ...base, type: 'heatmap', colorBy: mag, threeD: true }, 'h', 100) as {
      config: { visConfig: Record<string, unknown> };
      visualChannels: Record<string, unknown>;
    };
    expect(layer.config.visConfig).toMatchObject({ radius: 30, surfaceEnabled: true, surfaceHeight: 1000 });
    expect(layer.visualChannels).toEqual({ weightField: mag, weightScale: 'linear' });
  });

  it('colours points by a text column with an ordinal scale and sizes them by sqrt', () => {
    const layer = buildLayerConfig({ ...base, type: 'point', colorBy: { name: 'place', type: 'string' }, sizeBy: mag }, 'p', 100) as {
      visualChannels: Record<string, unknown>;
    };
    expect(layer.visualChannels).toEqual({
      colorField: { name: 'place', type: 'string' },
      colorScale: 'ordinal',
      sizeField: mag,
      sizeScale: 'sqrt',
    });
  });

  it('maps radius to each layer type\'s own key and resolves palettes by name', () => {
    expect(visConfigFor('cluster', { radius: 30 })).toEqual({ clusterRadius: 30 });
    expect(visConfigFor('grid', { radius: 5, threeD: false })).toEqual({ worldUnitSize: 5, enable3d: false });
    expect(paletteRange('viridis')?.colors).toHaveLength(6);
    expect(paletteRange('nope')).toBeNull();
  });
});
