import React from 'react';
import { act, render } from '@testing-library/react';
import { DataHoverClearEvent, DataHoverEvent, EventBusSrv } from '@grafana/data';
import { TemporalCursorContext, withTemporalCursor } from './temporalCursorMapContainer';
import type { VisStateLike } from './selectionHaloInput';

const rows = [
  [1753257600000, -2, -79],
  [1753257601000, -3, -78],
];
const values = jest.fn((r: number, c: number) => rows[r][c]);
const layer = {
  id: 'points',
  type: 'point',
  config: {
    dataId: 'A',
    isVisible: true,
    columnMode: 'points',
    columns: { lat: { fieldIdx: 1 }, lng: { fieldIdx: 2 } },
  },
};
const visState: VisStateLike = {
  layers: [layer],
  datasets: {
    A: {
      fields: ['time', 'latitude', 'longitude'].map((name, column) => ({
        name,
        valueAccessor: ({ index }: { index: number }) => rows[index][column],
      })),
      dataContainer: { numRows: () => rows.length, valueAt: values },
    },
  },
};
let deck: any;
const baseLayers = [{ id: 'route' }];
const Container = withTemporalCursor((props: any) => {
  deck = props.deckRenderCallbacks?.onDeckRender?.({ layers: baseLayers }) ?? { layers: baseLayers };
  return null;
});
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('updates only the overlay, reuses the index, preserves callbacks and clears on exit', () => {
  const bus = new EventBusSrv();
  render(
    <TemporalCursorContext.Provider value={{ eventBus: bus, enabled: true }}>
      <Container visState={visState} deckRenderCallbacks={{ onDeckRender: (p: any) => ({ ...p, custom: true }) }} />
    </TemporalCursorContext.Provider>
  );
  const reads = values.mock.calls.length;
  act(() => {
    bus.publish(new DataHoverEvent({ point: { time: rows[0][0] } }));
    jest.advanceTimersByTime(20);
  });
  expect(deck.custom).toBe(true);
  expect(deck.layers[0]).toBe(baseLayers[0]);
  expect(deck.layers[1].props.data[0].position).toEqual([-79, -2, 0]);
  expect(deck.layers[1].props.pickable).toBe(false);
  act(() => {
    bus.publish(new DataHoverEvent({ point: { time: rows[1][0] } }));
    jest.advanceTimersByTime(20);
  });
  expect(deck.layers[1].props.data[0].position).toEqual([-78, -3, 0]);
  expect(values).toHaveBeenCalledTimes(reads);
  act(() => bus.publish(new DataHoverClearEvent()));
  expect(deck.layers).toBe(baseLayers);
});

it('respects layer selection, visibility, split maps and globe depth', () => {
  const bus = new EventBusSrv();
  const tree = (state: VisStateLike, layerId = '') => (
    <TemporalCursorContext.Provider value={{ eventBus: bus, enabled: true, layerId }}>
      <Container visState={state} index={1} mapState={{ globe: { enabled: true } }} />
    </TemporalCursorContext.Provider>
  );
  const { rerender } = render(tree(visState));
  act(() => {
    bus.publish(new DataHoverEvent({ point: { time: rows[0][0] } }));
    jest.advanceTimersByTime(20);
  });
  expect(deck.layers[1].id).toBe('panel-temporal-cursor-1');
  expect(deck.layers[1].props.parameters.depthTest).toBe(true);
  rerender(tree(visState, 'missing'));
  expect(deck.layers).toHaveLength(1);
  rerender(tree({ ...visState, layers: [{ ...layer, config: { ...layer.config, isVisible: false } }] }));
  expect(deck.layers).toHaveLength(1);
  rerender(tree({ ...visState, splitMaps: [{ layers: { points: true } }, { layers: {} }] }));
  expect(deck.layers).toHaveLength(1);
});

it('applies the map filters to the cursor sample', () => {
  const bus = new EventBusSrv();
  const tree = (filters: VisStateLike['filters']) => (
    <TemporalCursorContext.Provider value={{ eventBus: bus, enabled: true }}>
      <Container visState={{ ...visState, filters }} />
    </TemporalCursorContext.Provider>
  );
  const { rerender } = render(tree([]));
  act(() => {
    bus.publish(new DataHoverEvent({ point: { time: rows[0][0] } }));
    jest.advanceTimersByTime(20);
  });
  expect(deck.layers).toHaveLength(2);
  // Same structure as kepler's numerical filters; this runs its real predicate.
  const filter = {
    id: 'lat-filter',
    type: 'range',
    dataId: ['A'],
    name: ['latitude'],
    fieldIdx: [1],
    value: [-4, -2.5],
    enabled: true,
  };
  rerender(tree([filter]));
  expect(deck.layers).toHaveLength(1);
  rerender(tree([{ ...filter, enabled: false }]));
  expect(deck.layers).toHaveLength(2);
});

it('draws one marker when two visible layers share the same GPS sample', () => {
  const bus = new EventBusSrv();
  render(
    <TemporalCursorContext.Provider value={{ eventBus: bus, enabled: true }}>
      <Container visState={{ ...visState, layers: [layer, { ...layer, id: 'duplicate' }] }} />
    </TemporalCursorContext.Provider>
  );
  act(() => {
    bus.publish(new DataHoverEvent({ point: { time: rows[0][0] } }));
    jest.advanceTimersByTime(20);
  });
  expect(deck.layers[1].props.data).toHaveLength(1);
});
