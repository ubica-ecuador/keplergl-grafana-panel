import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { Combobox, ComboboxOption, InlineField, InlineFieldRow, Stack, Text } from '@grafana/ui';

import { ViewportVariables } from '../panel/viewportSync';
import { KeplerPanelOptions } from '../types';

type Props = StandardEditorProps<ViewportVariables | undefined, unknown, KeplerPanelOptions>;

const EDGES: Array<{ key: keyof ViewportVariables; label: string }> = [
  { key: 'west', label: 'West' },
  { key: 'south', label: 'South' },
  { key: 'east', label: 'East' },
  { key: 'north', label: 'North' },
];

/**
 * Picks the four variables the map's viewport is published to.
 *
 * The hint carries the rule that makes this channel safe: the bbox is for
 * *other* panels. Putting it in this panel's own query is a ratchet — the
 * data behind the map would shrink to what is on screen, and zooming out
 * could never bring the rows back, because the dataset no longer holds them.
 */
export function ViewportVariablesEditor({ value, onChange }: Props) {
  const variables: Array<ComboboxOption<string>> = getTemplateSrv()
    .getVariables()
    .map((v) => ({ label: `$${v.name}`, value: v.name }));

  const mapping = value ?? {};
  const setEdge = (key: keyof ViewportVariables, name: string | undefined) => {
    const next = { ...mapping, [key]: name };
    // An all-empty mapping is stored as an absence, so an untouched dashboard
    // JSON stays byte-identical.
    onChange(Object.values(next).some(Boolean) ? next : undefined);
  };

  const names = {
    west: mapping.west || 'west',
    south: mapping.south || 'south',
    east: mapping.east || 'east',
    north: mapping.north || 'north',
  };

  return (
    <Stack direction="column" gap={1}>
      {variables.length === 0 ? (
        <Text variant="bodySmall" color="secondary">
          Add text box variables to the dashboard first — one per edge.
        </Text>
      ) : (
        <Text variant="bodySmall" color="secondary">
          The map publishes what it is showing when it comes to rest, so other panels can query{' '}
          <code>{`WHERE lng BETWEEN $${names.west} AND $${names.east} AND lat BETWEEN $${names.south} AND $${names.north}`}</code>
          . Keep it out of this panel&apos;s own query: the map would shrink its own data to what is on screen, and
          zooming out could never bring those rows back.
        </Text>
      )}

      <InlineFieldRow>
        {EDGES.map(({ key, label }) => (
          <InlineField key={key} label={label} labelWidth={7}>
            <Combobox
              options={variables}
              value={mapping[key] || null}
              placeholder="variable"
              width={16}
              isClearable
              onChange={(o) => setEdge(key, o?.value || undefined)}
            />
          </InlineField>
        ))}
      </InlineFieldRow>
    </Stack>
  );
}
