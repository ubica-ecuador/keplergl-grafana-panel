import { useEffect, useRef, useState } from 'react';
import { locationService } from '@grafana/runtime';

/** Grafana's own interpolator, as the panel receives it in `replaceVariables`. */
export type Interpolate = (value: string) => string;

/**
 * A panel option that names a dashboard variable, kept current when that
 * variable changes.
 *
 * `replaceVariables(options.x)` on its own is a one-shot read, and reading it
 * inside a `useMemo` keyed on `[options.x, replaceVariables]` — the obvious
 * spelling — freezes it for the life of the panel. Neither dependency ever
 * moves: the option holds the literal `'$bands'`, and `replaceVariables` is the
 * panel model's own bound `interpolate`, one object for the lifetime of the
 * panel. So the memo is computed once, at mount, and a dropdown the user turns
 * afterwards changes nothing at all — measured on the bench, including across a
 * full re-query, where the rasters around it were rebuilt with the frozen value
 * still in hand.
 *
 * Grafana's own refresh does not help either: it re-runs the queries that name
 * the variable, and a map whose queries deliberately do not name it — the
 * Imagery tab's scene query cannot, or picking a band would re-run the
 * catalogue search — is not among them.
 *
 * So the change is caught where it actually lands: the URL. Every variable
 * picker writes `var-<name>` into it, which is the race-free source of truth
 * the sync hooks already read (`useVariableSync`), and a history listener is
 * what tells this panel something moved.
 *
 * Deferred by a microtask, which is the part that is not obvious and was
 * measured rather than guessed: inside a history listener — and synchronously
 * after the location change — `replaceVariables` still answers with the *old*
 * value, because Grafana resolves the variable into the panel's scope after
 * telling the world the URL moved. One microtask later it is current. The same
 * lag `useVariableSync` documents for `getTemplateSrv()`, met from the other
 * side: there the answer was to read the URL instead; here the value wanted is
 * whatever Grafana's interpolation makes of it, so the only thing to do is let
 * it land first.
 *
 * Returns the interpolated string. Unchanged values keep their identity, so a
 * memo keyed on this does not recompute when someone else's variable moves.
 */
export function useInterpolatedOption(raw: string, interpolate: Interpolate): string {
  const [value, setValue] = useState(() => interpolate(raw));

  // Held in a ref rather than listed as a dependency: it is one stable object
  // in Grafana today, and a version that started handing out a fresh function
  // per render would otherwise tear down and re-add the listener on every
  // render without changing a thing.
  const interpolateRef = useRef(interpolate);
  useEffect(() => {
    interpolateRef.current = interpolate;
  }, [interpolate]);

  useEffect(() => {
    let live = true;
    const read = () => {
      const resolved = interpolateRef.current(raw);
      // Only when it really moved: this runs on every URL change, and any other
      // variable, the time range or a tab switch is one.
      setValue((current) => (current === resolved ? current : resolved));
    };

    // Once on mount and whenever the option itself is edited, for the panel
    // editor, where the value changes without the URL moving at all.
    read();

    // Nothing in the URL can change a literal.
    if (!raw.includes('$') && !raw.includes('[[')) {
      return;
    }
    const unlisten = locationService.getHistory().listen(() => {
      void Promise.resolve().then(() => {
        if (live) {
          read();
        }
      });
    });
    return () => {
      live = false;
      unlisten();
    };
  }, [raw]);

  return value;
}
