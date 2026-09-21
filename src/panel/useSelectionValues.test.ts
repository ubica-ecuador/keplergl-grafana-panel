import { act, renderHook } from '@testing-library/react';

import { selectionFromUrl, useSelectionValues } from './useSelectionValues';
import type { VariableMapping } from './variableSync';

const listeners: Array<() => void> = [];
let search = new URLSearchParams();

jest.mock('@grafana/runtime', () => ({
  locationService: {
    getSearch: () => search,
    getHistory: () => ({
      listen: (fn: () => void) => {
        listeners.push(fn);
        return () => {
          listeners.splice(listeners.indexOf(fn), 1);
        };
      },
    }),
  },
}));

/** The URL moves the way Grafana moves it: the search changes, then listeners run. */
function navigate(params: Record<string, string | string[]>) {
  search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    for (const one of Array.isArray(value) ? value : [value]) {
      search.append(name, one);
    }
  }
  act(() => listeners.forEach((fn) => fn()));
}

const site: VariableMapping = { field: 'site', variable: 'site', source: 'click' };
const siteKept: VariableMapping = { field: 'site', variable: 'siteKept', source: 'click', keepOnDeselect: true };
const category: VariableMapping = { field: 'category', variable: 'category' };

beforeEach(() => {
  search = new URLSearchParams();
  listeners.length = 0;
});

describe('selectionFromUrl', () => {
  it("reads each click mapping's variable into its column", () => {
    expect(selectionFromUrl([site], new URLSearchParams('var-site=site-07'))).toEqual({ site: ['site-07'] });
  });

  it('leaves out ordinary filter mappings', () => {
    expect(selectionFromUrl([category], new URLSearchParams('var-category=parks'))).toEqual({});
  });

  it('keeps every value of a multi-value variable', () => {
    expect(selectionFromUrl([site], new URLSearchParams('var-site=site-01&var-site=site-03'))).toEqual({
      site: ['site-01', 'site-03'],
    });
  });

  it("drops an empty value and Grafana's All", () => {
    expect(selectionFromUrl([site], new URLSearchParams('var-site='))).toEqual({});
    expect(selectionFromUrl([site], new URLSearchParams('var-site=$__all'))).toEqual({});
  });

  it('joins two mappings on one column, a kept one included', () => {
    const params = new URLSearchParams('var-site=&var-siteKept=site-07');
    expect(selectionFromUrl([site, siteKept], params)).toEqual({ site: ['site-07'] });
  });
});

describe('useSelectionValues', () => {
  it('follows the URL', () => {
    search = new URLSearchParams('var-site=site-01');
    const { result } = renderHook(() => useSelectionValues([site]));
    expect(result.current).toEqual({ site: ['site-01'] });

    navigate({ 'var-site': 'site-02' });
    expect(result.current).toEqual({ site: ['site-02'] });
  });

  it('keeps its identity when a URL change leaves the selection as it was', () => {
    search = new URLSearchParams('var-site=site-01');
    const { result } = renderHook(() => useSelectionValues([site]));
    const before = result.current;

    navigate({ 'var-site': 'site-01', 'var-other': 'x' });
    expect(result.current).toBe(before);
  });
});
