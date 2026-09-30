import {
  createAssistantContextItem,
  providePageContext,
  provideQuestions,
  type ChatContextItem,
  type Question,
} from '@grafana/assistant';

import type { AssistantDigest } from './digest';

/**
 * Turns a live digest into the Assistant's context item(s) for this panel.
 *
 * A free function, not folded into registration, so a caller — this panel, or
 * an app composing on top of it — can build the item list without having to
 * register it. `AssistantDigest` (Task 3's frozen contract) carries no panel
 * identity, so the title is supplied by the caller rather than read off the
 * digest.
 */
export function buildContextItems(digest: AssistantDigest, title?: string): ChatContextItem[] {
  return [
    createAssistantContextItem('structured', {
      title: title ?? 'Kepler map (live)',
      bypassLimits: false,
      data: digest as unknown as Record<string, unknown>,
    }),
  ];
}

/** Registers the digest as page context for the current dashboard URL; returns an unregister fn. */
export function registerAssistantContext(digest: AssistantDigest, title?: string): () => void {
  const setter = providePageContext(/\/d\//, buildContextItems(digest, title));
  return () => setter.unregister();
}

export function assistantQuestions(): Question[] {
  return [
    { title: 'Explain this map', prompt: 'Explain what this Kepler map is showing.' },
    { title: 'Busiest area', prompt: 'Which area of this map has the most points?' },
  ];
}

/** Registers suggested questions for the current dashboard URL; returns an unregister fn. */
export function registerAssistantQuestions(): () => void {
  const setter = provideQuestions(/\/d\//, assistantQuestions());
  return () => setter.unregister();
}
