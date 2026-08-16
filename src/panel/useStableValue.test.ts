import { renderHook } from '@testing-library/react';

import { useStableValue } from './useStableValue';

/**
 * Grafana deep-clones the whole panel options object on every options change,
 * so structurally identical sub-objects arrive with a fresh identity each time.
 * Anything that feeds a useMemo/useEffect dependency has to be re-anchored to
 * its previous identity while its content is unchanged, or every click in the
 * panel editor cascades into recomputed datasets and a kepler refresh.
 */
describe('useStableValue', () => {
  it('keeps the first identity while the content is unchanged', () => {
    const first = { latitude: 'lat', longitude: 'lon' };
    const clone = { latitude: 'lat', longitude: 'lon' };

    const { result, rerender } = renderHook(({ value }) => useStableValue(value), {
      initialProps: { value: first },
    });
    rerender({ value: clone });

    expect(result.current).toBe(first);
  });

  it('adopts the new value when the content changes', () => {
    const first = { latitude: 'lat', longitude: 'lon' };
    const changed = { latitude: 'y', longitude: 'lon' };

    const { result, rerender } = renderHook(({ value }) => useStableValue(value), {
      initialProps: { value: first },
    });
    rerender({ value: changed });

    expect(result.current).toBe(changed);
  });

  it('treats undefined as a value of its own', () => {
    const { result, rerender } = renderHook(({ value }) => useStableValue<unknown>(value), {
      initialProps: { value: undefined as unknown },
    });

    expect(result.current).toBeUndefined();

    const next = { latitude: 'lat' };
    rerender({ value: next });

    expect(result.current).toBe(next);
  });
});
