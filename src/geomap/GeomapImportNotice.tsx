import React, { useState } from 'react';
import { Alert } from '@grafana/ui';

/**
 * Says what a Geomap panel had that the conversion could not carry over.
 *
 * Shown once, right after "Change visualization", to the person who switched:
 * the notes live in the panel's state, not in its options, so nobody who opens
 * the dashboard later sees them. Nothing is shown when everything came across.
 */
export function GeomapImportNotice({ dropped, top = 8 }: { dropped: string[] | null; top?: number }) {
  const [dismissed, setDismissed] = useState(false);
  if (!dropped?.length || dismissed) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(520px, calc(100% - 16px))',
        zIndex: 100,
      }}
    >
      <Alert title="Converted from Geomap" severity="info" bottomSpacing={0} onRemove={() => setDismissed(true)}>
        Not carried over: {dropped.join('; ')}.
      </Alert>
    </div>
  );
}
