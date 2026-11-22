import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { Combobox, ComboboxOption, InlineField, InlineFieldRow, RadioButtonGroup, Stack, Text } from '@grafana/ui';

import { ViewFormat, ViewportVariables } from '../panel/viewportSync';
import { KeplerPanelOptions } from '../types';

type Props = StandardEditorProps<ViewportVariables | undefined, unknown, KeplerPanelOptions>;

type Edge = 'west' | 'south' | 'east' | 'north';

const EDGES: Array<{ key: Edge; label: string }> = [
  { key: 'west', label: 'West' },
  { key: 'south', label: 'South' },
  { key: 'east', label: 'East' },
  { key: 'north', label: 'North' },
];

const FORMATS: Array<{ label: string; value: ViewFormat; description: string }> = [
  { label: 'WKT', value: 'wkt', description: 'POLYGON((w s, e s, e n, w n, w s)), as the drawn area is written' },
  { label: 'w,s,e,n', value: 'bbox', description: 'west,south,east,north, as a bbox= parameter takes it' },
];

/**
 * Picks the four variables the map's viewport is published to.
 *
 * The hint carries the rule that makes this channel safe: the bbox is for
 * *other* panels. Putting it in this panel's own query is a ratchet — the
 * data behind the map would shrink to what is on screen, and zooming out
 * could never bring the rows back, because the dataset no longer holds them.
 *
 * Or one variable for the whole box, as WKT or `w,s,e,n`: what a data source
 * that reads an area itself (the Spatial Catalog's area field) takes as is.
 */
export function ViewportVariablesEditor({ value, onChange }: Props) {
  const variables: Array<ComboboxOption<string>> = getTemplateSrv()
    .getVariables()
    .map((v) => ({ label: `$${v.name}`, value: v.name }));

  const mapping = value ?? {};
  const set = (patch: Partial<ViewportVariables>) => {
    const next: ViewportVariables = { ...mapping, ...patch };
    if (!next.view) {
      // A format with no variable to write is no setting.
      delete next.viewFormat;
    }
    // An all-empty mapping is stored as an absence, so an untouched dashboard
    // JSON stays byte-identical.
    const named = next.west || next.south || next.east || next.north || next.view;
    onChange(named ? next : undefined);
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
          Add text box variables to the dashboard first: one per edge, or one for the whole box.
        </Text>
      ) : (
        <Text variant="bodySmall" color="secondary">
          The map publishes what it is showing when it comes to rest, so other panels can query{' '}
          <code>{`WHERE lng BETWEEN $${names.west} AND $${names.east} AND lat BETWEEN $${names.south} AND $${names.north}`}</code>
          , or name one variable for the whole box, as WKT (
          <code>{`ST_GeomFromText(\${${mapping.view || 'view'}:sqlstring})`}</code>) or <code>w,s,e,n</code>, which a
          data source that reads an area takes as is. Keep them out of this panel&apos;s own query: the map would shrink
          its own data to what is on screen, and zooming out could never bring those rows back.
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
              onChange={(o) => set({ [key]: o?.value || undefined })}
            />
          </InlineField>
        ))}
      </InlineFieldRow>

      <InlineFieldRow>
        <InlineField label="Whole box" labelWidth={12} tooltip="One variable holding the whole box">
          <Combobox
            options={variables}
            value={mapping.view || null}
            placeholder="variable"
            width={20}
            isClearable
            onChange={(o) => set({ view: o?.value || undefined })}
          />
        </InlineField>
        {mapping.view ? (
          <InlineField label="as" labelWidth={5}>
            <RadioButtonGroup
              options={FORMATS}
              value={mapping.viewFormat ?? 'wkt'}
              onChange={(f) => set({ viewFormat: f === 'wkt' ? undefined : f })}
            />
          </InlineField>
        ) : null}
      </InlineFieldRow>
    </Stack>
  );
}
