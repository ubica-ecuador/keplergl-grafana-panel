import {
  getLinksSupplier,
  locationUtil,
  type DataFrame,
  type Field,
  type InterpolateFunction,
  type LinkModel,
} from '@grafana/data';

import { datasetId } from '../data/framesToDatasets';

/**
 * Grafana's data links, on the entity clicked on the map.
 *
 * A data link is configured on the query's fields (Field → Data links), the
 * way it is on a table or a time series, and its URL is a template over the
 * row: `${__data.fields.id}`, `${__value.raw}`, the dashboard's variables and
 * time range. Grafana fills it with `getLinksSupplier`, the function its own
 * panels use, and this module hands it the row the user clicked.
 *
 * The row is rebuilt from kepler's values rather than found in the frame by
 * index. kepler's row order is not the query's in general: a trip layer groups
 * the query's rows into one trajectory per id, and the row a click resolves is
 * the trajectory's. A one-row frame with the clicked values, and each field's
 * config, display and scoped variables carried over, is what Grafana's
 * templates read either way.
 *
 * Free of kepler and React; the store and the popup are the callers' business.
 */

/** The query a kepler dataset was built from. */
export function frameOfDataset(frames: readonly DataFrame[], dataId: string): DataFrame | undefined {
  return frames.find((frame, index) => datasetId(frame.refId ?? `${index}`) === dataId);
}

/** Whether any field of these frames carries a data link at all: the cheap test before resolving one. */
export function framesHaveLinks(frames: readonly DataFrame[]): boolean {
  return frames.some((frame) => frame.fields.some((field) => Boolean(field.config?.links?.length)));
}

/**
 * The links of the clicked entity, interpolated, one per distinct title and
 * URL.
 *
 * `values` is keyed the way kepler names the columns; `renames` (query name →
 * kepler name) translates the ones a field role renamed, so `${__data.fields.lat}`
 * finds the `lat` kepler reads as `latitude`.
 *
 * A link on the field defaults sits on every field, and Grafana's own tooltip
 * shows it once: so does this. A template Grafana cannot fill throws; that link
 * is left out rather than taking the popup down with it.
 */
export function entityLinks({
  frame,
  values,
  renames,
  replaceVariables,
  timeZone,
}: {
  frame: DataFrame;
  values: Record<string, unknown>;
  renames?: Record<string, string>;
  replaceVariables: InterpolateFunction;
  /** The dashboard's time zone (Grafana's TimeZone is a string). */
  timeZone?: string;
}): LinkModel[] {
  if (!frame.fields.some((field) => field.config?.links?.length)) {
    return [];
  }

  const valueOf = (field: Field) => {
    const value = values[renames?.[field.name] ?? field.name] ?? values[field.name];
    return value === undefined ? null : value;
  };
  const row: DataFrame = {
    ...frame,
    length: 1,
    fields: frame.fields.map((field) => ({ ...field, values: [valueOf(field)] })),
  };

  const seen = new Set<string>();
  const links: LinkModel[] = [];
  for (const field of row.fields) {
    if (!field.config?.links?.length) {
      continue;
    }
    // Grafana's field override pass leaves a `__dataContext` on every field
    // that points at the query's whole frame, and the supplier clones it when
    // it is there: row 0 would then be the query's first row, not the one
    // clicked. The context is this one-row frame's, as the pass would have set it.
    const scopedVars = {
      ...field.state?.scopedVars,
      __dataContext: { value: { data: [row], frame: row, field, frameIndex: 0 } },
    };
    let supplied: LinkModel[];
    try {
      supplied = getLinksSupplier(
        row,
        field,
        scopedVars,
        replaceVariables,
        timeZone
      )({
        valueRowIndex: 0,
      });
    } catch (error) {
      console.warn('[kepler] a data link could not be filled for the clicked entity', error);
      continue;
    }
    for (const link of supplied) {
      const key = `${link.title}\u0000${link.href}`;
      if (!link.href && !link.onClick) {
        continue;
      }
      if (!seen.has(key)) {
        seen.add(key);
        links.push(link);
      }
    }
  }
  return links;
}

/** The link a click follows at once, if one is marked "one click". Grafana allows one per field. */
export function oneClickLink(links: readonly LinkModel[]): LinkModel | undefined {
  return links.find((link) => link.oneClick);
}

/**
 * Whether a click on the entity selects something: publishes a click mapping
 * or places the search square.
 *
 * A one-click link and a selection are two answers to the same click. The rule
 * agreed for the map: when the click selects, it selects and the link waits in
 * the popup; it navigates at once only when it would select nothing.
 */
export function clickSelects({
  clickArea,
  mappedValues,
}: {
  /** The click places the search square. */
  clickArea: boolean;
  /** What the click mappings resolve on the entity: `readClickedEntity` over their columns. */
  mappedValues: Record<string, unknown> | null | undefined;
}): boolean {
  return clickArea || Boolean(mappedValues && Object.keys(mappedValues).length);
}

/** How a link is followed: which of the three ways Grafana's own buttons use. */
export type LinkNavigation =
  { kind: 'callback' } | { kind: 'inApp'; path: string } | { kind: 'window'; href: string; target: string };

/**
 * The way to follow `link` from a plain left click.
 *
 * A link with its own `onClick` (an internal link to Explore) is run, not
 * followed. A link into this Grafana that opens in the same tab moves the app's
 * router, as an anchor in Grafana does, so the dashboard's state survives and
 * the page does not reload. Anything else opens like a link.
 */
export function linkNavigation(link: LinkModel, origin: string): LinkNavigation {
  if (link.onClick) {
    return { kind: 'callback' };
  }
  const target = link.target || '_self';
  if (target === '_self') {
    let url: URL | null = null;
    try {
      url = new URL(link.href, origin);
    } catch {
      url = null;
    }
    if (url && url.origin === origin) {
      return { kind: 'inApp', path: locationUtil.stripBaseFromUrl(`${url.pathname}${url.search}${url.hash}`) };
    }
  }
  return { kind: 'window', href: link.href, target };
}
