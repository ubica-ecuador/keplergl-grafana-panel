import { renderHook } from '@testing-library/react';
import type { Store } from 'redux';

import type { SavedMapConfig } from '../data/mapConfig';
import { captureMapConfig } from './keplerAdapter';
import { useSaveMapConfig } from './useSaveMapConfig';

jest.mock('./keplerAdapter', () => ({ captureMapConfig: jest.fn() }));

const capture = captureMapConfig as jest.MockedFunction<typeof captureMapConfig>;
const store = {} as Store;
const CAPTURED: SavedMapConfig = { version: 'v1', config: { visState: { layers: [{ id: 'trips' }] } } };

function setup(saveRequest = 0) {
  const onMapConfigCaptured = jest.fn();
  const appliedConfig = { current: undefined as SavedMapConfig | null | undefined };
  const hook = renderHook(
    ({ request }) =>
      useSaveMapConfig({ store, saveRequest: request, onMapConfigCaptured, appliedConfigRef: appliedConfig }),
    { initialProps: { request: saveRequest } }
  );
  return { ...hook, onMapConfigCaptured, appliedConfig };
}

beforeEach(() => {
  capture.mockReset();
  capture.mockReturnValue(CAPTURED);
});

describe('useSaveMapConfig', () => {
  it('saves nothing on mount, whatever count the options carry', () => {
    const { onMapConfigCaptured } = setup(5);

    expect(capture).not.toHaveBeenCalled();
    expect(onMapConfigCaptured).not.toHaveBeenCalled();
  });

  it('saves once when the options editor bumps the request', () => {
    const { rerender, onMapConfigCaptured, appliedConfig } = setup(0);

    rerender({ request: 1 });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(store);
    expect(onMapConfigCaptured).toHaveBeenCalledTimes(1);
    expect(onMapConfigCaptured).toHaveBeenCalledWith(CAPTURED);
    // So the options change the save causes does not rebuild the map.
    expect(appliedConfig.current).toBe(CAPTURED);
  });

  it('does not save again on a re-render with the same request', () => {
    const { rerender, onMapConfigCaptured } = setup(0);

    rerender({ request: 1 });
    rerender({ request: 1 });

    expect(onMapConfigCaptured).toHaveBeenCalledTimes(1);
  });

  it('saves once when called directly, as the map’s button does', () => {
    const { result, onMapConfigCaptured, appliedConfig } = setup(0);

    expect(result.current()).toBe(true);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(onMapConfigCaptured).toHaveBeenCalledTimes(1);
    expect(onMapConfigCaptured).toHaveBeenCalledWith(CAPTURED);
    expect(appliedConfig.current).toBe(CAPTURED);
  });

  it('hands nothing on before kepler has registered its instance', () => {
    capture.mockReturnValue(null);
    const { result, rerender, onMapConfigCaptured, appliedConfig } = setup(0);

    expect(result.current()).toBe(false);
    rerender({ request: 1 });

    expect(onMapConfigCaptured).not.toHaveBeenCalled();
    expect(appliedConfig.current).toBeUndefined();
  });
});
