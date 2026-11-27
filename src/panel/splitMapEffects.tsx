import React, { useReducer, useRef } from 'react';
import { LIGHT_AND_SHADOW_EFFECT } from '@kepler.gl/constants';
import { createEffect } from '@kepler.gl/effects';
import { computeDeckEffects } from '@kepler.gl/utils';

type DeckProps = Record<string, unknown>;
type OnDeckRender = (deckProps: DeckProps) => DeckProps | null;

/**
 * The map's effects — Light & Shadow, the fogs, the post-processing ones — on
 * the right-hand side of a split map too.
 *
 * kepler hands DeckGL its effects only on the map of index 0
 * (`MapContainer._isOKToRenderEffects`, "Allow effects only for the first
 * view"): kepler keeps one deck effect per effect, and a deck effect holds the
 * shadow maps and render targets of the one GPU device it was set up on, while
 * each side of a split map is a Deck of its own. So the right-hand map, the one
 * a swipe shows on the right of the handle, drew no shadow and no fog at all:
 * the left half of a swipe was lit and the right half flat.
 *
 * The right-hand map is given effects of its own here: a copy of each of
 * kepler's effects (same id, type and parameters), made once and kept in step
 * with kepler's on every render, so each deck effect belongs to one Deck.
 * kepler's `computeDeckEffects` then does for the copies what it does for the
 * originals — the sun's time from the time mode and the map's clock, night,
 * shadow colour, no shadows or fog on a globe — with `isExport` set only so it
 * neither adopts nor records kepler's one page-wide lighting effect
 * (`_lastLightingDeckEffect`, which belongs to the left map's Deck); the
 * export flag is taken off the copies again before deck sees them.
 */

/** What this needs of a kepler effect. */
export interface KeplerEffectLike {
  id: string;
  type: string;
  isEnabled: boolean;
  parameters: Record<string, unknown>;
  deckEffect: DeckEffectLike | null;
  setProps: (props: { isEnabled?: boolean; parameters?: Record<string, unknown> }) => void;
}

interface DeckEffectLike {
  shadow?: boolean;
  outputUniformShadow?: boolean;
  directionalLights?: Array<{ shadow?: boolean }>;
  isExportMode?: boolean;
}

interface VisStateLike {
  effects?: KeplerEffectLike[];
  effectOrder?: string[];
  [key: string]: unknown;
}

/** The copies of one map's effects, by id, and what each was last synced from. */
export interface EffectCopies {
  byId: Map<string, { copy: KeplerEffectLike; from: KeplerEffectLike['parameters']; enabled: boolean }>;
  /** The last Light & Shadow copy, kept (shadows off) after the effect is removed: see `copiedDeckEffects`. */
  lighting: DeckEffectLike | null;
}

export function newEffectCopies(): EffectCopies {
  return { byId: new Map(), lighting: null };
}

type Make = (props: {
  id: string;
  type: string;
  isEnabled: boolean;
  parameters: Record<string, unknown>;
}) => KeplerEffectLike;

const makeEffect: Make = (props) => createEffect(props) as unknown as KeplerEffectLike;

/** `effects` kept as copies in `copies`: made when new, updated when kepler's changed, dropped when gone. */
export function syncEffectCopies(
  effects: KeplerEffectLike[],
  copies: EffectCopies,
  make: Make = makeEffect
): KeplerEffectLike[] {
  const seen = new Set<string>();
  const out = effects.map((effect) => {
    seen.add(effect.id);
    const held = copies.byId.get(effect.id);
    if (!held || held.copy.type !== effect.type) {
      const copy = make({
        id: effect.id,
        type: effect.type,
        isEnabled: effect.isEnabled,
        parameters: effect.parameters,
      });
      copies.byId.set(effect.id, { copy, from: effect.parameters, enabled: effect.isEnabled });
      return copy;
    }
    if (held.from !== effect.parameters || held.enabled !== effect.isEnabled) {
      held.copy.setProps({ isEnabled: effect.isEnabled, parameters: effect.parameters });
      held.from = effect.parameters;
      held.enabled = effect.isEnabled;
    }
    return held.copy;
  });
  for (const id of [...copies.byId.keys()]) {
    if (!seen.has(id)) {
      copies.byId.delete(id);
    }
  }
  return out;
}

