import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';

/**
 * Grafana's own notice, the toast its panels show, for something the viewer
 * just did that did not work: the one use of the app event bus the plugin
 * catalog allows. The panel writes nothing to the console.
 */
function notify(type: string, title: string, detail?: string): void {
  try {
    getAppEvents().publish({ type, payload: detail ? [title, detail] : [title] });
  } catch {
    // Outside a running Grafana there is no one to tell.
  }
}

export const notifyError = (title: string, detail?: string) => notify(AppEvents.alertError.name, title, detail);
export const notifyWarning = (title: string, detail?: string) => notify(AppEvents.alertWarning.name, title, detail);
export const notifySuccess = (title: string) => notify(AppEvents.alertSuccess.name, title);
