import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { ComboboxOption, MultiCombobox, Stack, Text } from '@grafana/ui';

import { KeplerPanelOptions } from '../types';

type Props = StandardEditorProps<string[] | undefined, unknown, KeplerPanelOptions>;

/** The names of the panel's query fields, once each, in query order. */
export function queryFieldNames(
  frames: ReadonlyArray<{ fields: ReadonlyArray<{ name: string }> }> | undefined
): string[] {
  const names = new Set<string>();
  for (const frame of frames ?? []) {
    for (const field of frame.fields) {
      names.add(field.name);
    }
  }
  return [...names];
}

/**
 * Picks the query fields the popup of a clicked entity offers as ad hoc
 * filters. The hint says what else it needs: an ad hoc filter variable for the
 * panel's datasource, and a datasource that applies it.
 */
export function AdHocFieldsEditor({ value, onChange, context }: Props) {
  const picked = value ?? [];
  const names = queryFieldNames(context.data);
  // A field picked earlier stays listed after its query stops returning it, so it can be removed.
  const options: Array<ComboboxOption<string>> = [...names, ...picked.filter((name) => !names.includes(name))].map(
    (name) => ({ label: name, value: name })
  );
  const hasAdHocVariable = getTemplateSrv()
    .getVariables()
    .some((v) => v.type === 'adhoc');

  return (
    <Stack direction="column" gap={1}>
      <Text variant="bodySmall" color="secondary">
        Shown only when the dashboard has an ad hoc filter variable for this panel’s datasource. The filter changes the
        queries of datasources that apply ad hoc filters (Chaski does; the server DuckDB and Infinity do not).
      </Text>
      {!hasAdHocVariable && picked.length > 0 ? (
        <Text variant="bodySmall" color="warning">
          This dashboard has no ad hoc filter variable yet: add one in Settings → Variables.
        </Text>
      ) : null}
      <MultiCombobox
        options={options}
        value={picked}
        placeholder="fields"
        width={30}
        // An empty list is stored as an absence, so an untouched dashboard JSON stays byte-identical.
        onChange={(chosen) => {
          const fields = chosen.map((o) => o.value).filter(Boolean);
          onChange(fields.length ? fields : undefined);
        }}
      />
    </Stack>
  );
}
