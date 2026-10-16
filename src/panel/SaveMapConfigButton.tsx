import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@grafana/ui';

import { usePanelEditing } from './usePanelEditing';

/** How long the button says it saved before it offers to save again. */
export const SAVED_FEEDBACK_MS = 2000;

/**
 * Where kepler puts its side panel toggle, measured on kepler 3 as this plugin
 * themes it: 20 px square, 12 px from the top, its right edge at 332 px with
 * the side panel open and at 40 px with it closed.
 */
const TOGGLE_RIGHT_OPEN_PX = 332;
const TOGGLE_RIGHT_CLOSED_PX = 40;
const GAP_PX = 8;

/** Centres a small (24 px) button on the toggle. */
export const SAVE_BUTTON_TOP_PX = 10;
/** Below the button, for the overlays that would otherwise sit under it. */
export const SAVE_BUTTON_CLEARANCE_PX = SAVE_BUTTON_TOP_PX + 24 + GAP_PX;

/**
 * kepler's control column, along the right edge. One column for the whole map:
 * a split map, dual or swipe, keeps it there too.
 */
const CONTROLS_PX = 56;
/** The button with its words, with some room to spare. */
const WORDED_BUTTON_PX = 104;

/**
 * Where the button goes: just right of kepler's side panel toggle, open or
 * closed, on the strip along the top of the map that kepler leaves empty — its
 * control column holds the right edge, the time widget the bottom and the
 * attribution the bottom right. The raster notice, at the top centre, moves
 * down below it (`SAVE_BUTTON_CLEARANCE_PX`).
 *
 * Down to its icon when its words would run into the control column, which
 * with the side panel open happens below 500 px.
 */
export function saveButtonPlacement({ width, sidePanelOpen }: { width: number; sidePanelOpen: boolean }): {
  left: number;
  compact: boolean;
} {
  const left = (sidePanelOpen ? TOGGLE_RIGHT_OPEN_PX : TOGGLE_RIGHT_CLOSED_PX) + GAP_PX;
  return { left, compact: left + WORDED_BUTTON_PX > width - CONTROLS_PX };
}

export interface SaveMapConfigButtonProps {
  /** Grafana's id for this panel: only the panel being edited shows the button. */
  panelId?: number;
  width: number;
  sidePanelOpen: boolean;
  /** The save itself; true when something was captured. */
  onSave: () => boolean;
}

/**
 * **Save current map configuration** on the map itself, for whoever is
 * shaping it in the panel editor and would otherwise scroll the options to
 * their last section after every change.
 *
 * Only while this panel is open in the panel editor, which is where a save can
 * be kept: never on the dashboard, in kiosk mode, in a solo panel or on a public
 * dashboard (see `usePanelEditing`). Like the options button, it writes the
 * panel's options, and the dashboard still has to be saved.
 */
export function SaveMapConfigButton({ panelId, width, sidePanelOpen, onSave }: SaveMapConfigButtonProps) {
  const editing = usePanelEditing(panelId);
  const [saved, setSaved] = useState(false);
  const feedback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(feedback.current), []);

  if (!editing) {
    return null;
  }

  const save = () => {
    if (!onSave()) {
      return;
    }
    setSaved(true);
    clearTimeout(feedback.current);
    feedback.current = setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);
  };

  const { left, compact } = saveButtonPlacement({ width, sidePanelOpen });

  return (
    // Over kepler's control column (10) and time widget (1), under its side
    // panel (99), whose own menus open over this strip, and its dialogs.
    <div style={{ position: 'absolute', top: SAVE_BUTTON_TOP_PX, left, zIndex: 11 }}>
      <Button
        size="sm"
        variant={saved ? 'success' : 'primary'}
        icon={saved ? 'check' : 'save'}
        aria-label={saved ? 'Map configuration saved' : 'Save map configuration'}
        tooltip="Stores the current layers, filters and base map with the dashboard. Save the dashboard to keep them."
        tooltipPlacement="bottom"
        onClick={save}
        data-testid="save-map-config-on-map"
      >
        {compact ? undefined : saved ? 'Saved' : 'Save map'}
      </Button>
    </div>
  );
}
