import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { ComboboxOption, MultiCombobox, Stack, Text } from '@grafana/ui';

import { detectFields } from '../data/detectFields';
import { KeplerPanelOptions } from '../types';

type Props = StandardEditorProps<string[] | undefined, unknown, KeplerPanelOptions>;

/**
 * Picks the queries drawn as a route: each row joined to the next, in the order
 * the query returns them (`buildRoute.ts`).
 *
 * Offers the queries that have coordinates, and keeps any already chosen that
 * is not answering right now, so an empty result does not silently drop it.
 */
export function RouteQueriesEditor({ value, onChange, context }: Props) {
  const frames = context.data ?? [];
  const chosen = value ?? [];
  const withCoordinates = frames
    .map((frame, index) => ({ frame, refId: frame.refId ?? `${index}` }))
    .filter(({ frame }) => {
      const roles = detectFields(frame);
      const overrides = context.options?.fieldMappings?.[frame.refId ?? ''];
      return Boolean((overrides?.latitude ?? roles.latitude) && (overrides?.longitude ?? roles.longitude));
    });
  const options: Array<ComboboxOption<string>> = [
    ...withCoordinates.map(({ frame, refId }) => ({
      value: refId,
      label: frame.name && frame.name !== refId ? `${refId} · ${frame.name}` : `Query ${refId}`,
    })),
    ...chosen
      .filter((refId) => !withCoordinates.some((q) => q.refId === refId))
      .map((refId) => ({ value: refId, label: `Query ${refId}` })),
  ];

  return (
    <Stack direction="column" gap={1}>
      <Text variant="bodySmall" color="secondary">
        Joins each row to the next, in the order the query returns them: order the query by time. The route is a dataset
        of its own, “… · route”, drawn as a Line layer that can be coloured and sized by any column. A map with a saved
        configuration gets no new layer by itself: add a Line layer on that dataset in the side panel.
      </Text>
      <MultiCombobox
        options={options}
        value={chosen}
        placeholder="queries"
        width={30}
        // An empty list is stored as an absence, so an untouched dashboard JSON stays byte-identical.
        onChange={(picked) => {
          const refIds = picked.map((o) => o.value).filter(Boolean);
          onChange(refIds.length ? refIds : undefined);
        }}
      />
    </Stack>
  );
}
