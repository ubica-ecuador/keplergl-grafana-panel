import {
  filterClause,
  filterKey,
  foreignValues,
  intervalScale,
  keplerFilterValue,
  viewportExtent,
  type ClauseLike,
  type FilterClause,
  type LinkableFilter,
} from './mosaicLink';
import { areaFingerprints, decideAreaPublish } from './areaSync';
import type { DrawnArea } from './keplerAdapter';
import type { ViewportBounds } from './viewportSync';

/**
 * What the link uses of Mosaic: the Chaski app's runtime, which the Mosaic
 * panel's module hands out so that every panel shares one copy. The map
 * bundles none of it.
 */
export interface MosaicRuntimeLike {
  sharedSelection(name: string, signal: AbortSignal): Promise<SelectionLike>;
  clauseInterval(field: string, value: unknown, options: object): ClauseLike;
  clauseIntervals(fields: string[], value: unknown, options: object): ClauseLike;
  clausePoints(fields: string[], value: unknown, options: object): ClauseLike;
  clauseColumns(clause: ClauseLike): string[];
  /** A drawn polygon as a clause on longitude and latitude; missing from a Chaski app before it. */
  clauseArea?(fields: [string, string], wkt: string | null, options: object): ClauseLike;
}

/** What the link uses of a Mosaic Selection. */
export interface SelectionLike {
  readonly clauses: readonly ClauseLike[];
  readonly active?: ClauseLike;
  update(clause: ClauseLike): unknown;
  activate(clause: ClauseLike): void;
  reset(clauses?: ClauseLike[]): unknown;
  addEventListener(type: 'value', listener: () => void): void;
  removeEventListener(type: 'value', listener: () => void): void;
}

/** What the link uses of the map; `useMosaicSelection` backs it with kepler's store. */
export interface MapLike {
  filters(): LinkableFilter[];
  /** Columns whose filters kepler parked while new rows land: they are coming back. */
  parked(): Set<string>;
  /** kepler's type of a column, or undefined when no dataset on the map has it. */
  fieldType(field: string): string | undefined;
  hasFilter(field: string): boolean;
  /** Sets the column's filter, making one if needed; false when it could not land yet. */
  apply(field: string, value: unknown): boolean;
  /** Widens the column's filter to filter nothing. */
  open(field: string): void;
  remove(field: string): void;
  viewport(): ViewportBounds | null;
  /** The figures drawn on the map, in kepler's order: the latest last. */
  areas(): DrawnArea[];
  /**
   * The rows the map holds, one entry per dataset; an entry changes only when its dataset's rows are
   * replaced, as an answer to the map's query does, not when a filter moves.
   */
  rows(): readonly unknown[];
}

export interface LinkOptions {
  /** False when the time filter belongs to the dashboard time range, which the link must not move. */
  linkTime: boolean;
  /** The longitude and latitude columns of the Selection's data, or null to send neither view nor area. */
  columns: [string, string] | null;
  /** The view filters the Selection as a bbox. */
  viewport: boolean;
  /** The latest drawn figure filters the Selection. */
  area: boolean;
}

interface Source {
  field: string;
  reset(): void;
}

/** One kepler filter type the link never carries when `linkTime` is off. */
const TIME_FILTER_TYPE = 'timeRange';

/** The view's clause type: Mosaic pre-aggregates intervals and points, and leaves other types to plain queries. */
export const VIEWPORT_CLAUSE_TYPE = 'viewport';

/**
 * The map as a participant of one Mosaic Selection.
 *
 * Each column the map filters is a clause source of its own, so one filter
 * moving replaces only its clause, as a brush does in Mosaic. `push` sends
 * what the filters say, `pull` lands what the others' clauses say; the hook
 * calls them on a store change and on the Selection's `value` event.
 *
 * Echoes are cut by keys: what `pull` put on a filter is remembered as kepler
 * shows it, and a filter showing exactly that is not the map's to send. A
 * filter moved off it is: the column becomes the map's, and the other
 * panel's clause on it goes, so one column never holds two windows.
 */
