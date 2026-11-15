import React from 'react';
import { DataFrame, type PanelOptionsEditorItem, StandardEditorProps } from '@grafana/data';
import {
  Combobox,
  ComboboxOption,
  IconButton,
  InlineField,
  InlineFieldRow,
  RadioButtonGroup,
  Stack,
  Text,
} from '@grafana/ui';

import type { TripLayerMode } from '../data/buildTripLayer';
import { detectFields, FieldRoleOverrides, resolveRoles } from '../data/detectFields';
import { isTripFrame } from '../data/framesToDatasets';
import { GAZETTEERS, placedByName } from '../data/placeLookup';
import { EVERY_QUERY, queryOptionsFor } from '../panel/queryOptions';
import type { KeplerPanelOptions, QueryOptions } from '../types';

type ByQuery = Record<string, QueryOptions>;

/**
 * Whether a query's place names are placed by something else than the panel's
 * gazetteer: an edition's own places (Kepler Plus's Places), which draws the
 * query its way before the free panel sees it. Its Place names is then not
 * offered here, where it would do nothing.
 */
export type PlacesElsewhere = (frame: DataFrame, refId: string, options: KeplerPanelOptions) => boolean;

export interface QueryOptionsSettings {
  placesElsewhere?: PlacesElsewhere;
}

type Props = StandardEditorProps<ByQuery | undefined, QueryOptionsSettings, KeplerPanelOptions>;

export const TRIP_MODES: Array<{ value: TripLayerMode; label: string; description: string }> = [
  {
    value: 'table',
    label: 'Table columns',
    description: 'One row per point: speed, mode and every other column stay for colour, filters and tooltips.',
  },
  {
    value: 'geojson',
    label: 'GeoJSON',
    description: 'Each trip folded into one row: far less data, but only the path survives.',
  },
];

export const GAZETTEER_OPTIONS: Array<ComboboxOption<string>> = [
  { value: GAZETTEERS.countries, label: 'Countries (name, 2- or 3-letter code)' },
  { value: GAZETTEERS.usaStates, label: 'US states (name or code)' },
  { value: GAZETTEERS.airports, label: 'Airports (IATA or ICAO code)' },
];

const gazetteerLabel = (path: string) => GAZETTEER_OPTIONS.find((option) => option.value === path)?.label ?? path;

/** What a query offers to set here: a Trip layer shape for a trajectory, a gazetteer for names to place. */
export function queryNeeds(
  frame: DataFrame,
  refId: string,
  options: KeplerPanelOptions,
  placesElsewhere?: PlacesElsewhere
) {
  const roles = resolveRoles(detectFields(frame), options.fieldMappings?.[refId] as FieldRoleOverrides | undefined);
  return {
    trips: isTripFrame(roles),
    places: placedByName(roles) && !roles.geohash && Boolean(roles.lookup) && !placesElsewhere?.(frame, refId, options),
  };
}

/** Whether the editor has anything to show: a query that needs it, or a value every query takes. */
export function showQueryOptions(
  options: KeplerPanelOptions,
  frames: DataFrame[] | undefined,
  placesElsewhere?: PlacesElsewhere
): boolean {
  if (options.queryOptions?.[EVERY_QUERY]) {
    return true;
  }
  return (frames ?? []).some((frame, index) => {
    const needs = queryNeeds(frame, frame.refId ?? `${index}`, options, placesElsewhere);
    return needs.trips || needs.places;
  });
}

/**
 * The options editor's entry, under Field mapping. An edition that places
 * names its own way passes how it tells (`placesElsewhere`).
 */
export function queryOptionsEditor(
  placesElsewhere?: PlacesElsewhere
): PanelOptionsEditorItem<KeplerPanelOptions, ByQuery | undefined, QueryOptionsSettings> {
  return {
    id: 'queryOptions',
    path: 'queryOptions',
    name: 'Drawing each query',
    description:
      'What differs from one query to the next: the Trip layer shape of a trajectory, where place names are looked up.',
    category: ['Field mapping'],
    editor: QueryOptionsEditor,
    settings: { placesElsewhere },
    showIf: (options, data) => showQueryOptions(options, data, placesElsewhere),
  };
}

