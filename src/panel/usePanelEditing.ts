import { useEffect, useState } from 'react';
import { locationService } from '@grafana/runtime';

/**
 * Pages that show a panel to look at and never to edit: a solo panel (what an
 * iframe embed and the image renderer load), a public dashboard and a snapshot.
 * None of them carries `editPanel`; this is the guarantee for a URL someone
 * typed by hand. Matched on the path below Grafana's sub-path, which is where
 * `locationService` reports it.
 */
const VIEW_ONLY_PATH = /^\/(d-solo|dashboard-solo|public-dashboards|dashboard\/snapshot)\//;

/** `3`, or the `panel-3` form of a scene key. */
const PANEL_ID = /^(?:panel-)?(\d+)$/;

/**
 * Whether the panel with this id is the one open in Grafana's panel editor.
 *
 * The editor puts the edited panel's id in the URL as `editPanel`, in the
 * dashboards Grafana 12 and 13 draw with Scenes (`DashboardSceneUrlSync` writes
 * `PanelEditor.getUrlKey()`, the panel's id) as in the older ones. The id the
 * panel receives in its props is the same number (`VizPanel.getLegacyPanelId()`,
 * from the same `panel-<id>` key), so only the edited panel answers yes.
 *
 * No other signal says it: a panel plugin's props carry no editing flag, and
 * the panel context Scenes hands down reports `CoreApp.Unknown` everywhere.
 *
 * Kiosk mode is never editing, whatever else the URL says. A panel with no id
 * is taken to be the edited one when any panel is.
 */
export function isPanelBeingEdited(pathname: string, search: URLSearchParams, panelId?: number): boolean {
  const edited = search.get('editPanel');
  if (!edited || search.has('kiosk') || VIEW_ONLY_PATH.test(pathname)) {
    return false;
  }
  if (panelId === undefined || !Number.isFinite(panelId)) {
    return true;
  }
  const match = PANEL_ID.exec(edited);
  return match !== null && Number(match[1]) === panelId;
}

function readEditing(panelId?: number): boolean {
  return isPanelBeingEdited(locationService.getLocation().pathname, locationService.getSearch(), panelId);
}

/**
 * True while this panel is open in Grafana's panel editor, kept in step with
 * the URL: opening the editor, going back to the dashboard and switching to
 * another panel all move it, and the panel component is not always remounted
 * when they do.
 */
export function usePanelEditing(panelId?: number): boolean {
  const [editing, setEditing] = useState(() => readEditing(panelId));

  useEffect(() => {
    const update = () => setEditing(readEditing(panelId));
    update();
    return locationService.getHistory().listen(update);
  }, [panelId]);

  return editing;
}