export class MosaicSelectionLink {
  private readonly sources = new Map<string, Source>();
  private readonly viewportSource = {
    reset: () => {
      this.viewportSent = '';
    },
  };
  /** By column, the key of the clause the map holds in the Selection. */
  private readonly sent = new Map<string, string>();
  /** By column, the other panel's value `pull` put on the map, and whether `pull` made the filter for it. */
  private readonly applied = new Map<string, { foreign: string; key: string; created: boolean }>();
  private viewportSent = '';
  private readonly areaSource = {
    reset: () => {
      this.areaSent = null;
    },
  };
  /** Each drawn figure as last seen, by id; the figure whose polygon the Selection holds. */
  private areasSeen: Record<string, string> = {};
  private areaSent: string | null = null;
  /** A foreign value could not land (its filter parked, its rows not in): `push` tries again. */
  private retry = false;
  /**
   * Columns whose filter kepler rebuilt with new rows: it comes back from its saved form, not on the
   * window the others' clause put on it, and that is not the map moving. `pull` lands the clause again.
   */
  private readonly reland = new Set<string>();
  private rowsSeen: readonly unknown[];
  /** While the link takes its own clauses out, their reset is not a clearing to show on the map. */
  private releasing = false;

  constructor(
    private readonly runtime: MosaicRuntimeLike,
    private readonly selection: SelectionLike,
    private readonly map: MapLike,
    private readonly options: LinkOptions
  ) {
    this.rowsSeen = map.rows();
  }

  readonly isOwn = (source: unknown): boolean =>
    source === this.viewportSource ||
    source === this.areaSource ||
    [...this.sources.values()].includes(source as Source);

  /** From the map to the Selection. */
  push(): void {
    const rows = this.map.rows();
    if (rows.length !== this.rowsSeen.length || rows.some((r, i) => r !== this.rowsSeen[i])) {
      this.rowsSeen = rows;
      for (const field of this.applied.keys()) {
        this.reland.add(field);
      }
    }
    if (this.retry || this.reland.size > 0) {
      this.pull();
    }
    const parked = this.map.parked();
    const seen = new Set<string>();
    for (const filter of this.map.filters()) {
      if (!this.options.linkTime && filter.type === TIME_FILTER_TYPE) {
        continue;
      }
      const clause = filterClause(filter);
      if (!clause) {
        continue;
      }
      seen.add(filter.field);
      const key = filterKey(clause);
      const applied = this.applied.get(filter.field);
      if (this.reland.has(filter.field)) {
        // Rebuilt from its saved form with the new rows, waiting for `pull` to land the clause again.
        continue;
      }
      if (applied) {
        if (applied.key === key) {
          continue;
        }
        this.applied.delete(filter.field);
      }
      if ((this.sent.get(filter.field) ?? 'open') !== key) {
        this.send(clause, key);
      }
    }
    // A filter taken off the map takes its clause with it; a parked one is coming back.
    for (const field of [...this.sent.keys()]) {
      if (!seen.has(field) && !parked.has(field)) {
        this.withdraw(field);
      }
    }
    this.pushViewport();
    this.pushArea();
  }

  /** From the Selection to the map. */
  pull(): void {
    this.retry = false;
    const foreign = foreignValues(this.selection.clauses, (c) => this.runtime.clauseColumns(c), this.isOwn);
    const parked = this.map.parked();
    for (const value of foreign.values()) {
      const fieldType = this.map.fieldType(value.field);
      if (fieldType === undefined || (!this.options.linkTime && fieldType === 'timestamp')) {
        this.reland.delete(value.field);
        continue;
      }
      const before = this.applied.get(value.field);
      if (before?.foreign === value.key && !this.reland.has(value.field)) {
        continue;
      }
      if (parked.has(value.field)) {
        this.retry = true;
        continue;
      }
      // Clauses keep the order they were last moved in, and `push` clears the others' on a column before
      // sending its own: a foreign clause beside the map's is the newer, and the map's goes.
      if (this.sent.has(value.field)) {
        this.withdraw(value.field);
      }
      const created = before?.created ?? !this.map.hasFilter(value.field);
      if (!this.map.apply(value.field, keplerFilterValue(value, fieldType))) {
        this.retry = true;
        continue;
      }
      // Remembered as kepler shows it, which may be clamped to the data's extent.
      const shown = this.map.filters().find((f) => f.field === value.field);
      const clause = shown && filterClause(shown);
      this.applied.set(value.field, { foreign: value.key, key: clause ? filterKey(clause) : value.key, created });
      this.reland.delete(value.field);
    }
    for (const [field, entry] of [...this.applied]) {
      if (foreign.has(field)) {
        continue;
      }
      this.applied.delete(field);
      this.reland.delete(field);
      if (entry.created) {
        this.map.remove(field);
      } else {
        this.map.open(field);
      }
    }
  }

