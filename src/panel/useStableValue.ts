import { useMemo } from 'react';

/**
 * Re-anchors a value to its previous identity while its content is unchanged.
 *
 * Grafana deep-clones the whole panel options object on every options change,
 * so a structurally identical sub-object arrives as a fresh reference after
 * every click in the panel editor. Fed straight into a useMemo/useEffect
 * dependency, each of those clicks recomputes the datasets and pushes a
 * needless refresh into kepler. Content comparison is by JSON, which is sound
 * here for the same reason it is in `loadDecision`: both sides come from the
 * same serialisation, so their key order matches.
 */
export function useStableValue<T>(value: T): T {
  const json = JSON.stringify(value);
  // The value is deliberately keyed by its serialised content, not its identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => value, [json]);
}
