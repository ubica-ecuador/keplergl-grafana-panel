import React, { useState } from 'react';
import { Alert } from '@grafana/ui';

/**
 * Says which queries return imagery the panel cannot draw because no raster
 * tile server is set, and where to set one.
 *
 * The option is empty by default (see `DEFAULT_RASTER_SERVER_URL`), so this is
 * what a fresh install shows for a COG, a STAC item or a Zarr store instead of
 * sending the URL to a server nobody chose. Without it the map would simply
 * come up blank, which reads as a broken plugin or a broken query.
 *
 * Shown to everyone who opens the dashboard, since a viewer is as puzzled by a
 * blank map as an editor; the words are for whoever can change the panel.
 * Dismissable, so it never stands between a viewer and the rest of the map.
 */
export function RasterServerNotice({ queries }: { queries: string[] }) {
  const [dismissed, setDismissed] = useState(false);
  if (queries.length === 0 || dismissed) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(520px, calc(100% - 16px))',
        zIndex: 100,
      }}
    >
      <Alert
        title="No raster tile server is set"
        severity="warning"
        bottomSpacing={0}
        onRemove={() => setDismissed(true)}
      >
        {describe(queries)} imagery that a TiTiler-compatible server draws, and this panel has none, so it is not
        on the map. Set <strong>Raster tile server</strong> under <em>Map</em> in the panel options to a server you
        run. It is handed every raster URL, signature included; Development Seed&apos;s public demo,{' '}
        <code>https://titiler.xyz</code>, reads public imagery only.
      </Alert>
    </div>
  );
}

/** "Query A returns" / "Query A and Query B return" / "Query A, Query B and Query C return". */
function describe(queries: string[]): string {
  const names = queries.length === 1 ? queries[0] : `${queries.slice(0, -1).join(', ')} and ${queries[queries.length - 1]}`;
  return `${names} ${queries.length === 1 ? 'returns' : 'return'}`;
}
