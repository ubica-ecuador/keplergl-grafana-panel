import { createContext, useContext, useEffect, useState } from 'react';
import { firstValueFrom } from 'rxjs';
import { isAssistantAvailable } from '@grafana/assistant';
import type { PanelProps } from '@grafana/data';

import type { KeplerPanelOptions } from '../types';
import type { SavedMapConfig } from '../data/mapConfig';
import { buildAssistantDigest, type AssistantDigest } from './digest';
import { registerAssistantContext, registerAssistantQuestions } from './pageContext';

/** Props for {@link AssistantContext}: the panel's own props, plus the base
 * map id it has actually resolved to show (KeplerPanel's `basemapId` memo) —
 * kept separate from `options` because it is derived (theme, `auto`, saved
 * `styleType`…), not itself a saved option. */
export interface AssistantContextProps extends PanelProps<KeplerPanelOptions> {
  resolvedBasemapId?: string;
}

/**
 * Value a host composes onto this panel's Assistant registration when it
 * embeds the panel as a submodule (e.g. Plus), rather than mounting a second,
 * competing `providePageContext` registration alongside this one.
 *
 * No provider above `AssistantContext` — the default — reproduces exactly
 * today's behaviour: the raw digest, under the panel-derived title.
 */
export interface AssistantCompositionValue {
  /** Builds the registered item's data from the base digest, e.g. to add Plus-only fields. */
  extendDigest?: (digest: AssistantDigest) => Record<string, unknown>;
  /** Overrides the registered item's title. */
  title?: string;
}

export const AssistantComposition = createContext<AssistantCompositionValue>({});

/**
 * Registers a live digest of this panel's map as Grafana Assistant page
 * context, plus a small set of suggested questions. Renders nothing.
 *
 * Safe when the Assistant is absent: isAssistantAvailable() never rejects (it
 * falls back to false), and registering context makes no backend call, so it
 * does not depend on a live Cloud connection.
 */
export function AssistantContext(props: AssistantContextProps): null {
  const composition = useContext(AssistantComposition);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let alive = true;
    firstValueFrom(isAssistantAvailable())
      .then((ok) => {
        if (alive) {
          setAvailable(ok);
        }
      })
      .catch(() => {
        if (alive) {
          setAvailable(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  // Every input that changes the digest, so the effect re-registers on data,
  // option, or time-range change and unregisters on unmount. Filters and
  // bounds below are the panel's SAVED values — `mapConfig.config.visState.
  // filters` and `mapConfig.config.mapState` — which update on a map save or
  // an option change, not kepler's live, unsaved side-panel state; wiring the
  // live state in is deferred deliberately (final-review findings, Finding 3).
  const digestKey = JSON.stringify({
    t: [props.timeRange.from.valueOf(), props.timeRange.to.valueOf()],
    m: props.options.mapConfig,
    b: props.resolvedBasemapId,
    p: [props.id, props.title],
    n: props.data.series.map((s) => `${s.refId}:${s.length}`),
  });

  useEffect(() => {
    if (!available) {
      return;
    }
    const mapState = (props.options.mapConfig as SavedMapConfig | undefined)?.config?.mapState;
    const digest = buildAssistantDigest({
      series: props.data.series as never,
      mapConfig: props.options.mapConfig as never,
      baseMapId: props.resolvedBasemapId,
      bounds: mapState,
      timeRange: { from: props.timeRange.from.toISOString(), to: props.timeRange.to.toISOString() },
    });
    const title = composition.title ?? (props.title ? `Kepler map — ${props.title} (live)` : 'Kepler map (live)');
    const data = composition.extendDigest?.(digest);
    const unregisterCtx = registerAssistantContext(digest, title, data);
    const unregisterQuestions = registerAssistantQuestions();
    return () => {
      unregisterCtx();
      unregisterQuestions();
    };
    // digestKey captures the inputs above; props identity is not a stable
    // dep. `composition` is read fresh on every run rather than added as a
    // dep: it commonly carries an inline function from the composing host, so
    // depending on it would re-register on every host render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, digestKey]);

  return null;
}