/**
 * Per-query drawing options, under each query's refId: what one query of a
 * panel may need and another not (`queryOptions.ts`). Beside the field
 * mapping, which is per query too.
 */
export function QueryOptionsEditor({ value, onChange, context, item }: Props) {
  const frames = context.data ?? [];
  const options = context.options ?? {};
  const placesElsewhere = item?.settings?.placesElsewhere;

  const set = (refId: string, key: keyof QueryOptions, next: string | undefined) => {
    const all: ByQuery = { ...(value ?? {}) };
    const own: QueryOptions = { ...all[refId] };
    if (next === undefined) {
      delete own[key];
    } else {
      (own as Record<string, string>)[key] = next;
    }
    if (Object.keys(own).length) {
      all[refId] = own;
    } else {
      delete all[refId];
    }
    onChange(Object.keys(all).length ? all : undefined);
  };

  const shown = frames
    .map((frame, index) => {
      const refId = frame.refId ?? `${index}`;
      return { refId, needs: queryNeeds(frame, refId, options, placesElsewhere) };
    })
    .filter(({ needs }) => needs.trips || needs.places);
  const every = value?.[EVERY_QUERY];
  // What a query with no value of its own takes: the `*` entry, a panel-wide value of 1.9 that no migration moved,
  // or the default.
  const inherited = queryOptionsFor({ ...options, queryOptions: every ? { [EVERY_QUERY]: every } : undefined }, '');

  return (
    <Stack direction="column" gap={2}>
      {shown.map(({ refId, needs }) => {
        const own = value?.[refId] ?? {};
        return (
          <Stack key={refId} direction="column" gap={0.5}>
            {(shown.length > 1 || every) && <Text variant="bodySmall">Query {refId}</Text>}
            {needs.trips && (
              <InlineFieldRow>
                <InlineField
                  label="Trip layer"
                  labelWidth={16}
                  tooltip="Table columns keeps one row per point, so speed, mode and every other column stay available for colour, filters and tooltips. GeoJSON folds each trip into a single row: far less data, but only the path survives."
                >
                  <RadioButtonGroup
                    size="sm"
                    options={TRIP_MODES}
                    value={own.tripLayerMode ?? inherited.tripLayerMode ?? 'table'}
                    onChange={(mode) => set(refId, 'tripLayerMode', mode)}
                  />
                </InlineField>
              </InlineFieldRow>
            )}
            {needs.places && (
              <InlineFieldRow>
                <InlineField
                  label="Place names"
                  labelWidth={16}
                  grow
                  tooltip="Where the query's place names and codes (its Place name column) are looked up. A URL of your own works too: Worldmap's list, or GeoJSON points with an id or name."
                >
                  <Combobox
                    options={GAZETTEER_OPTIONS}
                    value={own.gazetteer ?? null}
                    placeholder={`${gazetteerLabel(inherited.gazetteer ?? GAZETTEERS.countries)} (${
                      inherited.gazetteer ? 'every query' : 'default'
                    })`}
                    createCustomValue
                    isClearable
                    onChange={(option) => set(refId, 'gazetteer', option?.value || undefined)}
                  />
                </InlineField>
              </InlineFieldRow>
            )}
          </Stack>
        );
      })}
      {every && (
        <Stack direction="column" gap={0.5}>
          <Stack direction="row" alignItems="center" gap={1}>
            <Text variant="bodySmall">Every other query</Text>
            <IconButton
              name="trash-alt"
              size="sm"
              tooltip="Clear: the queries without their own take the defaults"
              onClick={() => {
                const { [EVERY_QUERY]: _cleared, ...rest } = value ?? {};
                onChange(Object.keys(rest).length ? rest : undefined);
              }}
            />
          </Stack>
          <Text variant="bodySmall" color="secondary">
            {[
              every.tripLayerMode
                ? `Trip layer: ${TRIP_MODES.find((m) => m.value === every.tripLayerMode)?.label}`
                : '',
              every.gazetteer ? `Place names: ${gazetteerLabel(every.gazetteer)}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
