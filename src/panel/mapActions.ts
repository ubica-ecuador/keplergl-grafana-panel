import { locationUtil, textUtil, type Action, type DataFrame, type InterpolateFunction } from '@grafana/data';

import { clickedRowFrame, rowScopedVars } from './dataLinks';

/**
 * Grafana's Actions, on the entity clicked on the map.
 *
 * An Action is configured beside the data links (Field → Data links and
 * actions): a button that sends an HTTP request built from the row — dispatch a
 * unit to `${__data.fields.address}`, close report `${__data.fields.id}`. This
 * module builds what Grafana's own panels build, from the same one-row frame
 * the links use, and leaves sending it to the caller.
 *
 * It follows Grafana's core implementation (`getActions` in
 * public/app/features/actions/utils.ts) step for step, since a dashboard author
 * expects the map to do what the table does with the same configuration:
 *
 * - the title, URL, body, headers and query parameters are templates over the
 *   row and the dashboard's variables;
 * - an action may declare variables the viewer fills in before it runs; each
 *   `$key` of a declared variable is replaced by the viewer's value first;
 * - the confirmation defaults to "Are you sure you want to <title>?";
 * - a GET sends no body, any other method the body or `{}`;
 * - the request carries `X-Grafana-Action: 1`, the header Grafana's backend
 *   reads to apply `[security] actions_allow_post_url` to requests aimed at
 *   Grafana itself.
 *
 * Only `fetch` actions, sent from the viewer's browser. Grafana 12.2+ also has
 * actions proxied through the Infinity data source (credentials kept on the
 * server); their request format is not public API, so they are left out here.
 */

/** A variable an action asks the viewer for before it runs. */
export interface ActionVariableLike {
  key: string;
  name?: string;
  type?: string;
}

/** An action as configured: the SDK's type, plus the variables newer Grafana adds. */
export type ActionConfig = Action & { variables?: ActionVariableLike[] };

/** What the map sends: the arguments of `getBackendSrv().fetch`. */
export interface ActionRequest {
  url: string;
  method: string;
  data?: string;
  headers: Record<string, string>;
}

/** An action of the clicked entity, ready to confirm and send. */
export interface MapAction {
  title: string;
  oneClick: boolean;
  /** The values the viewer is asked for first; empty for most actions. */
  variables: ActionVariableLike[];
  /** The text the confirmation dialog shows, with the viewer's values in it. */
  confirmation: (values?: Record<string, string>) => string;
  /** The request, with the viewer's values in it. */
  request: (values?: Record<string, string>) => ActionRequest;
}

const FETCH = 'fetch';

/** Whether any field of these frames carries an action. */
export function framesHaveActions(frames: readonly DataFrame[]): boolean {
  return frames.some((frame) => frame.fields.some((field) => Boolean(fieldActions(field.config).length)));
}

function fieldActions(config: { actions?: Action[] } | undefined): ActionConfig[] {
  return (config?.actions ?? []) as ActionConfig[];
}

/**
 * `$key` → the viewer's value, for the variables the action declares; any other
 * `$word` is left for the dashboard's interpolation.
 */
export function withActionVariables(
  text: string,
  variables: readonly ActionVariableLike[] | undefined,
  values: Record<string, string> | undefined
): string {
  if (!variables?.length || !values) {
    return text;
  }
  return text.replace(/\$\w+/g, (match) => {
    const key = match.slice(1);
    return variables.some((v) => v.key === key) && values[key] != null ? values[key] : match;
  });
}

/**
 * The absolute URL of an action: a path on this Grafana is sanitised and given
 * the app's sub-path, as Grafana does, then resolved against the page's origin.
 */
export function actionUrl(url: string, origin: string): URL {
  const target = url.startsWith('/') ? locationUtil.assureBaseUrl(textUtil.sanitizeUrl(url)) : url;
  return new URL(target, origin);
}

/** The request one fetch action makes, its templates filled by `fill`. */
export function buildActionRequest(
  action: ActionConfig,
  fill: (text: string) => string,
  origin: string
): ActionRequest {
  const options = action[FETCH as Action['type']];
  if (!options) {
    throw new Error('Action does not have the correct configuration');
  }
  const url = actionUrl(fill(options.url), origin);
  const headers: Record<string, string> = {};
  for (const [name, value] of options.headers ?? []) {
    headers[fill(name)] = fill(value);
  }
  for (const [name, value] of options.queryParams ?? []) {
    url.searchParams.append(fill(name), fill(value));
  }
  headers['X-Grafana-Action'] = '1';
  const method = String(options.method);
  return {
    url: url.toString(),
    method,
    data: method === 'GET' ? undefined : options.body ? fill(options.body) : '{}',
    headers,
  };
}

/**
 * The actions of the clicked entity, one per distinct title and URL, as
 * `entityLinks` does for links. An action whose templates Grafana cannot fill is
 * left out rather than taking the popup down with it.
 */
export function entityActions({
  frame,
  values,
  renames,
  replaceVariables,
  origin,
}: {
  frame: DataFrame;
  values: Record<string, unknown>;
  renames?: Record<string, string>;
  replaceVariables: InterpolateFunction;
  /** The page's origin, against which a path on this Grafana is resolved. */
  origin: string;
}): MapAction[] {
  if (!frame.fields.some((field) => fieldActions(field.config).length)) {
    return [];
  }
  const row = clickedRowFrame(frame, values, renames);

  const seen = new Set<string>();
  const actions: MapAction[] = [];
  for (const field of row.fields) {
    const configured = fieldActions(field.config).filter((action) => action.type === FETCH);
    if (!configured.length) {
      continue;
    }
    const scopedVars = rowScopedVars(row, field);
    for (const action of configured) {
      const fillWith = (viewer?: Record<string, string>) => (text: string) =>
        replaceVariables(withActionVariables(text, action.variables, viewer), scopedVars);
      let title: string;
      try {
        title = replaceVariables(action.title ?? '', scopedVars);
        buildActionRequest(action, fillWith(), origin);
      } catch (error) {
        console.warn('[kepler] an action could not be built for the clicked entity', error);
        continue;
      }
      const key = `${title}\u0000${action[FETCH as Action['type']]?.url ?? ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      actions.push({
        title,
        oneClick: Boolean(action.oneClick),
        variables: action.variables ?? [],
        confirmation: (viewer) => fillWith(viewer)(action.confirmation || `Are you sure you want to ${action.title}?`),
        request: (viewer) => buildActionRequest(action, fillWith(viewer), origin),
      });
    }
  }
  return actions;
}
