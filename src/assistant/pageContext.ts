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
 *
 * `data` lets a composing host (see `AssistantComposition` in
 * `AssistantContext.tsx`) register something other than the raw digest — e.g.
 * Plus's extended fields — without this function needing to know about that
 * seam. Left out, the item's data is the digest itself, exactly as before.
 */
export function buildContextItems(
  digest: AssistantDigest,
  title?: string,
  data?: Record<string, unknown>
): ChatContextItem[] {
  return [
    createAssistantContextItem('structured', {
      title: title ?? 'Kepler map (live)',
      bypassLimits: false,
      data: data ?? (digest as unknown as Record<string, unknown>),
    }),
  ];
}

/** Registers the digest as page context for the current dashboard URL; returns an unregister fn. */
export function registerAssistantContext(digest: AssistantDigest, title?: string, data?: Record<string, unknown>): () => void {
  const setter = providePageContext(/\/d\//, buildContextItems(digest, title, data));
  return () => setter.unregister();
}

export function assistantQuestions(): Question[] {
  return [
    { title: 'Explain this map', prompt: 'Explain what this Kepler map is showing.' },
    { title: 'Busiest area', prompt: 'Which area of this map has the most points?' },
  ];
}

/**
 * Registers suggested questions for the current dashboard URL; returns an
 * unregister fn.
 *
 * Ref-counted at module scope, unlike `registerAssistantContext`: the
 * Assistant SDK merges every registration matching a URL pattern, so N
 * mounted panels showing the same two starters (a split map, a panel-edit
 * double-mount) would otherwise register — and show — them N times. The first
 * mount to arrive registers for real; later ones share that registration.
 * Each returned fn only releases its own claim, and the last one to do so is
 * the one that actually unregisters. Context items are not ref-counted this
 * way because each panel's digest genuinely differs, so each keeps its own.
 */
let questionRefCount = 0;
let questionUnregister: (() => void) | null = null;

export function registerAssistantQuestions(): () => void {
  questionRefCount += 1;
  if (questionRefCount === 1) {
    const setter = provideQuestions(/\/d\//, assistantQuestions());
    questionUnregister = () => setter.unregister();
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    questionRefCount = Math.max(0, questionRefCount - 1);
    if (questionRefCount === 0) {
      questionUnregister?.();
      questionUnregister = null;
    }
  };
}
