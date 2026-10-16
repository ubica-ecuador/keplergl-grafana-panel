import type { Store } from 'redux';

import { KEPLER_INSTANCE_ID } from './constants';
import { readClickedEntity } from './keplerAdapter';

/**
 * A store with one layer of stations, clicked on its first row, whose
 * `getHoverData` and `getClickData` a case sets: kepler's tooltip asks the
 * first, the click the second when the layer has it.
 */
function clickedOn(layer: Record<string, unknown>): Store {
  const state = {
    keplerGl: {
      [KEPLER_INSTANCE_ID]: {
        uiState: { mapControls: { mapDraw: { active: false } } },
        visState: {
          clicked: { picked: true, index: 0, object: { index: 0 }, layer: { props: { idx: 0 } } },
          filters: [],
          animationConfig: {},
          datasets: {
            'grafana-H': {
              fields: [{ name: 'id' }, { name: 'latitude' }, { name: 'longitude' }, { name: 'value' }],
              dataContainer: { rows: [['ANTC', -37.34, -71.53, 12.5]] },
            },
          },
          layers: [{ id: 'cards', type: 'sparkline', config: { dataId: 'grafana-H' }, ...layer }],
        },
      },
    },
  };
  return { getState: () => state } as unknown as Store;
}

/** The row of a picked object, as a point layer reads it from its container. */
const rowOf = (object: { index: number }, container: { rows: unknown[][] }) => container.rows[object.index];

describe('readClickedEntity', () => {
  it('reads the clicked row the way the tooltip does', () => {
    expect(readClickedEntity(clickedOn({ getHoverData: rowOf }), ['id'])).toEqual({ id: 'ANTC' });
  });

  it('still selects on a layer that shows no tooltip, through its getClickData', () => {
    // A Plus sparkline with its tooltip off: no row for kepler's popup, the row for the click.
    const quiet = clickedOn({ getHoverData: () => null, getClickData: rowOf });

    expect(readClickedEntity(quiet, ['id'])).toEqual({ id: 'ANTC' });
  });

  it('calls getClickData as a method of its layer', () => {
    const layer = {
      rowsFrom: 'grafana-H',
      getClickData(this: { rowsFrom: string }, object: { index: number }, container: { rows: unknown[][] }) {
        return this.rowsFrom === 'grafana-H' ? container.rows[object.index] : null;
      },
    };

    expect(readClickedEntity(clickedOn(layer), ['id'])).toEqual({ id: 'ANTC' });
  });

  it('selects nothing on a layer that answers neither', () => {
    expect(readClickedEntity(clickedOn({ getHoverData: () => null }), ['id'])).toEqual({});
  });
});
