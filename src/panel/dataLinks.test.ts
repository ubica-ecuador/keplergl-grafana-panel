import {
  FieldType,
  locationUtil,
  type DataFrame,
  type Field,
  type InterpolateFunction,
  type ScopedVars,
} from '@grafana/data';

import { clickSelects, entityLinks, frameOfDataset, framesHaveLinks, linkNavigation, oneClickLink } from './dataLinks';

/**
 * The map's data links, through Grafana's own `getLinksSupplier`.
 *
 * Grafana fills `${__data.fields.x}` in its template service, which a plugin
 * test does not have; `interpolate` below resolves the same few macros from the
 * scoped variables the supplier hands over, which is exactly what the panel
 * controls: which frame and which row the data context points at.
 */

beforeAll(() => {
  locationUtil.initialize({
    config: { appSubUrl: '' } as never,
    getVariablesUrlParams: () => ({}),
    getTimeRangeForUrl: () => ({ from: 'now-6h', to: 'now' }),
  });
});

const dashboardVars: Record<string, string> = { region: 'coast' };

const interpolate: InterpolateFunction = (value: string, scopedVars?: ScopedVars) =>
  value.replace(/\$\{([^}]+)\}/g, (match, expr: string) => {
    const context = scopedVars?.__dataContext?.value as
      { frame: DataFrame; field: Field; rowIndex?: number } | undefined;
    const row = context?.rowIndex ?? 0;
    const fieldRef = /^__data\.fields\.(.+)$/.exec(expr);
    if (fieldRef && context) {
      const field = context.frame.fields.find((f) => f.name === fieldRef[1]);
      return field ? String(field.values[row]) : '';
    }
    if (expr === '__value.raw' && context) {
      return String(context.field.values[row]);
    }
    return dashboardVars[expr] ?? match;
  });

/** A query result as Grafana hands it after its field override pass. */
function frameWith(links: Field['config']['links'], over: Partial<DataFrame> = {}): DataFrame {
  const frame: DataFrame = {
    refId: 'A',
    length: 2,
    fields: [
      { name: 'id', type: FieldType.string, config: { links }, values: ['us7000a', 'us7000b'] },
      { name: 'lat', type: FieldType.number, config: {}, values: [-1.5, -2.5] },
      { name: 'mag', type: FieldType.number, config: {}, values: [4.1, 6.3] },
    ],
    ...over,
  };
  // What applyFieldOverrides leaves on every field: a context on the whole frame.
  for (const field of frame.fields) {
    field.state = { scopedVars: { __dataContext: { value: { data: [frame], frame, field, frameIndex: 0 } } } as never };
  }
  return frame;
}

const usgs = {
  title: 'USGS event ${__data.fields.id}',
  url: 'https://earthquake.usgs.gov/earthquakes/eventpage/${__data.fields.id}',
};

describe('entityLinks', () => {
  it('fills the template from the clicked row, not from the query’s first row', () => {
    const links = entityLinks({
      frame: frameWith([usgs]),
      values: { id: 'us7000b', lat: -2.5, mag: 6.3 },
      replaceVariables: interpolate,
    });
    expect(links).toHaveLength(1);
    expect(links[0].title).toBe('USGS event us7000b');
    expect(links[0].href).toBe('https://earthquake.usgs.gov/earthquakes/eventpage/us7000b');
  });

  it('reads a column kepler knows by another name through the renames', () => {
    const link = { title: 'Nearby', url: '/d/near?var-lat=${__data.fields.lat}&var-region=${region}' };
    const [only] = entityLinks({
      frame: frameWith([link]),
      values: { id: 'us7000b', latitude: -2.5 },
      renames: { lat: 'latitude' },
      replaceVariables: interpolate,
    });
    expect(only.href).toBe('/d/near?var-lat=-2.5&var-region=coast');
  });

  it('shows a link set on every field once', () => {
    const frame = frameWith([usgs]);
    for (const field of frame.fields) {
      field.config = { links: [usgs] };
    }
    const links = entityLinks({ frame, values: { id: 'us7000a' }, replaceVariables: interpolate });
    expect(links.map((l) => l.title)).toEqual(['USGS event us7000a']);
  });

  it('offers nothing for a query without links', () => {
    expect(entityLinks({ frame: frameWith(undefined), values: { id: 'x' }, replaceVariables: interpolate })).toEqual(
      []
    );
  });

  it('carries the new-tab and one-click flags Grafana sets', () => {
    const [link] = entityLinks({
      frame: frameWith([{ ...usgs, targetBlank: true, oneClick: true }]),
      values: { id: 'us7000a' },
      replaceVariables: interpolate,
    });
    expect(link.target).toBe('_blank');
    expect(oneClickLink([link])).toBe(link);
  });
});

describe('frameOfDataset', () => {
  it('finds the query a dataset was built from, by refId or by position', () => {
    const a = frameWith([usgs]);
    const b = frameWith([], { refId: undefined });
    expect(frameOfDataset([a, b], 'grafana-A')).toBe(a);
    expect(frameOfDataset([a, b], 'grafana-1')).toBe(b);
    expect(frameOfDataset([a, b], 'grafana-Z')).toBeUndefined();
  });

  it('tells whether any query carries a link at all', () => {
    expect(framesHaveLinks([frameWith(undefined)])).toBe(false);
    expect(framesHaveLinks([frameWith(undefined), frameWith([usgs])])).toBe(true);
  });
});

describe('oneClickLink', () => {
  it('is none when no link is marked one click', () => {
    expect(oneClickLink([{ title: 'a', href: '/a', target: '_self', origin: {} }])).toBeUndefined();
  });
});

describe('clickSelects', () => {
  it('selects when the click places the search square', () => {
    expect(clickSelects({ clickArea: true, mappedValues: undefined })).toBe(true);
  });

  it('selects when a click mapping resolves on the entity', () => {
    expect(clickSelects({ clickArea: false, mappedValues: { id: 'us7000a' } })).toBe(true);
  });

  it('selects nothing when no mapping resolves, so a one-click link may follow', () => {
    expect(clickSelects({ clickArea: false, mappedValues: {} })).toBe(false);
    expect(clickSelects({ clickArea: false, mappedValues: undefined })).toBe(false);
  });
});

describe('linkNavigation', () => {
  const origin = 'https://pacha.example';
  const link = (href: string, target?: '_blank' | '_self') => ({ title: 't', href, target: target!, origin: {} });

  it('moves the router for a link into this Grafana', () => {
    expect(linkNavigation(link('/d/earthquakes?var-quake=us7000a'), origin)).toEqual({
      kind: 'inApp',
      path: '/d/earthquakes?var-quake=us7000a',
    });
    expect(linkNavigation(link(`${origin}/d/x#panel`), origin)).toEqual({ kind: 'inApp', path: '/d/x#panel' });
  });

  it('opens a link to another site, or one asked to open in a new tab', () => {
    expect(linkNavigation(link('https://earthquake.usgs.gov/x'), origin)).toEqual({
      kind: 'window',
      href: 'https://earthquake.usgs.gov/x',
      target: '_self',
    });
    expect(linkNavigation(link('/d/x', '_blank'), origin)).toEqual({ kind: 'window', href: '/d/x', target: '_blank' });
  });

  it('runs a link that brings its own handler', () => {
    expect(linkNavigation({ ...link('/explore'), onClick: () => undefined }, origin)).toEqual({ kind: 'callback' });
  });
});
