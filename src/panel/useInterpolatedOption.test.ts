import { act, renderHook } from '@testing-library/react';

import { useInterpolatedOption } from './useInterpolatedOption';

const listeners: Array<() => void> = [];

jest.mock('@grafana/runtime', () => ({
  locationService: {
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

/** The variable values Grafana would resolve, and the lag it resolves them with. */
let resolved: Record<string, string> = {};

/**
 * Grafana's `replaceVariables`, with the one property that matters here: it is
 * the *same function object* on every render. That is what makes a memo keyed
 * on it never recompute, and the whole reason this hook exists.
 */
const interpolate = (value: string) => value.replace(/\$(\w+)/g, (_, name) => resolved[name] ?? '');

/** A variable picker turn: the URL moves first, the value lands a tick later. */
async function pickVariable(name: string, value: string) {
  await act(async () => {
    listeners.forEach((fn) => fn());
    // Measured on the bench: inside the history listener `replaceVariables`
    // still answers with the old value. Setting it only after the listeners
    // have run is what reproduces that here.
    resolved = { ...resolved, [name]: value };
    await Promise.resolve();
  });
}

beforeEach(() => {
  listeners.length = 0;
  resolved = { bands: 'forestBurn' };
});

describe('useInterpolatedOption', () => {
  it('resolves the variable on the first render', () => {
    const { result } = renderHook(() => useInterpolatedOption('$bands', interpolate));
    expect(result.current).toBe('forestBurn');
  });

  it('follows the variable when the dropdown turns, with no re-render of its own', async () => {
    const { result } = renderHook(() => useInterpolatedOption('$bands', interpolate));

    await pickVariable('bands', 'nbr');

    expect(result.current).toBe('nbr');
  });

  it('keeps the value when some other variable moves', async () => {
    const { result } = renderHook(() => useInterpolatedOption('$bands', interpolate));
    const first = result.current;

    await pickVariable('somethingElse', 'whatever');

    // Identity, not equality: a memo downstream is keyed on this value, and a
    // new string for an unchanged combination would rebuild every raster.
    expect(result.current).toBe(first);
  });

  it('subscribes to nothing for an option that names no variable', () => {
    const { result } = renderHook(() => useInterpolatedOption('trueColor', interpolate));
    expect(result.current).toBe('trueColor');
    expect(listeners).toHaveLength(0);
  });

  it('follows the option itself when the panel editor changes it', () => {
    const { result, rerender } = renderHook(({ raw }) => useInterpolatedOption(raw, interpolate), {
      initialProps: { raw: '$bands' },
    });
    expect(result.current).toBe('forestBurn');

    rerender({ raw: 'ndmi' });

    expect(result.current).toBe('ndmi');
  });

  it('stops listening when the panel goes away', () => {
    const { unmount } = renderHook(() => useInterpolatedOption('$bands', interpolate));
    expect(listeners).toHaveLength(1);

    unmount();

    expect(listeners).toHaveLength(0);
  });
});
