import { ClipExtension } from '@deck.gl/extensions';

import { buildXyzTileDeckLayer } from './xyzTileDeckLayer';
import { xyzDeckProps } from './xyzTileLayer';

const NETHERLANDS: [number, number, number, number] = [3.2, 50.7, 7.3, 53.6];
const TEMPLATE = 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png';

/**
 * A query's tiles cut to its box, tile by tile, the way a WMS picture is. Deck
 * itself never runs here: what matters is what each tile's bitmap is handed.
 */
function tileLayer(clipBox: number[] | null, viewport: Record<string, unknown> = {}) {
  const props = xyzDeckProps({
    id: 'grafana-A-tiles-layer',
    metadata: { url: TEMPLATE, minZoom: 6, ...(clipBox ? { tilesBbox: clipBox as typeof NETHERLANDS } : {}) },
  })!;
  const layer = buildXyzTileDeckLayer(props) as any;
  layer.context = { viewport };
  return layer;
}

const tile = (west: number, south: number, east: number, north: number) => ({
  boundingBox: [
    [west, south],
    [east, north],
  ],
});

describe('the tiles of a query’s box', () => {
  it('are each cut to the box', () => {
    const props = tileLayer(NETHERLANDS).getSubLayerPropsByTile(tile(0, 50, 5.6, 54));

    expect(props.extensions).toHaveLength(1);
    expect(props.extensions[0]).toBeInstanceOf(ClipExtension);
    expect(props.clipBounds).toEqual(NETHERLANDS);
  });

  it('keep what they were handed while the box stays, so deck clones them once', () => {
    const layer = tileLayer(NETHERLANDS);
    const edge = tile(0, 50, 5.6, 54);

    expect(layer.getSubLayerPropsByTile(edge)).toBe(layer.getSubLayerPropsByTile(edge));
    expect(layer.getSubLayerPropsByTile(edge).extensions).toBe(
      layer.getSubLayerPropsByTile(tile(5.6, 50, 11.2, 54)).extensions
    );
  });

  it('are cut on the copy of the world nearest them, across the antimeridian', () => {
    const fiji = tileLayer([177, -21, -178, -12]);

    expect(fiji.getSubLayerPropsByTile(tile(-180, -22, -174, -11)).clipBounds).toEqual([-183, -21, -178, -12]);
    expect(fiji.getSubLayerPropsByTile(tile(174, -22, 180, -11)).clipBounds).toEqual([177, -21, 182, -12]);
  });

  it('are drawn whole without a box, and on a globe', () => {
    expect(tileLayer(null).getSubLayerPropsByTile(tile(0, 50, 5.6, 54))).toBeNull();
    expect(tileLayer(NETHERLANDS, { resolution: 10 }).getSubLayerPropsByTile(tile(0, 50, 5.6, 54))).toEqual({
      extensions: [],
    });
  });
});

describe('xyzDeckProps and the box', () => {
  it('asks for no tile outside the box, and none zoomed out past the first level', () => {
    const props = xyzDeckProps({ id: 'l', metadata: { url: TEMPLATE, minZoom: 6, tilesBbox: NETHERLANDS } })!;

    expect(props).toMatchObject({ clipBox: NETHERLANDS, extent: NETHERLANDS, visibleMinZoom: 6, minZoom: 6 });
    expect(props.reliefBounds).toEqual(NETHERLANDS);
  });

  it('cuts a box across the antimeridian without asking deck or MapLibre to bound it', () => {
    const props = xyzDeckProps({ id: 'l', metadata: { url: TEMPLATE, tilesBbox: [177, -21, -178, -12] } })!;

    expect(props.clipBox).toEqual([177, -21, -178, -12]);
    expect(props).not.toHaveProperty('extent');
    expect(props).not.toHaveProperty('reliefBounds');
  });

  it('changes nothing for tiles with no box', () => {
    const props = xyzDeckProps({ id: 'l', metadata: { url: TEMPLATE, minZoom: 6 } })!;

    expect(props).not.toHaveProperty('clipBox');
    expect(props).not.toHaveProperty('extent');
    expect(props).not.toHaveProperty('visibleMinZoom');
  });
});
