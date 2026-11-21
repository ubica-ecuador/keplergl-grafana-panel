import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  FieldType,
  getDefaultTimeRange,
  LoadingState,
  toDataFrame,
  type PanelData,
  type PanelProps,
} from '@grafana/data';

import type { KeplerPanelOptions } from '../types';
import { KeplerPanel } from './KeplerPanel';

/**
 * The map's notices from the PanelData Grafana really hands a panel. Kepler
 * itself stays out: the map is a stand-in that renders the notices it is given
 * and says whether it was told the queries answered.
 */
jest.mock('./LazyKeplerMap', () => ({
  LazyKeplerMap: (props: { notices?: React.ReactNode; queriesAnswered?: boolean }) => (
    <div data-testid="map" data-answered={String(props.queriesAnswered)}>
      {props.notices}
    </div>
  ),
}));
jest.mock('../assistant/AssistantContext', () => ({ AssistantContext: () => null }));

const MESSAGE =
  'Features: no "19748:wfs:geonode:conae_no2_promedio_cba" in this catalog (it may have left it, or the data ' +
  "source's search no longer finds it): choose another";

function panel(data: Partial<PanelData>, options: Partial<KeplerPanelOptions> = {}) {
  const timeRange = getDefaultTimeRange();
  const props = {
    id: 1,
    data: { state: LoadingState.Done, series: [], timeRange, ...data },
    options: options as KeplerPanelOptions,
    timeRange,
    timeZone: 'utc',
    width: 800,
    height: 600,
    fieldConfig: { defaults: {}, overrides: [] },
    transparent: false,
    renderCounter: 0,
    title: 'Map',
    eventBus: {
      subscribe: () => ({ unsubscribe() {} }),
      getStream: () => ({ subscribe: () => ({ unsubscribe() {} }) }),
    },
    onOptionsChange: jest.fn(),
    onFieldConfigChange: jest.fn(),
    onChangeTimeRange: jest.fn(),
    replaceVariables: (value: string) => value,
  } as unknown as PanelProps<KeplerPanelOptions>;
  return render(<KeplerPanel {...props} />);
}

describe('KeplerPanel’s notices', () => {
  it('say the error of a query that threw, which Grafana hands in `error` alone', () => {
    // runRequest's catchError: the previous data (none), state Error, `error` and no `errors`.
    panel({ state: LoadingState.Error, error: { message: MESSAGE } });

    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    expect(screen.getByTestId('map')).toHaveAttribute('data-answered', 'true');
  });

  it('say a catalog’s service row the map draws nothing of', () => {
    // IGN's elevation WMTS: `image/x-bil`, not a picture, so the catalog gives no tile address for it.
    const services = toDataFrame({
      refId: 'A',
      name: 'services',
      fields: [
        { name: 'entry', type: FieldType.string, values: ['ign-rge-alti'] },
        { name: 'title', type: FieldType.string, values: ['RGE ALTI'] },
        { name: 'service', type: FieldType.string, values: ['wmts'] },
        { name: 'url', type: FieldType.string, values: ['https://data.geopf.fr/wmts'] },
        { name: 'layer', type: FieldType.string, values: ['ELEVATION.ELEVATIONGRIDCOVERAGE'] },
        { name: 'tiles_bbox', type: FieldType.string, values: ['-5.15 41.33 9.57 51.10'] },
      ],
    });
    panel({ series: [services] });

    expect(screen.getByText(/services \(query A\) gives a WMTS service \(RGE ALTI\) with nothing/)).toBeInTheDocument();
  });

  it('tell the map the queries have not answered while they run', () => {
    panel({ state: LoadingState.Loading });

    expect(screen.getByTestId('map')).toHaveAttribute('data-answered', 'false');
  });

  it('leave a column the mapping switched off unread: no tile server asked for a search’s href', () => {
    const search = toDataFrame({
      refId: 'A',
      name: 'catalog',
      fields: [
        { name: 'href', type: FieldType.string, values: ['https://example.test/a.tif'] },
        { name: 'footprint', type: FieldType.string, values: ['POINT (-79 -2.9)'] },
      ],
    });
    // As saved, JSON null and all.
    const fieldMappings = JSON.parse('{"A":{"geometry":"footprint","rasterUrl":null}}');

    panel({ series: [search] }, { fieldMappings });
    expect(screen.queryByText('No raster tile server is set')).toBeNull();

    // Without the mapping, the href is imagery waiting for a server.
    panel({ series: [search] });
    expect(screen.getByText('No raster tile server is set')).toBeInTheDocument();
  });
});
