import React from 'react';
import type { StandardEditorProps } from '@grafana/data';
import { Combobox, Stack, Text } from '@grafana/ui';
import type { KeplerPanelOptions } from '../types';

type Props = StandardEditorProps<string | undefined, unknown, KeplerPanelOptions>;

export function HoverLayerEditor({ value, onChange, context }: Props) {
  const visState = context.options?.mapConfig?.config.visState as
    | {
        layers?: Array<{ id: string; type: string; config?: { label?: string } }>;
      }
    | undefined;
  const choices = [
    { value: '', label: 'All visible Trip and Point layers' },
    ...(visState?.layers ?? [])
      .filter((layer) => layer.type === 'trip' || layer.type === 'point')
      .map((layer) => ({ value: layer.id, label: layer.config?.label || layer.id })),
  ];
  if (value && !choices.some((choice) => choice.value === value)) {
    choices.push({ value, label: `Unavailable layer (${value})` });
  }
  return (
    <Stack direction="column" gap={1}>
      <Combobox
        aria-label="Hover layer"
        value={value ?? ''}
        options={choices}
        onChange={(choice) => onChange(choice.value ?? '')}
      />
      <Text variant="bodySmall" color="secondary">
        Save current map configuration to select an individual layer. Point layers need mapped time and coordinates; map
        the trip ID to separate vehicles.
      </Text>
    </Stack>
  );
}
