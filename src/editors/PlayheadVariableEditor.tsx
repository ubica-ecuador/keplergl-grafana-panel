import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { Combobox, ComboboxOption, InlineField, Stack, Text } from '@grafana/ui';

import { KeplerPanelOptions } from '../types';

type Props = StandardEditorProps<string | undefined, unknown, KeplerPanelOptions>;

/**
 * Picks the variable the trip playhead is written to. The hint shows the one
 * use that is not obvious: filtering on the instant from SQL, where the value
 * arrives as a UTC ISO 8601 string.
 */
export function PlayheadVariableEditor({ value, onChange }: Props) {
  const variables: Array<ComboboxOption<string>> = getTemplateSrv()
    .getVariables()
    .map((v) => ({ label: `$${v.name}`, value: v.name }));

  const name = value || 'playhead';

  return (
    <Stack direction="column" gap={1}>
      {variables.length === 0 ? (
        <Text variant="bodySmall" color="secondary">
          Add a text box variable to the dashboard first.
        </Text>
      ) : (
        <Text variant="bodySmall" color="secondary">
          The instant the trips are playing, as UTC ISO 8601, so other panels can query{' '}
          <code>{`WHERE $${name}::TIMESTAMPTZ BETWEEN trip_start AND trip_end`}</code>. Set it on one map only: a
          map following another&apos;s clock writes it too.
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
