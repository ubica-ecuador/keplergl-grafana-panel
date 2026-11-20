import React, { useState } from 'react';
import { Alert } from '@grafana/ui';

/**
 * Says what a Geomap panel had that the conversion could not carry over.
 *
 * Shown once, right after "Change visualization", to the person who switched:
 * the notes live in the panel's state, not in its options, so nobody who opens
 * the dashboard later sees them. Nothing is shown when everything came across.
 * Placed over the map with the panel's other notices (`NoticeStack`).
 */
export function GeomapImportNotice({ dropped }: { dropped: string[] | null }) {
  const [dismissed, setDismissed] = useState(false);
  if (!dropped?.length || dismissed) {
    return null;
  }

  return (
    <Alert title="Converted from Geomap" severity="info" bottomSpacing={0} onRemove={() => setDismissed(true)}>
      Not carried over: {dropped.join('; ')}.
    </Alert>
  );
}
