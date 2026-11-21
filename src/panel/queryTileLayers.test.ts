import { cutBounds, queryTileProps, QUERY_VECTOR_STYLE, withQueryVectorTiles } from './queryTileLayers';

const NL: [number, number, number, number] = [3.2, 50.7, 7.3, 53.6];

describe('queryTileProps', () => {
  it('gives the zoom levels the query gave where kepler found none, and kepler’s own where it did', () => {
    expect(queryTileProps({ minZoom: null, maxZoom: null }, { tilesMinZoom: 10, tilesMaxZoom: 15 })).toEqual({
      minZoom: 10,
      maxZoom: 15,
    });
    expect(queryTileProps({ minZoom: 0, maxZoom: 14 }, { tilesMinZoom: 10, tilesMaxZoom: 15 })).toEqual({
      minZoom: 0,
      maxZoom: 14,
    });
  });

  it('cuts to the box and asks for no tile outside it, hidden below the first level', () => {
    expect(queryTileProps({ minZoom: 10 }, { tilesBbox: NL })).toEqual({
      minZoom: 10,
      clipBox: NL,
      extent: NL,
      visibleMinZoom: 10,
    });
    // Across the antimeridian: cut, but no extent deck could say.
    expect(queryTileProps({}, { tilesBbox: [170, -20, -170, 0] })).toEqual({ clipBox: [170, -20, -170, 0] });
    expect(queryTileProps({}, undefined)).toEqual({});
  });
});

describe('cutBounds', () => {
  it('cuts a tile to the box, and leaves out a tile outside it', () => {
    expect(cutBounds([0, 45, 5.625, 52], NL)).toEqual([3.2, 50.7, 5.625, 52]);
    expect(cutBounds([4, 51, 5, 52], NL)).toEqual([4, 51, 5, 52]);
    expect(cutBounds([-10, 40, -5, 45], NL)).toBeNull();
    expect(cutBounds(undefined, NL)).toEqual(NL);
    expect(cutBounds([0, 45, 5, 50], null)).toEqual([0, 45, 5, 50]);
  });
});

describe('withQueryVectorTiles', () => {
  class FakeVectorTileLayer {
    config: { dataId: string; visConfig: Record<string, unknown> };
    constructor(props: { dataId: string }) {
      this.config = { dataId: props.dataId, visConfig: { stroked: false, radius: 1, opacity: 0.8 } };
    }
    formatLayerData(datasets: Record<string, { metadata?: Record<string, unknown> }>) {
      const metadata = datasets[this.config.dataId]?.metadata ?? {};
      return { minZoom: metadata.minZoom ?? null, maxZoom: metadata.maxZoom ?? null, tileSource: 'source' };
    }
    renderSubLayers(props: Record<string, unknown>) {
      return { sublayer: props };
    }
    renderLayer() {
      return [];
    }
  }
  const Layer = withQueryVectorTiles(FakeVectorTileLayer);

  it('gives a query’s tiles a look that reads on any base map, and leaves a tileset added by hand as kepler made it', () => {
    expect(new Layer({ dataId: 'grafana-A-tiles' }).config.visConfig).toEqual(QUERY_VECTOR_STYLE);
    expect(new Layer({ dataId: 'my-tileset' }).config.visConfig).toEqual({ stroked: false, radius: 1, opacity: 0.8 });
  });

  it('hands deck the query’s levels and box', () => {
    const layer = new Layer({ dataId: 'grafana-A-tiles' });
    const data = layer.formatLayerData({
      'grafana-A-tiles': { metadata: { maxZoom: 15, tilesMinZoom: 10, tilesBbox: NL } },
    });
    expect(data).toEqual({
      minZoom: 10,
      maxZoom: 15,
      tileSource: 'source',
      clipBox: NL,
      extent: NL,
      visibleMinZoom: 10,
    });
  });

  it('cuts each tile to the box, and draws nothing of a tile outside it', () => {
    const { renderSubLayers } = new Layer({ dataId: 'grafana-A-tiles' });
    // As kepler's deck layer calls it: detached, with the tile's props.
    const call = (props: Record<string, unknown>) => renderSubLayers.call(props as never, props);

    expect(call({ clipBox: NL, clipBounds: [0, 45, 5.625, 52] })).toEqual({
      sublayer: { clipBox: NL, clipBounds: [3.2, 50.7, 5.625, 52] },
    });
    expect(call({ clipBox: NL, clipBounds: [-10, 40, -5, 45] })).toEqual([]);
    expect(call({ clipBounds: [-10, 40, -5, 45] })).toEqual({ sublayer: { clipBounds: [-10, 40, -5, 45] } });
  });
});
