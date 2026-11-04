import {
  FieldType,
  HttpRequestMethod,
  locationUtil,
  type Action,
  type DataFrame,
  type InterpolateFunction,
  type ScopedVars,
} from '@grafana/data';

import { actionUrl, entityActions, framesHaveActions, withActionVariables, type ActionConfig } from './mapActions';

/**
 * The map's actions, built as Grafana's core builds them. Same stand-in for
 * Grafana's template service as dataLinks.test.ts: what the panel controls is
 * which row the data context points at.
 */

beforeAll(() => {
  locationUtil.initialize({
    config: { appSubUrl: '/grafana' } as never,
    getVariablesUrlParams: () => ({}),
    getTimeRangeForUrl: () => ({ from: 'now-6h', to: 'now' }),
  });
});

const interpolate: InterpolateFunction = (value: string, scopedVars?: ScopedVars) =>
  value.replace(/\$\{([^}]+)\}/g, (match, expr: string) => {
    const context = scopedVars?.__dataContext?.value as { frame: DataFrame; rowIndex?: number } | undefined;
    const fieldRef = /^__data\.fields\.(.+)$/.exec(expr);
    if (fieldRef && context) {
      const field = context.frame.fields.find((f) => f.name === fieldRef[1]);
      return field ? String(field.values[context.rowIndex ?? 0]) : '';
    }
    return expr === 'team' ? 'north' : match;
  });

function frameWith(actions: Action[] | undefined): DataFrame {
  const frame: DataFrame = {
    refId: 'A',
    length: 2,
    fields: [
      { name: 'id', type: FieldType.string, config: { actions }, values: ['r-1', 'r-2'] },
      { name: 'lat', type: FieldType.number, config: {}, values: [-1.5, -2.5] },
    ],
  };
  for (const field of frame.fields) {
    field.state = { scopedVars: { __dataContext: { value: { data: [frame], frame, field, frameIndex: 0 } } } as never };
  }
  return frame;
}

const close = (over: Partial<ActionConfig> = {}): ActionConfig =>
  ({
    type: 'fetch',
    title: 'Close report ${__data.fields.id}',
    fetch: {
      method: HttpRequestMethod.POST,
      url: 'https://ops.example/reports/${__data.fields.id}/close',
      body: '{"team":"${team}","lat":${__data.fields.lat}}',
      headers: [['Content-Type', 'application/json']],
      queryParams: [['by', '${team}']],
    },
    ...over,
  }) as ActionConfig;

const ORIGIN = 'https://pacha.example';

describe('entityActions', () => {
  it('builds the request from the clicked row, not from the query’s first row', () => {
    const [action] = entityActions({
      frame: frameWith([close()]),
      values: { id: 'r-2', latitude: -2.5 },
      renames: { lat: 'latitude' },
      replaceVariables: interpolate,
      origin: ORIGIN,
    });
    expect(action.title).toBe('Close report r-2');
    expect(action.request()).toEqual({
      url: 'https://ops.example/reports/r-2/close?by=north',
      method: 'POST',
      data: '{"team":"north","lat":-2.5}',
      headers: { 'Content-Type': 'application/json', 'X-Grafana-Action': '1' },
    });
  });

  it('confirms with Grafana’s default question when none is set', () => {
    const [action] = entityActions({
      frame: frameWith([close()]),
      values: { id: 'r-1' },
      replaceVariables: interpolate,
      origin: ORIGIN,
    });
    expect(action.confirmation()).toBe('Are you sure you want to Close report r-1?');
  });

  it('puts the viewer’s values in for the variables the action declares', () => {
    const withNote = close({
      variables: [{ key: 'note', name: 'Note', type: 'string' }],
      confirmation: 'Close ${__data.fields.id} saying "$note"?',
      fetch: {
        method: HttpRequestMethod.POST,
        url: 'https://ops.example/close',
        body: '{"note":"$note","x":"$other"}',
      },
    });
    const [action] = entityActions({
      frame: frameWith([withNote]),
      values: { id: 'r-1' },
      replaceVariables: interpolate,
      origin: ORIGIN,
    });
    expect(action.variables.map((v) => v.key)).toEqual(['note']);
    expect(action.confirmation({ note: 'cleared' })).toBe('Close r-1 saying "cleared"?');
    expect(action.request({ note: 'cleared' }).data).toBe('{"note":"cleared","x":"$other"}');
  });

  it('sends no body with a GET', () => {
    const get = close({ fetch: { method: HttpRequestMethod.GET, url: 'https://ops.example/ping', body: '{"a":1}' } });
    const [action] = entityActions({
      frame: frameWith([get]),
      values: {},
      replaceVariables: interpolate,
      origin: ORIGIN,
    });
    expect(action.request().data).toBeUndefined();
  });

  it('sends {} when a POST has no body', () => {
    const bare = close({ fetch: { method: HttpRequestMethod.POST, url: 'https://ops.example/ping' } });
    const [action] = entityActions({
      frame: frameWith([bare]),
      values: {},
      replaceVariables: interpolate,
      origin: ORIGIN,
    });
    expect(action.request().data).toBe('{}');
  });

  it('leaves out the actions Grafana proxies through Infinity', () => {
    const infinity = { ...close(), type: 'infinity' } as unknown as ActionConfig;
    expect(
      entityActions({ frame: frameWith([infinity]), values: {}, replaceVariables: interpolate, origin: ORIGIN })
    ).toEqual([]);
  });

  it('shows an action set on every field once', () => {
    const frame = frameWith([close()]);
    for (const field of frame.fields) {
      field.config = { actions: [close()] };
    }
    expect(entityActions({ frame, values: { id: 'r-1' }, replaceVariables: interpolate, origin: ORIGIN })).toHaveLength(
      1
    );
  });

  it('tells whether any query carries an action', () => {
    expect(framesHaveActions([frameWith(undefined)])).toBe(false);
    expect(framesHaveActions([frameWith([close()])])).toBe(true);
  });
});

describe('withActionVariables', () => {
  it('replaces only the declared variables that have a value', () => {
    expect(withActionVariables('$a $b $c', [{ key: 'a' }, { key: 'b' }], { a: '1' })).toBe('1 $b $c');
  });
});

describe('actionUrl', () => {
  it('gives a path on this Grafana its sub-path and origin', () => {
    expect(actionUrl('/api/annotations', ORIGIN).toString()).toBe('https://pacha.example/grafana/api/annotations');
  });

  it('keeps an absolute URL as it is', () => {
    expect(actionUrl('https://ops.example/x?y=1', ORIGIN).toString()).toBe('https://ops.example/x?y=1');
  });
});
