import React from 'react';
import { act, render } from '@testing-library/react';
import { createEffect } from '@kepler.gl/effects';
import { computeDeckEffects } from '@kepler.gl/utils';

import {
  copiedDeckEffects,
  newEffectCopies,
  syncEffectCopies,
  withSplitMapEffects,
  type KeplerEffectLike,
} from './splitMapEffects';

const LIGHTING = 'lightAndShadow';

function lighting(parameters: Record<string, unknown> = {}, isEnabled = true): KeplerEffectLike {
  return createEffect({ id: 'sun', type: LIGHTING, isEnabled, parameters }) as unknown as KeplerEffectLike;
}

function visStateWith(effects: KeplerEffectLike[]) {
  return {
    effects,
    effectOrder: effects.map((e) => e.id),
    animationConfig: { currentTime: null },
    filters: [],
  };
}

const mapState = { latitude: -1.05, longitude: -80.45, isSplit: true };

describe('syncEffectCopies', () => {
  it('copies each effect once, with its id, type and parameters, and a deck effect of its own', () => {
    const original = lighting({ shadowIntensity: 0.7 });
    const copies = newEffectCopies();
    const [copy] = syncEffectCopies([original], copies);
    expect(copy).not.toBe(original);
    expect(copy.id).toBe('sun');
    expect(copy.type).toBe(LIGHTING);
    expect(copy.parameters.shadowIntensity).toBe(0.7);
    expect(copy.deckEffect).toBeTruthy();
    expect(copy.deckEffect).not.toBe(original.deckEffect);
    expect(syncEffectCopies([original], copies)[0]).toBe(copy);
  });

  it('follows a change of parameters or of the switch, and drops an effect removed', () => {
    const copies = newEffectCopies();
    const [copy] = syncEffectCopies([lighting({ shadowIntensity: 0.5 })], copies);
    const changed = lighting({ shadowIntensity: 0.9 }, false);
    expect(syncEffectCopies([changed], copies)[0]).toBe(copy);
    expect(copy.parameters.shadowIntensity).toBe(0.9);
    expect(copy.isEnabled).toBe(false);
    syncEffectCopies([], copies);
    expect(copies.byId.size).toBe(0);
  });
});

describe('copiedDeckEffects', () => {
  it("hands deck the copy's lighting effect, with shadows on, not the left map's", () => {
    const original = lighting({ timestamp: Date.UTC(2026, 10, 26, 17) });
    // The left map first, as kepler renders it: it records its lighting effect page-wide.
    const left = computeDeckEffects({ visState: visStateWith([original]) as never, mapState: mapState as never });
    const copies = newEffectCopies();
    const right = copiedDeckEffects(visStateWith([original]), mapState, copies) as Array<Record<string, unknown>>;
    expect(right).toHaveLength(1);
    expect(right[0]).not.toBe(left[0]);
    expect(right[0]).toBe(copies.byId.get('sun')?.copy.deckEffect);
    expect(right[0].shadow).toBe(true);
    expect(right[0].isExportMode).toBe(false);
    // And the left map keeps its own on the next frame.
    const leftAgain = computeDeckEffects({ visState: visStateWith([original]) as never, mapState: mapState as never });
    expect(leftAgain[0]).toBe(original.deckEffect);
  });

  it('keeps a removed Light & Shadow in the list with its shadows off, never the left map one', () => {
    const copies = newEffectCopies();
    const [first] = copiedDeckEffects(visStateWith([lighting()]), mapState, copies) as Array<Record<string, unknown>>;
    const after = copiedDeckEffects(visStateWith([]), mapState, copies) as Array<Record<string, unknown>>;
    expect(after).toEqual([first]);
    expect(first.shadow).toBe(false);
  });

  it('gives none to a map without effects', () => {
    expect(copiedDeckEffects(visStateWith([]), mapState, newEffectCopies())).toEqual([]);
  });
});

describe('withSplitMapEffects', () => {
  type Props = {
    index?: number;
    visState?: unknown;
    mapState?: unknown;
    deckRenderCallbacks?: {
      onDeckRender?: (p: Record<string, unknown>) => Record<string, unknown> | null;
      onDeckAfterRender?: (p: unknown) => void;
    };
  };
  const seen: Props[] = [];
  const Inner: React.FC<Props> = (props) => {
    seen.push(props);
    return null;
  };
  const Wrapped = withSplitMapEffects(Inner);

  beforeEach(() => {
    seen.length = 0;
  });

  it('leaves the left map to kepler', () => {
    const props = { index: 0, visState: visStateWith([lighting()]) };
    render(<Wrapped {...props} />);
    expect(seen[0].deckRenderCallbacks).toBeUndefined();
  });

  it('gives the right map its effects once deck has drawn, after the callbacks already in place', () => {
    const chained = jest.fn((p: Record<string, unknown>) => ({ ...p, chained: true }));
    const afterRender = jest.fn();
    render(
      <Wrapped
        index={1}
        visState={visStateWith([lighting()])}
        mapState={mapState}
        deckRenderCallbacks={{ onDeckRender: chained, onDeckAfterRender: afterRender }}
      />
    );
    const first = seen.length;
    // Before deck's first frame: kepler's (empty) effects stay.
    const before = seen[first - 1].deckRenderCallbacks!;
    expect(before.onDeckRender!({ effects: [] })).toEqual({ effects: [], chained: true });
    // deck draws: the callback in place still hears of it, and the map is rendered again.
    act(() => before.onDeckAfterRender!({}));
    expect(afterRender).toHaveBeenCalled();
    expect(seen.length).toBeGreaterThan(first);
    const out = seen[seen.length - 1].deckRenderCallbacks!.onDeckRender!({ effects: [] })!;
    expect(out.chained).toBe(true);
    expect(out.effects).toHaveLength(1);
  });
});
