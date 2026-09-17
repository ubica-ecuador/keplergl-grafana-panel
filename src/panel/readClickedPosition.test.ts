import type { Store } from 'redux';

import { KEPLER_INSTANCE_ID } from './constants';
import { readClickedPosition, readFigures } from './keplerAdapter';

/**
 * A store holding one point layer drawn from `latitude`/`longitude`, the way
 * the Imagery tab's fire map draws CAMS cells — plus whatever `clicked` and
 * draw state a case needs. `getHoverData` returns the row the way a kepler
 * point layer does: from the data container, by picked index.
 */
function store({
  clicked,
  drawing = false,
  columns = { lat: { value: 'latitude', fieldIdx: 1 }, lng: { value: 'longitude', fieldIdx: 2 } },
  rows = [['2026-09-12', 39.25, -122.95, 180.5]],
  filters = [],
  editorFeatures = [],
}: {
  clicked: unknown;
  drawing?: boolean;
  columns?: unknown;
  rows?: unknown[][];
  filters?: unknown[];
  editorFeatures?: unknown[];
}): Store {
  const state = {
    keplerGl: {
      [KEPLER_INSTANCE_ID]: {
        uiState: { mapControls: { mapDraw: { active: drawing } } },
        visState: {
          clicked,
          filters,
          editor: { features: editorFeatures },
          animationConfig: {},
          datasets: {
            'grafana-A': {
              fields: [{ name: 'time' }, { name: 'latitude' }, { name: 'longitude' }, { name: 'value' }],
              dataContainer: { rows },
            },
          },
          layers: [
            {
              id: 'puntos',
              type: 'point',
              config: { dataId: 'grafana-A', columns },
              getHoverData: (objectOrIndex: unknown, container: { rows: unknown[][] }) =>
                typeof objectOrIndex === 'number' ? container.rows[objectOrIndex] : null,
            },
          ],
        },
      },
    },
  };
  return { getState: () => state } as unknown as Store;
}

const ON_FIRE = { picked: true, index: 0, object: null, layer: { props: { idx: 0 } } };

describe('readClickedPosition', () => {
  it('answers a clicked fire with its row, which is the centre of its grid cell', () => {
    expect(readClickedPosition(store({ clicked: ON_FIRE }))).toEqual({
      kind: 'position',
      position: { lng: -122.95, lat: 39.25 },
      layerId: 'puntos',
      layerType: 'point',
    });
  });

  it('finds the columns by name when kepler has not stamped an index on them', () => {
    const columns = { lat: { value: 'latitude' }, lng: { value: 'longitude' } };
    expect(readClickedPosition(store({ clicked: ON_FIRE, columns }))).toMatchObject({
      kind: 'position',
      position: { lng: -122.95, lat: 39.25 },
    });
  });

  it('tells a click on bare map from no click at all', () => {
    expect(readClickedPosition(store({ clicked: null }))).toEqual({ kind: 'empty' });
    expect(readClickedPosition(store({ clicked: undefined }))).toEqual({ kind: 'none' });
  });

  it('leaves clicks alone while the draw toolbar owns them', () => {
    expect(readClickedPosition(store({ clicked: ON_FIRE, drawing: true }))).toEqual({ kind: 'none' });
  });

  // Selecting the square itself to delete it clicks the editor, not a data layer.
  it('is not a failure to click something that is not a data layer', () => {
    expect(readClickedPosition(store({ clicked: { picked: true, object: {}, layer: undefined } }))).toEqual({
      kind: 'none',
    });
  });

  it('is unresolved, not empty, when the clicked row has no position', () => {
    const decision = readClickedPosition(store({ clicked: ON_FIRE, rows: [['2026-09-12', null, 'x', 1]] }));
    expect(decision).toEqual({
      kind: 'unresolved',
      layerId: 'puntos',
      layerType: 'point',
      reason: 'the clicked row has no numeric latitude/longitude',
    });
  });

  // `Number(null)` is 0: without a guard this is a silent box on Null Island.
  it('is unresolved, not a box at 0, 0, when the coordinates are null', () => {
    expect(readClickedPosition(store({ clicked: ON_FIRE, rows: [['2026-09-12', null, null, 1]] }))).toMatchObject({
      kind: 'unresolved',
      reason: 'the clicked row has no numeric latitude/longitude',
    });
  });

  // Every cell below is one `Number()` would turn into a finite number — 0 for
  // most of them — and so into a box on Null Island. None of them is a position.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['a blank string', '   '],
    ['a non-numeric string', 'n/a'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['false', false],
    ['true', true],
    ['an empty array', []],
    ['a one-element array', [39.25]],
    ['an object', {}],
  ])('is unresolved, not a box, when the coordinates are %s', (_name, cell) => {
    expect(readClickedPosition(store({ clicked: ON_FIRE, rows: [['2026-09-12', cell, cell, 1]] }))).toMatchObject({
      kind: 'unresolved',
      reason: 'the clicked row has no numeric latitude/longitude',
    });
  });

  it('still reads a coordinate stored as a numeric string', () => {
    expect(
      readClickedPosition(store({ clicked: ON_FIRE, rows: [['2026-09-12', '39.25', ' -122.95 ', 1]] }))
    ).toMatchObject({
      kind: 'position',
      position: { lng: -122.95, lat: 39.25 },
    });
  });

  it('uses the centre of a picked geometry for a layer drawn from one', () => {
    const polygon = {
      picked: true,
      index: 0,
      object: {
        geometry: {
          coordinates: [
            [
              [-123, 39],
              [-122.9, 39],
              [-122.9, 39.5],
              [-123, 39.5],
              [-123, 39],
            ],
          ],
        },
      },
      layer: { props: { idx: 0 } },
    };
    expect(readClickedPosition(store({ clicked: polygon, columns: { geojson: { value: 'geom' } } }))).toMatchObject({
      kind: 'position',
      position: { lng: -122.95, lat: 39.25 },
    });
  });

  it('is unresolved when a layer has neither columns nor a geometry', () => {
    expect(readClickedPosition(store({ clicked: ON_FIRE, columns: { hex_id: { value: 'h3' } } }))).toMatchObject({
      kind: 'unresolved',
      reason: 'the layer has no lat/lng columns and the clicked object no geometry',
    });
  });
});

describe('readFigures', () => {
  it('says which figures live in a polygon filter, in the order the area sync reads them', () => {
    const rect = { id: 'rect', geometry: { type: 'Polygon', coordinates: [] }, properties: { filterId: 'f1' } };
    const hand = { id: 'hand', geometry: { type: 'Polygon', coordinates: [] } };
    expect(
      readFigures(
        store({ clicked: undefined, filters: [{ id: 'f1', type: 'polygon', value: rect }], editorFeatures: [hand] })
      )
    ).toEqual([{ id: 'rect', filterId: 'f1' }, { id: 'hand' }]);
  });
});
