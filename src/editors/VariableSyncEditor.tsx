import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { Button, Combobox, ComboboxOption, IconButton, InlineField, InlineFieldRow, Stack, Text } from '@grafana/ui';

import { VariableMapping } from '../panel/variableSync';
import { KeplerPanelOptions } from '../types';

type Props = StandardEditorProps<VariableMapping[] | undefined, unknown, KeplerPanelOptions>;

/** How a mapping row is driven: by the filter on its column, or by a click. */
const SOURCE_OPTIONS: Array<ComboboxOption<'filter' | 'click'>> = [
  { label: 'Filter', value: 'filter' },
  { label: 'Click', value: 'click' },
];

/**
 * Binds kepler filters to dashboard variables.
 *
 * Each row maps a filtered column to a template variable; when the user sets a
 * select or text filter on that column, the panel writes its value to the
 * variable and the rest of the dashboard re-queries. Turning a map into a
 * cross-filter control is something the Foursquare plugin cannot do at all.
 *
 * Naming a second variable in "Max" turns the row into a *range* mapping: a
 * numeric filter on the column publishes its window as the min/max pair —
 * `speed BETWEEN '$speedMin' AND '$speedMax'` on the consuming panel — the
 * same two-variable encoding the time window uses.
 *
 * Switching "From" to Click turns the row into an *entity* mapping: clicking
 * a point or trajectory on the map publishes that entity's value of the
 * column — `WHERE vehicle_id = '$vehicle'` on the consuming panel. One way
 * only, so the Max field does not apply and is hidden.
 */
export function VariableSyncEditor({ value, onChange, context }: Props) {
  const mappings = value ?? [];

  const columns = uniqueColumns(context.data);
  const variables: Array<ComboboxOption<string>> = getTemplateSrv()
    .getVariables()
    .map((v) => ({ label: `$${v.name}`, value: v.name }));

  const update = (next: VariableMapping[]) => onChange(next.length ? next : undefined);
  const setRow = (index: number, patch: Partial<VariableMapping>) =>
    update(mappings.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  const addRow = () => update([...mappings, { field: '', variable: '' }]);
  const removeRow = (index: number) => update(mappings.filter((_, i) => i !== index));

  return (
    <Stack direction="column" gap={1}>
      {variables.length === 0 && (
        <Text variant="bodySmall" color="secondary">
          Add a dashboard variable first, then map a filter to it.
        </Text>
      )}

      {mappings.map((mapping, index) => (
        <InlineFieldRow key={index}>
          <InlineField
            label="From"
            labelWidth={8}
            tooltip="What drives the variable: the filter set on the column (two-way), or the entity clicked on the map (one-way)."
          >
            <Combobox
              options={SOURCE_OPTIONS}
              value={mapping.source ?? 'filter'}
              width={12}
              onChange={(o) =>
                // `filter` is the default, so it is stored as an absence and an
                // untouched dashboard JSON stays byte-identical.
                setRow(index, { source: o?.value === 'click' ? 'click' : undefined })
              }
            />
          </InlineField>
          <InlineField label={mapping.source === 'click' ? 'Column' : 'Filter'} labelWidth={8}>
            <Combobox
              options={columns}
              value={mapping.field || null}
              placeholder="column"
              width={20}
              createCustomValue
              onChange={(o) => setRow(index, { field: o?.value ?? '' })}
            />
          </InlineField>
          <InlineField label="Variable" labelWidth={10}>
            <Combobox
              options={variables}
              value={mapping.variable || null}
              placeholder="variable"
              width={20}
              onChange={(o) => setRow(index, { variable: o?.value ?? '' })}
            />
          </InlineField>
          {mapping.source !== 'click' && (
            <InlineField
              label="Max"
              labelWidth={6}
              tooltip="For a numeric column: the filter publishes its window as this pair, first variable = min, this one = max."
            >
              <Combobox
                options={variables}
                value={mapping.variableTo || null}
                placeholder="(range)"
                width={20}
                isClearable
                onChange={(o) => setRow(index, { variableTo: o?.value || undefined })}
              />
            </InlineField>
          )}
          <IconButton name="trash-alt" tooltip="Remove" aria-label="Remove mapping" onClick={() => removeRow(index)} />
        </InlineFieldRow>
      ))}

      <div>
        <Button variant="secondary" size="sm" icon="plus" onClick={addRow}>
          Add mapping
        </Button>
      </div>
    </Stack>
  );
}

function uniqueColumns(frames: Props['context']['data']): Array<ComboboxOption<string>> {
  const names = new Set<string>();
  for (const frame of frames ?? []) {
    for (const field of frame.fields) {
      names.add(field.name);
    }
  }
  return [...names].map((name) => ({ label: name, value: name }));
}
