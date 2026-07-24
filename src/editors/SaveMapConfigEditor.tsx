import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Button, Stack, Text } from '@grafana/ui';

import { KeplerPanelOptions } from '../types';

type Props = StandardEditorProps<number | undefined, unknown, KeplerPanelOptions>;

/**
 * Asks the panel to snapshot the current map configuration.
 *
 * Saving is explicit rather than automatic: the config is a sizeable JSON blob
 * that lands in the dashboard definition, and writing it on every pan and zoom
 * would churn the dashboard for no benefit.
 */
export function SaveMapConfigEditor({ value, onChange, context }: Props) {
  const saved = context.options?.mapConfig;
  const layerCount = countLayers(saved);

  return (
    <Stack direction="column" gap={1}>
      <Button
        variant="secondary"
        size="sm"
        icon="save"
        onClick={() => onChange((value ?? 0) + 1)}
        data-testid="save-map-config"
      >
        Save current map configuration
      </Button>
      <Text variant="bodySmall" color="secondary">
        {saved
          ? `Saved: ${layerCount} ${layerCount === 1 ? 'layer' : 'layers'}. Applied when the panel loads.`
          : 'Nothing saved yet — the map resets to its defaults on reload.'}
      </Text>
    </Stack>
  );
}

function countLayers(saved: KeplerPanelOptions['mapConfig']): number {
  const visState = saved?.config?.visState as { layers?: unknown[] } | undefined;
  return visState?.layers?.length ?? 0;
}
