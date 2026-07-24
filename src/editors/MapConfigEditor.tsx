import React, { useState } from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Button, Stack, TextArea, Text } from '@grafana/ui';

import { parseMapConfigJson, SavedMapConfig } from '../data/mapConfig';
import { KeplerPanelOptions } from '../types';

type Props = StandardEditorProps<SavedMapConfig | null | undefined, unknown, KeplerPanelOptions>;

/**
 * Import or clear the saved map configuration.
 *
 * kepler's own "Export map", Foursquare Studio and Dekart all emit the same
 * `KeplerGlSchema` JSON, so a map styled anywhere in that ecosystem can be
 * pasted straight in here.
 */
export function MapConfigEditor({ value, onChange }: Props) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const parsed = parseMapConfigJson(draft);
    if (!parsed) {
      setError('Not a kepler.gl configuration. Expected {version, config} or a full exported map.');
      return;
    }
    setError(null);
    setDraft('');
    onChange(parsed);
  };

  return (
    <Stack direction="column" gap={1}>
      <TextArea
        rows={4}
        value={draft}
        placeholder="Paste a kepler.gl config or exported map…"
        onChange={(e) => setDraft(e.currentTarget.value)}
        data-testid="map-config-input"
      />
      <Stack direction="row" gap={1}>
        <Button variant="secondary" size="sm" disabled={!draft.trim()} onClick={apply}>
          Import
        </Button>
        <Button variant="destructive" size="sm" fill="outline" disabled={!value} onClick={() => onChange(null)}>
          Clear
        </Button>
      </Stack>
      {error && (
        <Text variant="bodySmall" color="error">
          {error}
        </Text>
      )}
    </Stack>
  );
}
