import React from 'react';
import { DataFrame, StandardEditorProps } from '@grafana/data';
import { Combobox, ComboboxOption, InlineField, InlineFieldRow, Stack, Text } from '@grafana/ui';

import { detectFields, FieldRoleOverrides, FieldRoles } from '../data/detectFields';
import { KeplerPanelOptions } from '../types';

type Mappings = Record<string, FieldRoleOverrides>;
type Props = StandardEditorProps<Mappings | undefined, unknown, KeplerPanelOptions>;

/**
 * Stands in for `null` inside the combobox, which only carries string values.
 * Prefixed so it cannot collide with a real column name.
 */
const NONE_VALUE = '__none__';

/** Roles offered per query, in the order they matter for mobility data. */
const ROLES: Array<{ key: keyof FieldRoles; label: string; help: string }> = [
  { key: 'latitude', label: 'Latitude', help: 'Point latitude' },
  { key: 'longitude', label: 'Longitude', help: 'Point longitude' },
  { key: 'time', label: 'Time', help: 'Drives the timeline and trip animation' },
  { key: 'tripId', label: 'Trip ID', help: 'Groups points into trajectories' },
  { key: 'altitude', label: 'Altitude', help: 'Optional height for trip paths; defaults to 0' },
  { key: 'geometry', label: 'Geometry', help: 'GeoJSON, WKT or PostGIS EWKB' },
  { key: 'h3', label: 'H3 index', help: 'Hexagon identifier' },
  { key: 'originLat', label: 'Origin lat', help: 'Flow layer' },
  { key: 'originLng', label: 'Origin lng', help: 'Flow layer' },
  { key: 'destLat', label: 'Destination lat', help: 'Flow layer' },
  { key: 'destLng', label: 'Destination lng', help: 'Flow layer' },
  { key: 'count', label: 'Count', help: 'Flow magnitude' },
];

/**
 * Per-query mapping of columns to roles.
 *
 * Autodetection fills these in, and this editor exists for when it guesses
 * wrong or cannot guess at all. The Foursquare plugin has no equivalent: it
 * requires columns named exactly `latitude`/`longitude`/`time`, so users have to
 * rewrite their SQL around the plugin instead of the other way round.
 */
export function FieldMappingEditor({ value, onChange, context }: Props) {
  const frames = context.data ?? [];

  if (frames.length === 0) {
    return (
      <Text variant="bodySmall" color="secondary">
        Run a query to map its columns.
      </Text>
    );
  }

  // `undefined` clears the override and hands the role back to autodetection;
  // `null` switches the role off, which autodetection cannot express.
  const setRole = (refId: string, role: keyof FieldRoles, column: string | null | undefined) => {
    const next: Mappings = { ...(value ?? {}) };
    const forQuery: FieldRoleOverrides = { ...(next[refId] ?? {}) };

    if (column === undefined) {
      delete forQuery[role];
    } else {
      forQuery[role] = column;
    }

    next[refId] = forQuery;
    onChange(next);
  };

  return (
    <Stack direction="column" gap={2}>
      {frames.map((frame, index) => (
        <QueryMapping
          key={frame.refId ?? index}
          frame={frame}
          refId={frame.refId ?? `${index}`}
          overrides={value?.[frame.refId ?? `${index}`] ?? {}}
          onSetRole={setRole}
          showHeading={frames.length > 1}
        />
      ))}
    </Stack>
  );
}

interface QueryMappingProps {
  frame: DataFrame;
  refId: string;
  overrides: FieldRoleOverrides;
  onSetRole: (refId: string, role: keyof FieldRoles, column: string | null | undefined) => void;
  showHeading: boolean;
}

function QueryMapping({ frame, refId, overrides, onSetRole, showHeading }: QueryMappingProps) {
  const detected = detectFields(frame);
  const columns: Array<ComboboxOption<string>> = [
    // Switching a role off is a real answer, not the absence of one: a query
    // with a trip id is folded into trips, and only "None" gets it back to
    // one row per point.
    { label: 'None', value: NONE_VALUE, description: 'Ignore this role, whatever the columns are called' },
    ...frame.fields.map((f) => ({ label: f.name, value: f.name })),
  ];

  return (
    <Stack direction="column" gap={0.5}>
      {showHeading && <Text variant="bodySmall">Query {refId}</Text>}
      {ROLES.map(({ key, label, help }) => {
        const override = overrides[key];
        const auto = detected[key];

        return (
          <InlineFieldRow key={key}>
            <InlineField label={label} tooltip={help} labelWidth={16} grow>
              <Combobox
                options={columns}
                value={override === null ? NONE_VALUE : (override ?? null)}
                // Autodetected values live in the placeholder so the user can
                // see what the plugin inferred without it looking like an
                // explicit choice they made — and so clearing an override falls
                // back to autodetection rather than to nothing.
                placeholder={auto ? `${auto} (detected)` : 'Not set'}
                isClearable
                onChange={(option) =>
                  onSetRole(refId, key, option === null ? undefined : option.value === NONE_VALUE ? null : option.value)
                }
              />
            </InlineField>
          </InlineFieldRow>
        );
      })}
    </Stack>
  );
}
