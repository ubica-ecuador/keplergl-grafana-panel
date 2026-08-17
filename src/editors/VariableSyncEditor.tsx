import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { Button, Combobox, ComboboxOption, IconButton, InlineField, InlineFieldRow, Input, Stack, Text } from '@grafana/ui';

import { VariableMapping } from '../panel/variableSync';
import { KeplerPanelOptions } from '../types';

type Props = StandardEditorProps<VariableMapping[] | undefined, unknown, KeplerPanelOptions>;

/** How a mapping row is driven: a filter, a click's entity or place, or the pair read back. */
const SOURCE_OPTIONS: Array<ComboboxOption<'filter' | 'click' | 'coordinate' | 'center'>> = [
  { label: 'Filter', value: 'filter' },
  { label: 'Click', value: 'click' },
  { label: 'Coordinates', value: 'coordinate' },
  { label: 'Center', value: 'center' },
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
 *
 * Switching to Coordinates publishes the *place* clicked instead: the pair of
 * variables receives the latitude and longitude, for the consuming panel's
 * spatial query — `ST_DWithin(geom, ST_MakePoint($lng, $lat)::geography,
 * $radius)` with the radius a plain dashboard variable. No column applies, so
 * that field is hidden too.
 *
 * Center is the same pair read the other way: when the variables change from
 * outside — a table's data link, a textbox — the map centres on them, jumping
 * to the row's Zoom if one is set. The map's own clicks are recognised and
 * never re-centre, and on load the saved viewport wins: the pair moves the
 * map only when someone changes it.
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
                setRow(index, { source: o?.value === 'filter' ? undefined : o?.value })
              }
            />
          </InlineField>
          {mapping.source !== 'coordinate' && mapping.source !== 'center' && (
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
          )}
          <InlineField
            label={mapping.source === 'coordinate' || mapping.source === 'center' ? 'Lat' : 'Variable'}
            labelWidth={10}
          >
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
              label={mapping.source === 'coordinate' || mapping.source === 'center' ? 'Lng' : 'Max'}
              labelWidth={6}
              tooltip={
                mapping.source === 'coordinate' || mapping.source === 'center'
                  ? 'The longitude half of the pair; the first variable receives the latitude.'
                  : 'For a numeric column: the filter publishes its window as this pair, first variable = min, this one = max.'
              }
            >
              <Combobox
                options={variables}
                value={mapping.variableTo || null}
                placeholder={mapping.source === 'coordinate' || mapping.source === 'center' ? 'variable' : '(range)'}
                width={20}
                isClearable
                onChange={(o) => setRow(index, { variableTo: o?.value || undefined })}
              />
            </InlineField>
          )}
          {mapping.source === 'center' && (
            <InlineField
              label="Zoom"
              labelWidth={7}
              tooltip="Zoom level to jump to when centring. Empty keeps the current zoom."
            >
              <Input
                type="number"
                width={8}
                value={mapping.zoom ?? ''}
                placeholder="keep"
                onChange={(e) => {
                  const parsed = Number(e.currentTarget.value);
                  setRow(index, { zoom: e.currentTarget.value === '' || !Number.isFinite(parsed) ? undefined : parsed });
                }}
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
