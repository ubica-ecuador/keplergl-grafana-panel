import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { Combobox, ComboboxOption, InlineField, Stack, Text } from '@grafana/ui';

import { KeplerPanelOptions } from '../types';

type Props = StandardEditorProps<string | undefined, unknown, KeplerPanelOptions>;

/**
 * Picks the variable the drawn polygon/rectangle is published to, as WKT.
 *
 * The hint carries the two rules that make the value usable: the variable goes
 * into SQL unquoted (the SQL data sources add their own quotes when
 * interpolating), and it must never appear in this panel's own query —
 * feeding the map's own selection back into its query is the ratchet that
 * makes a drawn shape impossible to widen again.
 */
export function AreaVariableEditor({ value, onChange }: Props) {
  const variables: Array<ComboboxOption<string>> = getTemplateSrv()
    .getVariables()
    .map((v) => ({ label: `$${v.name}`, value: v.name }));

  const name = value || 'area';

  return (
    <Stack direction="column" gap={1}>
      {variables.length === 0 ? (
        <Text variant="bodySmall" color="secondary">
          Add a text box variable to the dashboard first.
        </Text>
      ) : (
        <Text variant="bodySmall" color="secondary">
          The figure arrives as WKT (EPSG:4326), so other panels can query{' '}
          <code>{`WHERE $${name} != '' AND ST_Intersects(geom, ST_GeomFromText($${name}, 4326))`}</code> — unquoted:
          the SQL data sources add the quotes themselves. Keep it out of this panel&apos;s own query, or drawing a
          shape would shrink the data behind the map and the shape could never be widened again.
        </Text>
      )}

      <InlineField label="Variable" labelWidth={10}>
        <Combobox
          options={variables}
          value={value || null}
          placeholder="variable"
          width={20}
          isClearable
          onChange={(o) => onChange(o?.value || undefined)}
        />
      </InlineField>
    </Stack>
  );
}
