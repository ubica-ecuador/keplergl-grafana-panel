import { HALO_COLOR, haloDeckLayers, haloShapeFeature } from './selectionHaloDeckLayers';

/**
 * The halo as deck layers. deck layers are plain descriptors until a Deck
 * renders them, so their props can be read here without WebGL.
 */

const ring = { position: [-79.02, -2.895] as [number, number], radiusPx: 12 };
const hexagon = { kind: 'hexagon' as const, value: '888f7699adfffff' };

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
});

describe('haloDeckLayers', () => {
  it('draws rings as unfilled amber circles that no click can land on', () => {
    const [points] = haloDeckLayers({ rings: [ring], shapes: [] }, 0, { globe: false }) as Array<{
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
    const layers = haloDeckLayers({ rings: [], shapes: [hexagon] }, 1, { globe: false }) as Array<{
      id: string;
      props: Record<string, any>;
    }>;

    expect(layers.map((layer) => layer.id)).toEqual(['panel-selection-halo-outlines-1']);
    expect(layers[0].props).toMatchObject({ stroked: true, filled: false, pickable: false, getLineColor: HALO_COLOR });
    expect(layers[0].props.data).toHaveLength(1);
  });

  it('adds no layer for nothing', () => {
    expect(haloDeckLayers({ rings: [], shapes: [] }, 0, { globe: false })).toEqual([]);
    expect(haloDeckLayers({ rings: [], shapes: [{ kind: 'hexagon', value: 42 }] }, 0, { globe: false })).toEqual([]);
  });

  it('tests depth against the globe, so a mark on the far side stays hidden', () => {
    const [points] = haloDeckLayers({ rings: [ring], shapes: [] }, 0, { globe: true }) as Array<{
      props: Record<string, any>;
    }>;
    expect(points.props.parameters).toEqual({ depthTest: true, depthMask: false, cull: false });
  });
});
