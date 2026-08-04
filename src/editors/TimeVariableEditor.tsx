import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { Combobox, ComboboxOption, InlineField, InlineFieldRow, Stack, Text } from '@grafana/ui';

import { TimeVariableMapping } from '../panel/timeVariableSync';
import { KeplerPanelOptions } from '../types';

type Props = StandardEditorProps<TimeVariableMapping | undefined, unknown, KeplerPanelOptions>;

/**
 * Picks the two variables the time slider's window is published to.
 *
 * Both ends are needed before anything is published, so the hint stays visible
 * until they are set. The values are written as UTC ISO 8601, which drops
 * straight into a `timestamptz` comparison without any arithmetic.
 */
export function TimeVariableEditor({ value, onChange }: Props) {
  const mapping = value ?? { from: '', to: '' };

  const variables: Array<ComboboxOption<string>> = getTemplateSrv()
    .getVariables()
    .map((v) => ({ label: `$${v.name}`, value: v.name }));

  const setEnd = (patch: Partial<TimeVariableMapping>) => {
    const next = { ...mapping, ...patch };
    onChange(next.from || next.to ? next : undefined);
  };

  return (
    <Stack direction="column" gap={1}>
      {variables.length === 0 ? (
        <Text variant="bodySmall" color="secondary">
          Add two text box variables to the dashboard first — one for each end of the window.
        </Text>
      ) : (
        <Text variant="bodySmall" color="secondary">
          Written as UTC ISO 8601, so other panels can query{' '}
          <code>{`WHERE t >= '$${mapping.from || 'from'}'::timestamptz`}</code>. Leave this panel&apos;s own query on{' '}
          <code>$__timeFilter</code> so the slider never shrinks the data behind itself.
        </Text>
      )}

      <InlineFieldRow>
        <InlineField label="From" labelWidth={8}>
          <Combobox
            options={variables}
            value={mapping.from || null}
            placeholder="variable"
            width={20}
            onChange={(o) => setEnd({ from: o?.value ?? '' })}
          />
        </InlineField>
        <InlineField label="To" labelWidth={6}>
          <Combobox
            options={variables}
            value={mapping.to || null}
            placeholder="variable"
            width={20}
            onChange={(o) => setEnd({ to: o?.value ?? '' })}
          />
        </InlineField>
      </InlineFieldRow>
    </Stack>
  );
}