  /** Takes the map's clauses out of the Selection, as the panel goes away. */
  release(): void {
    this.releasing = true;
    try {
      for (const field of [...this.sent.keys()]) {
        this.withdraw(field);
      }
      const columns = this.options.columns;
      if (this.viewportSent && columns) {
        this.selection.update(this.runtime.clauseIntervals(columns, null, { source: this.viewportSource }));
        this.viewportSent = '';
      }
      if (this.areaSent !== null && columns && this.runtime.clauseArea) {
        this.selection.update(this.runtime.clauseArea(columns, null, { source: this.areaSource }));
        this.areaSent = null;
      }
    } finally {
      this.releasing = false;
    }
  }

  private sourceFor(field: string): Source {
    let source = this.sources.get(field);
    if (!source) {
      // Another panel's "clear all" resets every clause: the map's filter on the column opens to match.
      source = {
        field,
        reset: () => {
          if (this.releasing || !this.sent.has(field)) {
            return;
          }
          this.sent.delete(field);
          queueMicrotask(() => this.map.open(field));
        },
      };
      this.sources.set(field, source);
    }
    return source;
  }

  private send(clause: FilterClause, key: string): void {
    const source = this.sourceFor(clause.field);
    if (clause.kind === 'open') {
      this.withdraw(clause.field);
      return;
    }
    const others = this.selection.clauses.filter((c) => {
      if (this.isOwn(c.source) || c.value == null) {
        return false;
      }
      const columns = this.runtime.clauseColumns(c);
      return columns.length === 1 && columns[0] === clause.field;
    });
    if (others.length > 0) {
      this.selection.reset(others);
    }
    const made =
      clause.kind === 'interval'
        ? this.runtime.clauseInterval(
            clause.field,
            clause.time ? clause.value.map((ms) => new Date(ms)) : clause.value,
            { source, scale: intervalScale(clause), pixelSize: 1 }
          )
        : this.runtime.clausePoints(
            [clause.field],
            clause.values.map((v) => [v]),
            { source }
          );
    // Mosaic plans its pre-aggregates on activation, as a brush announces itself when the pointer enters it.
    if (this.selection.active?.source !== source) {
      this.selection.activate(made);
    }
    this.selection.update(made);
    this.sent.set(clause.field, key);
  }

  /** A clause with no value takes the source's clause out of the Selection, with no reset of it. */
  private withdraw(field: string): void {
    this.selection.update(this.runtime.clauseInterval(field, null, { source: this.sourceFor(field) }));
    this.sent.delete(field);
  }

  private pushViewport(): void {
    const columns = this.options.columns;
    if (!columns || !this.options.viewport) {
      return;
    }
    const extent = viewportExtent(this.map.viewport());
    const key = JSON.stringify(extent);
    if (!extent || key === this.viewportSent) {
      return;
    }
    this.viewportSent = key;
    // Not an interval to Mosaic: an interval with no pixel scales makes its pre-aggregator fail, and a view
    // changes its scale with every zoom, so there is nothing to pre-aggregate on. The others query it plainly.
    const clause = this.runtime.clauseIntervals(columns, extent, { source: this.viewportSource });
    this.selection.update({ ...clause, meta: { type: VIEWPORT_CLAUSE_TYPE } });
  }

  /**
   * The latest figure drawn, or the last one moved, as a polygon clause; none
   * once every figure is deleted. The rule of the drawn-area variable, except
   * that a figure already on the map at load is sent too: the map is where the
   * area lives.
   */
  private pushArea(): void {
    const columns = this.options.columns;
    const clauseArea = this.runtime.clauseArea;
    if (!columns || !this.options.area || !clauseArea) {
      return;
    }
    const candidates = this.map.areas();
    const decision = decideAreaPublish({ candidates, lastSeen: this.areasSeen, publishedId: this.areaSent });
    this.areasSeen = areaFingerprints(candidates);
    if (decision.action === 'publish') {
      this.areaSent = decision.id;
      this.selection.update(clauseArea(columns, decision.wkt, { source: this.areaSource }));
    } else if (decision.action === 'clear') {
      this.areaSent = null;
      this.selection.update(clauseArea(columns, null, { source: this.areaSource }));
    }
  }
}
