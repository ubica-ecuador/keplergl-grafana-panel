import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FieldType, toDataFrame, type DataFrame } from '@grafana/data';

import { QueryOptionsEditor, queryOptionsEditor, showQueryOptions } from './QueryOptionsEditor';
import type { KeplerPanelOptions, QueryOptions } from '../types';

const trips = (refId: string) =>
  toDataFrame({
    refId,
    fields: [
      { name: 'trip_id', type: FieldType.string, values: ['a'] },
      { name: 'latitude', type: FieldType.number, values: [1] },
      { name: 'longitude', type: FieldType.number, values: [2] },
      { name: 'time', type: FieldType.time, values: [1000] },
    ],
  });
const named = (refId: string) =>
  toDataFrame({ refId, fields: [{ name: 'lookup', type: FieldType.string, values: ['UIO'] }] });
const points = (refId: string) =>
  toDataFrame({
    refId,
    fields: [
      { name: 'latitude', type: FieldType.number, values: [1] },
      { name: 'longitude', type: FieldType.number, values: [2] },
    ],
  });

function renderEditor(
  data: DataFrame[],
  value?: Record<string, QueryOptions>,
  options: KeplerPanelOptions = {},
  settings = {}
) {
  const onChange = jest.fn();
  render(
    <QueryOptionsEditor
      value={value}
      onChange={onChange}
      context={{ data, options: { ...options, queryOptions: value } } as any}
      item={{ settings } as any}
    />
  );
  return onChange;
}

// Grafana's Combobox measures its options' text on a canvas, which jsdom does not draw.
beforeAll(() => {
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => ({ measureText: (text: string) => ({ width: text.length * 7 }) }) as any);
});

describe('QueryOptionsEditor', () => {
  it('shows only where a query needs it: a Trip layer for a trajectory, Place names for names to place', () => {
    expect(showQueryOptions({}, [points('A')])).toBe(false);
    expect(showQueryOptions({}, [points('A'), trips('B')])).toBe(true);
    expect(showQueryOptions({}, [named('A')])).toBe(true);
    // A trajectory drawn as points (its trip id switched off) has no Trip layer to shape.
    expect(showQueryOptions({ fieldMappings: { B: { tripId: null } } }, [trips('B')])).toBe(false);
    expect(showQueryOptions({ queryOptions: { '*': { tripLayerMode: 'geojson' } } }, [points('A')])).toBe(true);

    renderEditor([points('A'), trips('B'), named('C')]);
    expect(screen.getByText('Query B')).toBeInTheDocument();
    expect(screen.getByText('Query C')).toBeInTheDocument();
    expect(screen.queryByText('Query A')).not.toBeInTheDocument();
    expect(screen.getAllByText('Trip layer')).toHaveLength(1);
    expect(screen.getAllByText('Place names')).toHaveLength(1);
  });

  it('writes the shape picked under the query’s refId, keeping the other queries’', () => {
    const onChange = renderEditor([trips('A'), trips('B')], { A: { tripLayerMode: 'geojson' } });

    fireEvent.click(screen.getAllByLabelText('GeoJSON')[1]);

    expect(onChange).toHaveBeenCalledWith({ A: { tripLayerMode: 'geojson' }, B: { tripLayerMode: 'geojson' } });
  });

  it('leaves Place names to an edition that places a query’s names its own way', () => {
    const placesElsewhere = (_frame: DataFrame, refId: string) => refId === 'A';
    const entry = queryOptionsEditor(placesElsewhere);
    expect(entry.showIf!({}, [named('A')])).toBe(false);
    expect(entry.showIf!({}, [named('A'), named('B')])).toBe(true);

    renderEditor([named('A'), named('B')], undefined, {}, { placesElsewhere });
    expect(screen.queryByText('Query A')).not.toBeInTheDocument();
    expect(screen.getAllByText('Place names')).toHaveLength(1);
  });

  it('shows what every other query takes, and clears it', () => {
    const onChange = renderEditor([trips('A')], { '*': { tripLayerMode: 'geojson' }, A: { tripLayerMode: 'table' } });

    expect(screen.getByText('Every other query')).toBeInTheDocument();
    expect(screen.getByText('Trip layer: GeoJSON')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }));

    expect(onChange).toHaveBeenCalledWith({ A: { tripLayerMode: 'table' } });
  });
});
