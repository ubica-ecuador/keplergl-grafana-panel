import { renderHook } from '@testing-library/react';
import { FieldType, type AdHocVariableFilter, type DataFrame } from '@grafana/data';

import { KEPLER_INSTANCE_ID } from './constants';
import { useAdHocFilters } from './useAdHocFilters';
import type { PanelDataset } from '../data/framesToDatasets';

/**
 * The hook between the popup and Grafana's `onAddAdHocFilter`: when it offers
 * anything, what it reads from the clicked row, and what it hands Grafana.
 */

/** A store that serves one point layer whose rows carry `kind` and `name`. */
function makeStore(clicked: unknown) {
  const layer = {
    id: 'points',
    type: 'point',
    props: { idx: 0 },
    config: { dataId: 'grafana-A' },
    getHoverData: (index: unknown, container: { rows: unknown[][] }) =>
      typeof index === 'number' ? container.rows[index] : null,
  };
  return {
    getState: () => ({
      keplerGl: {
        [KEPLER_INSTANCE_ID]: {
          visState: {
            clicked,
            layers: [layer],
            datasets: {
              'grafana-A': {
                fields: [{ name: 'kind' }, { name: 'name' }],
                dataContainer: {
                  rows: [
                    ['shop', 'Tienda Azul'],
                    ['school', 'Escuela Central'],
                  ],
                },
              },
            },
          },
        },
      },
    }),
    subscribe: () => () => undefined,
    dispatch: jest.fn(),
  };
}

const clickOn = (index: number) => ({ layer: { props: { idx: 0 } }, index, object: index });

const frames: DataFrame[] = [
  {
    refId: 'A',
    length: 2,
    fields: [
      { name: 'kind', type: FieldType.string, config: {}, values: ['shop', 'school'] },
      { name: 'name', type: FieldType.string, config: {}, values: ['Tienda Azul', 'Escuela Central'] },
    ],
  },
];
const datasets = [{ id: 'grafana-A' }] as unknown as PanelDataset[];

interface HookInputs {
  clicked: unknown;
  fields: string[] | undefined;
  requestFilters: AdHocVariableFilter[] | undefined;
  onAddAdHocFilter: jest.Mock | undefined;
}

// Spread rather than destructuring defaults, so that an explicit `undefined` stays undefined.
function hook(over: Partial<HookInputs> = {}) {
  const { clicked, fields, requestFilters, onAddAdHocFilter }: HookInputs = {
    clicked: clickOn(1),
    fields: ['kind'],
    requestFilters: [],
    onAddAdHocFilter: jest.fn(),
    ...over,
  };
  const store = makeStore(clicked);
  const { result } = renderHook(() =>
    useAdHocFilters({ store: store as never, frames, datasets, fields, requestFilters, onAddAdHocFilter })
  );
  return { api: result.current, store, onAddAdHocFilter };
}

describe('useAdHocFilters', () => {
  it('offers the clicked entity’s value of each named field', () => {
    const { api } = hook({ fields: ['kind', 'name'] });
    expect(api?.filters()).toEqual([
      { key: 'kind', value: 'school', filteredFor: false, filteredOut: false },
      { key: 'name', value: 'Escuela Central', filteredFor: false, filteredOut: false },
    ]);
  });

  it('hands Grafana the table’s item and closes the popup', () => {
    const { api, store, onAddAdHocFilter } = hook();
    const [kind] = api!.filters();
    api!.add(kind, '!=');
    expect(onAddAdHocFilter).toHaveBeenCalledWith({ key: 'kind', value: 'school', operator: '!=' });
    expect(store.dispatch).toHaveBeenCalled();
  });

  it('marks what the dashboard already filters', () => {
    const { api } = hook({ requestFilters: [{ key: 'kind', operator: '=', value: 'school' }] });
    expect(api?.filters()).toEqual([{ key: 'kind', value: 'school', filteredFor: true, filteredOut: false }]);
  });

  it('is null without an ad hoc variable for the panel’s datasource', () => {
    expect(hook({ requestFilters: undefined }).api).toBeNull();
  });

  it('is null without a field to offer, or outside a dashboard', () => {
    expect(hook({ fields: undefined }).api).toBeNull();
    expect(hook({ onAddAdHocFilter: undefined }).api).toBeNull();
  });

  it('offers nothing while no entity is pinned', () => {
    expect(hook({ clicked: undefined }).api?.filters()).toEqual([]);
  });
});
