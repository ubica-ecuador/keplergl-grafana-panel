import { useEffect, useState } from 'react';
import { locationService } from '@grafana/runtime';

import type { Selection } from './selectionHalo';
import { isClickMapping, toStringValues, type VariableMapping } from './variableSync';

/**
 * Column → the values the click mappings' variables hold in this URL.
 *
 * Every click mapping counts, a `keepOnDeselect` one included: its variable
 * still filters the dashboard after the selection is cleared. Two mappings on
 * one column add up.
 */
export function selectionFromUrl(mappings: VariableMapping[], search: URLSearchParams): Selection {
  const selection: Record<string, string[]> = {};
  for (const mapping of mappings) {
    if (!isClickMapping(mapping) || !mapping.field) {
      continue;
    }
    const values = toStringValues(search.getAll(`var-${mapping.variable}`));
    if (values.length) {
      selection[mapping.field] = [...new Set([...(selection[mapping.field] ?? []), ...values])].sort();
    }
  }
  return selection;
}

function selectionKey(selection: Selection): string {
  return JSON.stringify(
    Object.keys(selection)
      .sort()
      .map((column) => [column, selection[column]])
  );
}

/**
 * The dashboard's selection, kept in step with the URL.
 *
 * Read from the URL rather than from props or the template service, like the
 * other variable hooks: the URL is what moves first when a variable changes.
 * The object keeps its identity while the values do not change, because it
 * travels down a context to every `MapContainer`, and any other URL change —
 * the time range, an unrelated variable — must not repaint the halo.
 */
export function useSelectionValues(mappings: VariableMapping[]): Selection {
  const [selection, setSelection] = useState<Selection>(() => selectionFromUrl(mappings, locationService.getSearch()));

  useEffect(() => {
    const update = () => {
      const next = selectionFromUrl(mappings, locationService.getSearch());
      setSelection((current) => (selectionKey(current) === selectionKey(next) ? current : next));
    };
    update();
    return locationService.getHistory().listen(update);
  }, [mappings]);

  return selection;
}
