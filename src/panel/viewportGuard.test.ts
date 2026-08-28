import { decideViewportGuard, GUARD_WINDOW_MS, isKeplerDefaultViewport, savedViewportOf } from './viewportGuard';
import type { SavedMapConfig } from '../data/mapConfig';

/**
 * The decision behind "the saved viewport survives the load".
 *
 * kepler 3.x keeps an internal view state in a React context, seeded with the
 * mapState at mount time — the default — and a debounced propagate writes it
 * back into Redux after deck emits, clobbering the viewport the saved config
 * just applied. The guard watches the load window and restores the intended
 * viewport whenever the map lands exactly on kepler's default triple.
 * Everything here runs against literal values — no kepler, no store.
 */

const KEPLER_DEFAULT = { latitude: 37.75043, longitude: -122.34679, zoom: 9 };
const WORLD = { latitude: 15, longitude: 0, zoom: 1 };

function config(mapState: unknown): SavedMapConfig {
  return { version: 'v1', config: { mapState } } as unknown as SavedMapConfig;
}

describe('isKeplerDefaultViewport', () => {
  it('recognises the default triple, exactly and within float noise', () => {
    expect(isKeplerDefaultViewport(KEPLER_DEFAULT)).toBe(true);
    expect(isKeplerDefaultViewport({ latitude: 37.750430000001, longitude: -122.34679, zoom: 9 })).toBe(true);
  });

  it('rejects any genuinely different viewport', () => {
    expect(isKeplerDefaultViewport(WORLD)).toBe(false);
    expect(isKeplerDefaultViewport({ ...KEPLER_DEFAULT, zoom: 8 })).toBe(false);
  });
});

describe('savedViewportOf', () => {
  it('extracts the viewport a saved config carries', () => {
    expect(savedViewportOf(config({ latitude: 15, longitude: 0, zoom: 1, bearing: 0, pitch: 0 }))).toEqual({
      latitude: 15,
      longitude: 0,
      zoom: 1,
      bearing: 0,
      pitch: 0,
    });
  });

  it('is null without a config, without a mapState, or with a malformed one', () => {
    expect(savedViewportOf(null)).toBeNull();
    expect(savedViewportOf(undefined)).toBeNull();
    expect(savedViewportOf(config(undefined))).toBeNull();
    expect(savedViewportOf(config({ latitude: 'north', longitude: 0, zoom: 1 }))).toBeNull();
  });
});

describe('decideViewportGuard', () => {
  it('restores the saved viewport when the map sits on the default triple', () => {
    expect(
      decideViewportGuard({ elapsedMs: 700, attempts: 0, mapState: KEPLER_DEFAULT, saved: WORLD, bounds: null })
    ).toEqual({ kind: 'restore', viewport: WORLD });
  });

  it('stays quiet while the map shows anything but the default', () => {
    expect(
      decideViewportGuard({ elapsedMs: 700, attempts: 1, mapState: WORLD, saved: WORLD, bounds: null })
    ).toEqual({ kind: 'none' });
  });

  it('stays quiet when the saved viewport IS the default — the map is where it should be', () => {
    expect(
      decideViewportGuard({
        elapsedMs: 700,
        attempts: 0,
        mapState: KEPLER_DEFAULT,
        saved: { ...KEPLER_DEFAULT },
        bounds: null,
      })
    ).toEqual({ kind: 'none' });
  });

  it('fits the data bounds when there is no saved viewport to restore', () => {
    // The no-config case: addDataToMap meant to centre on the data, and the
    // same echo can undo that fit too.
    expect(
      decideViewportGuard({
        elapsedMs: 700,
        attempts: 0,
        mapState: KEPLER_DEFAULT,
        saved: null,
        bounds: [-79.03, -2.92, -78.98, -2.88],
      })
    ).toEqual({ kind: 'fit', bounds: [-79.03, -2.92, -78.98, -2.88] });
  });

  it('does nothing with neither a saved viewport nor bounds', () => {
    expect(
      decideViewportGuard({ elapsedMs: 700, attempts: 0, mapState: KEPLER_DEFAULT, saved: null, bounds: null })
    ).toEqual({ kind: 'none' });
  });

  it('disarms once the load window has passed', () => {
    expect(
      decideViewportGuard({ elapsedMs: GUARD_WINDOW_MS + 1, attempts: 0, mapState: KEPLER_DEFAULT, saved: WORLD, bounds: null })
    ).toEqual({ kind: 'disarm' });
  });

  it('disarms after exhausting its attempts rather than fighting forever', () => {
    expect(
      decideViewportGuard({ elapsedMs: 700, attempts: 3, mapState: KEPLER_DEFAULT, saved: WORLD, bounds: null })
    ).toEqual({ kind: 'disarm' });
  });
});