/** Shadows off on a deck lighting effect, as kepler's `disableDeckLightingEffect` does. */
function shadowsOff(deckEffect: DeckEffectLike): void {
  deckEffect.shadow = false;
  deckEffect.outputUniformShadow = false;
  for (const light of deckEffect.directionalLights ?? []) {
    light.shadow = false;
  }
}

type Compute = (args: { visState: unknown; mapState: unknown; isExport?: boolean }) => unknown[];

/**
 * The deck effects for the right-hand map: kepler's list worked out over the
 * copies. Only the copies' own deck effects are kept — kepler appends its
 * page-wide lighting effect when the list has none, and that one is the left
 * map's. Like kepler, a Light & Shadow removed from the map stays in the list
 * with its shadows off: deck drops the shadow shader module with the effect,
 * and layers already built with it would bind a shadow map that is gone.
 */
export function copiedDeckEffects(
  visState: VisStateLike,
  mapState: unknown,
  copies: EffectCopies,
  compute: Compute = computeDeckEffects as unknown as Compute,
  make?: Make
): unknown[] {
  const effects = syncEffectCopies(visState.effects ?? [], copies, make);
  const own = new Set(effects.map((effect) => effect.deckEffect).filter(Boolean));
  const deckEffects = (compute({ visState: { ...visState, effects }, mapState, isExport: true }) ?? []).filter((d) =>
    own.has(d as DeckEffectLike)
  ) as DeckEffectLike[];
  for (const deckEffect of deckEffects) {
    if ('isExportMode' in deckEffect) {
      deckEffect.isExportMode = false;
    }
  }
  const lighting = effects.find((effect) => effect.type === LIGHT_AND_SHADOW_EFFECT.type)?.deckEffect ?? null;
  if (lighting) {
    copies.lighting = lighting;
  } else if (copies.lighting) {
    shadowsOff(copies.lighting);
    deckEffects.unshift(copies.lighting);
  }
  return deckEffects;
}

interface MapContainerProps {
  /** kepler's vis state; read as {@link VisStateLike}, typed loosely so the panel's other wrappers compose. */
  visState?: unknown;
  mapState?: unknown;
  /** 0, or 1 on the right of a split map. */
  index?: number;
  isExport?: boolean;
  deckRenderCallbacks?: { onDeckRender?: OnDeckRender; onDeckAfterRender?: (deckProps: unknown) => void } & Record<
    string,
    unknown
  >;
}

/** kepler's `MapContainer`, with the map's effects on the right-hand side of a split map too. */
export function withSplitMapEffects<P extends MapContainerProps>(MapContainer: React.ComponentType<P>): React.FC<P> {
  const MapContainerWithSplitEffects: React.FC<P> = (props) => {
    const copies = useRef<EffectCopies>(newEffectCopies());
    // Whether deck has drawn: before its first frame it has no views, and effects handed to it then would be
    // prepared for none (kepler's own test, `_isOKToRenderEffects`, waits for the views as well).
    const drawn = useRef(false);
    const waiting = useRef(false);
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    const visState = props.visState as VisStateLike | undefined;
    const right = props.index === 1 && !props.isExport;
    const wanted = right && Boolean(visState?.effects?.length || copies.current.lighting);

    if (!wanted) {
      return <MapContainer {...props} />;
    }

    const callbacks = props.deckRenderCallbacks;
    const onDeckRender = (deckProps: DeckProps): DeckProps | null => {
      const base = callbacks?.onDeckRender ? callbacks.onDeckRender(deckProps) : deckProps;
      if (!base) {
        return base;
      }
      if (!drawn.current) {
        waiting.current = true;
        return base;
      }
      waiting.current = false;
      return { ...base, effects: copiedDeckEffects(visState ?? {}, props.mapState, copies.current) };
    };
    // Once deck has drawn, a map that was kept waiting is drawn again with its effects: kepler itself draws
    // again only when something changes.
    const onDeckAfterRender = (deckProps: unknown) => {
      drawn.current = true;
      if (waiting.current) {
        waiting.current = false;
        rerender();
      }
      callbacks?.onDeckAfterRender?.(deckProps);
    };

    return <MapContainer {...props} deckRenderCallbacks={{ ...callbacks, onDeckRender, onDeckAfterRender }} />;
  };

  return MapContainerWithSplitEffects;
}
