import { RING_MIN_PX } from './selectionHalo';
import { HALO_COLOR, haloDeckLayers, haloOutlines, haloShapeFeature } from './selectionHaloDeckLayers';

/**
 * The halo as deck layers. deck layers are plain descriptors until a Deck
 * renders them, so their props can be read here without WebGL.
 */

const ring = { position: [-79.02, -2.895] as [number, number], radiusPx: 12 };
const hexagon = { kind: 'hexagon' as const, value: '888f7699adfffff' };

const square = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 0],
];
const hole = [
  [0.2, 0.2],
  [0.4, 0.2],
  [0.4, 0.4],
  [0.2, 0.2],
];
const polygon = { type: 'Polygon', coordinates: [square, hole] };

type Feature = { type: string; geometry: { type: string; coordinates: unknown } };

describe('haloShapeFeature', () => {
  it('turns an H3 index into its cell polygon', () => {
    const feature = haloShapeFeature(hexagon) as { geometry: { type: string; coordinates: number[][][] } };
    expect(feature.geometry.type).toBe('Polygon');
    // A hexagon's ring: six corners, closed.
    expect(feature.geometry.coordinates[0]).toHaveLength(7);
  });

  it('reads a GeoJSON cell as kepler does, object or string', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    };
    expect(haloShapeFeature({ kind: 'geojson', value: polygon })).toMatchObject({ geometry: polygon });
    expect(haloShapeFeature({ kind: 'geojson', value: JSON.stringify(polygon) })).toMatchObject({ geometry: polygon });
  });

  it('gives nothing for a cell that is not geometry', () => {
    expect(haloShapeFeature({ kind: 'geojson', value: 'not geometry' })).toBeNull();
    expect(haloShapeFeature({ kind: 'hexagon', value: 42 })).toBeNull();
  });

  it('gives nothing for a string that is not an H3 index, as kepler draws nothing there', () => {
    // h3-js returns a polygon near the pole for these instead of throwing;
    // kepler skips any cell failing `h3IsValid`.
    for (const value of ['site-02', '888f7699adfffffx', 'ffffffffffffffff', '']) {
      expect(haloShapeFeature({ kind: 'hexagon', value })).toBeNull();
    }
  });
});

describe('haloOutlines', () => {
  // The outline layer is stroked and never filled: a polygon handed to deck as
  // a polygon is tessellated by earcut all the same. As lines, it is not — the
  // conversion kepler's own hover overlay makes (`featureToHoverOutline`).
  it('hands a polygon to deck as the lines of its rings', () => {
    const [outline] = haloOutlines([{ kind: 'geojson', value: polygon }]) as Feature[];
    expect(outline.geometry).toEqual({ type: 'MultiLineString', coordinates: [square, hole] });
  });

  it('hands a multipolygon to deck as the lines of every ring', () => {
    const shape = { type: 'MultiPolygon', coordinates: [[square, hole], [square]] };
    const [outline] = haloOutlines([{ kind: 'geojson', value: shape }]) as Feature[];
    expect(outline.geometry).toEqual({ type: 'MultiLineString', coordinates: [square, hole, square] });
  });

  it('outlines an H3 cell as the line around it', () => {
    const [outline] = haloOutlines([hexagon]) as Array<{ geometry: { type: string; coordinates: number[][][] } }>;
    expect(outline.geometry.type).toBe('MultiLineString');
    expect(outline.geometry.coordinates).toHaveLength(1);
    expect(outline.geometry.coordinates[0]).toHaveLength(7);
  });

  it('leaves points and lines as they are', () => {
    const point = { type: 'Point', coordinates: [0, 0] };
    const line = { type: 'LineString', coordinates: square };
    const outlines = haloOutlines([
      { kind: 'geojson', value: point },
      { kind: 'geojson', value: line },
    ]) as Feature[];
    expect(outlines.map((outline) => outline.geometry)).toEqual([point, line]);
  });

  it('drops a shape that is not geometry', () => {
    expect(haloOutlines([{ kind: 'hexagon', value: 42 }, hexagon])).toHaveLength(1);
  });
});

describe('haloDeckLayers', () => {
  it('draws rings as unfilled amber circles that no click can land on', () => {
    const [points] = haloDeckLayers({ rings: [ring], outlines: [] }, 0, { globe: false }) as Array<{
      id: string;
      props: Record<string, any>;
    }>;

    expect(points.id).toBe('panel-selection-halo-points-0');
    expect(points.props).toMatchObject({
      data: [ring],
      radiusUnits: 'pixels',
      stroked: true,
      filled: false,
      lineWidthUnits: 'pixels',
      getLineWidth: 3,
      getLineColor: HALO_COLOR,
      pickable: false,
      parameters: { depthTest: false },
    });
    expect(points.props.getPosition(ring)).toEqual(ring.position);
    expect(points.props.getRadius(ring)).toBe(12);
  });

  it('draws outlines for the shapes, on their own layer', () => {
    const layers = haloDeckLayers({ rings: [], outlines: haloOutlines([hexagon]) }, 1, { globe: false }) as Array<{
      id: string;
      props: Record<string, any>;
    }>;

    expect(layers.map((layer) => layer.id)).toEqual(['panel-selection-halo-outlines-1']);
    expect(layers[0].props).toMatchObject({ stroked: true, filled: false, pickable: false, getLineColor: HALO_COLOR });
    expect(layers[0].props.data).toHaveLength(1);
  });

  it('hands deck the very arrays it was given, so a repaint is not new data', () => {
    const rings = [ring];
    const outlines = haloOutlines([hexagon]);
    const [points, lines] = haloDeckLayers({ rings, outlines }, 0, { globe: false }) as Array<{
      props: Record<string, any>;
    }>;
    expect(points.props.data).toBe(rings);
    expect(lines.props.data).toBe(outlines);
  });

  it('a selected polygon reaches deck as outline lines', () => {
    const [lines] = haloDeckLayers({ rings: [], outlines: haloOutlines([{ kind: 'geojson', value: polygon }]) }, 0, {
      globe: false,
    }) as Array<{ props: { data: Feature[] } }>;
    expect(lines.props.data.map((feature) => feature.geometry.type)).toEqual(['MultiLineString']);
  });

  it('rings a GeoJSON point in pixels, not with a one-metre dot', () => {
    const [lines] = haloDeckLayers(
      { rings: [], outlines: haloOutlines([{ kind: 'geojson', value: { type: 'Point', coordinates: [0, 0] } }]) },
      0,
      { globe: false }
    ) as Array<{ props: Record<string, any> }>;
    expect(lines.props).toMatchObject({
      pointType: 'circle',
      pointRadiusUnits: 'pixels',
      getPointRadius: RING_MIN_PX,
      stroked: true,
      filled: false,
    });
  });

  it('adds no layer for nothing', () => {
    expect(haloDeckLayers({ rings: [], outlines: [] }, 0, { globe: false })).toEqual([]);
    expect(
      haloDeckLayers({ rings: [], outlines: haloOutlines([{ kind: 'hexagon', value: 42 }]) }, 0, { globe: false })
    ).toEqual([]);
  });

  it('tests depth against the globe, so a mark on the far side stays hidden', () => {
    const [points] = haloDeckLayers({ rings: [ring], outlines: [] }, 0, { globe: true }) as Array<{
      props: Record<string, any>;
    }>;
    expect(points.props.parameters).toEqual({ depthTest: true, depthMask: false, cull: false });
  });
});
