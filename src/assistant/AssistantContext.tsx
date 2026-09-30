import { useEffect, useState } from 'react';
import { firstValueFrom } from 'rxjs';
import { isAssistantAvailable } from '@grafana/assistant';
import type { PanelProps } from '@grafana/data';

import type { KeplerPanelOptions } from '../types';
import { buildAssistantDigest } from './digest';
import { registerAssistantContext, registerAssistantQuestions } from './pageContext';

/**
 * Registers a live digest of this panel's map as Grafana Assistant page
 * context, plus a small set of suggested questions. Renders nothing.
 *
 * Safe when the Assistant is absent: isAssistantAvailable() never rejects (it
 * falls back to false), and registering context makes no backend call, so it
 * does not depend on a live Cloud connection.
 */
export function AssistantContext(props: PanelProps<KeplerPanelOptions>): null {
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
  // option, or time-range change and unregisters on unmount. PanelProps carry
  // no live viewport, and a saved mapConfig's `config.mapState` already holds
  // the last one, so no bounds are gathered here — buildAssistantDigest leaves
  // them undefined.
  const digestKey = JSON.stringify({
    t: [props.timeRange.from.valueOf(), props.timeRange.to.valueOf()],
    m: props.options.mapConfig,
    p: [props.id, props.title],
    n: props.data.series.map((s) => `${s.refId}:${s.length}`),
  });

  useEffect(() => {
    if (!available) {
      return;
    }
    const digest = buildAssistantDigest({
      series: props.data.series as never,
      mapConfig: props.options.mapConfig as never,
      timeRange: { from: props.timeRange.from.toISOString(), to: props.timeRange.to.toISOString() },
    });
    const title = props.title ? `Kepler map — ${props.title} (live)` : 'Kepler map (live)';
    const unregisterCtx = registerAssistantContext(digest, title);
    const unregisterQuestions = registerAssistantQuestions();
    return () => {
      unregisterCtx();
      unregisterQuestions();
    };
    // digestKey captures the inputs above; props identity is not a stable dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, digestKey]);

  return null;
}
