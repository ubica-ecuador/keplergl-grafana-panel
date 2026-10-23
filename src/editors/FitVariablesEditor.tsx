import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { ComboboxOption, MultiCombobox, Stack, Text } from '@grafana/ui';

import { KeplerPanelOptions } from '../types';

type Props = StandardEditorProps<string[] | undefined, unknown, KeplerPanelOptions>;

/**
 * Picks the variables whose change frames the map on its data again. The hint
 * says when to want it, and the cost of picking one that does not move the
 * rows: the map would jump back to the data every time it changes.
 */
export function FitVariablesEditor({ value, onChange }: Props) {
  const variables: Array<ComboboxOption<string>> = getTemplateSrv()
    .getVariables()
    .map((v) => ({ label: `$${v.name}`, value: v.name }));

  return (
    <Stack direction="column" gap={1}>
      <Text variant="bodySmall" color="secondary">
        For variables that move the data somewhere else — a state, a route, a city. When one changes, the map frames the
        new rows as it does on load. Leave out the ones that only filter what is already in view, or the map will jump
        back to the whole dataset each time.
      </Text>
      <MultiCombobox
        options={variables}
        value={value ?? []}
        placeholder="variables"
        width={30}
        // An empty list is stored as an absence, so an untouched dashboard JSON stays byte-identical.
        onChange={(options) => {
          const names = options.map((o) => o.value).filter(Boolean);
          onChange(names.length ? names : undefined);
        }}
      />
    </Stack>
  );
}
