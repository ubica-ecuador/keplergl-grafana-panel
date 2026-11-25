import React, { useState } from 'react';
import { css } from '@emotion/css';
import { Alert, Icon, useTheme2 } from '@grafana/ui';

import { type MapNotice, MAX_NOTICE_LENGTH } from './mapNotices';
import { SAVE_BUTTON_CLEARANCE_PX, saveButtonPlacement } from './SaveMapConfigButton';
import { usePanelEditing } from './usePanelEditing';

/** kepler's control column along the right edge, as the save button measures it. */
const CONTROLS_PX = 56;
/** A notice narrower than this reads as a column of single words: it covers the side panel instead. */
const MIN_STRIP_PX = 280;
const EDGE_PX = 8;

/**
 * Where the notices go: the strip along the top of the map that kepler leaves
 * empty, between its side panel (open or closed, measured by its toggle as the
 * save button is) and its control column on the right. On a map too narrow for
 * that strip they take the whole width, over the side panel: they are
 * dismissible, and a notice nobody can read is no notice.
 */
export function noticePlacement({ width, sidePanelOpen }: { width: number; sidePanelOpen: boolean }): {
  left: number;
  right: number;
} {
  const left = saveButtonPlacement({ width, sidePanelOpen }).left;
  return width - left - CONTROLS_PX < MIN_STRIP_PX ? { left: EDGE_PX, right: EDGE_PX } : { left, right: CONTROLS_PX };
}

/**
 * The strip lets the map's own pointer events through, and only the notices in
 * it take them; each is as wide as the strip, up to a width that reads.
 */
const stackItems = css({
  '& > *': { pointerEvents: 'auto', width: '100%', maxWidth: 480 },
});

/**
 * The notices over the map, stacked and centred in the strip `noticePlacement`
 * gives: this panel's, and the raster server's and Geomap's. Below the save
 * button while the panel is open in the editor.
 */
export function NoticeStack({
  width,
  sidePanelOpen,
  panelId,
  children,
}: {
  width: number;
  sidePanelOpen: boolean;
  panelId?: number;
  children?: React.ReactNode;
}) {
  const theme = useTheme2();
  const editing = usePanelEditing(panelId);
  const { left, right } = noticePlacement({ width, sidePanelOpen });
  return (
    <div
      className={stackItems}
      style={{
        position: 'absolute',
        top: editing ? SAVE_BUTTON_CLEARANCE_PX : EDGE_PX,
        left,
        right,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: theme.spacing(0.5),
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The queries' errors and warnings and the layers the panel cannot draw
 * (`mapNotices.ts`), in one compact box: the one notice as its title, or a
 * count and a list that scrolls past a few lines.
 *
 * Dismissed by its close button, notice by notice: what was shown stays away
 * across refreshes, a new notice shows on its own, and one that goes away and
 * comes back — a query that fails again — shows again.
 */
export function MapNotices({ notices }: { notices: MapNotice[] }) {
  const theme = useTheme2();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  // Forget what is no longer said, so it shows again if it comes back. During
  // render, when the notices change, as React has state follow a prop.
  const [said, setSaid] = useState(notices);
  if (said !== notices) {
    setSaid(notices);
    const kept = [...dismissed].filter((text) => notices.some((notice) => notice.text === text));
    if (kept.length !== dismissed.size) {
      setDismissed(new Set(kept));
    }
  }

  const shown = notices.filter((notice) => !dismissed.has(notice.text));
  if (shown.length === 0) {
    return null;
  }
  const severity = shown.some((notice) => notice.severity === 'error') ? 'error' : 'warning';
  const dismiss = () => setDismissed(new Set([...dismissed, ...shown.map((notice) => notice.text)]));

  if (shown.length === 1) {
    return (
      <Alert title={cut(shown[0].text)} severity={severity} bottomSpacing={0} onRemove={dismiss}>
        {null}
      </Alert>
    );
  }
  return (
    <Alert title={`${shown.length} notes on this map`} severity={severity} bottomSpacing={0} onRemove={dismiss}>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: theme.spacing(16.5), overflowY: 'auto' }}>
        {shown.map((notice) => (
          <li
            key={notice.text}
            title={notice.text}
            style={{ display: 'flex', gap: theme.spacing(0.75), alignItems: 'baseline' }}
          >
            <Icon
              name={notice.severity === 'error' ? 'exclamation-circle' : 'exclamation-triangle'}
              size="sm"
              style={{
                flex: 'none',
                color: notice.severity === 'error' ? theme.colors.error.text : theme.colors.warning.text,
              }}
            />
            <span>{cut(notice.text)}</span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function cut(text: string): string {
  return text.length > MAX_NOTICE_LENGTH ? `${text.slice(0, MAX_NOTICE_LENGTH - 1)}…` : text;
}
