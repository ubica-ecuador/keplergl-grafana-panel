import type { ClauseLike, LinkableFilter } from './mosaicLink';
import type { DrawnArea } from './keplerAdapter';
import {
  MosaicSelectionLink,
  type LinkOptions,
  type MapLike,
  type MosaicRuntimeLike,
  type SelectionLike,
} from './mosaicSelectionLink';

/**
 * The map in a crossfilter Selection, against a Selection that keeps
 * Mosaic's rules (one clause per source, the latest last, a clause with no
 * value taken out, reset calling the source's reset) and a map of plain
 * filters. What matters: a drag reaches the Selection, a brush elsewhere
 * reaches the map, and neither comes back as an echo.
 */

type Clause = ClauseLike & { fields: string[]; source: { reset?: () => void } };

class FakeSelection implements SelectionLike {
  clauses: Clause[] = [];
  active?: Clause;
  updates = 0;
  activations = 0;
  private listeners = new Set<() => void>();

  update(clause: ClauseLike) {
    const c = clause as Clause;
    this.updates++;
    this.clauses = this.clauses.filter((x) => x.source !== c.source);
    if (c.value != null) {
      this.clauses.push(c);
    }
    this.active = c;
    this.listeners.forEach((l) => l());
  }
  activate() {
    this.activations++;
  }
  reset(clauses: ClauseLike[] = this.clauses) {
    clauses.forEach((c) => (c as Clause).source.reset?.());
    this.clauses = this.clauses.filter((c) => !clauses.includes(c));
    this.listeners.forEach((l) => l());
  }
  addEventListener(_: 'value', l: () => void) {
    this.listeners.add(l);
  }
  removeEventListener(_: 'value', l: () => void) {
    this.listeners.delete(l);
  }
}

const runtime: MosaicRuntimeLike = {
  sharedSelection: jest.fn(),
  clauseInterval: (field, value, options) => ({
    ...options,
    value,
    fields: [field],
    meta: { type: 'interval' },
  }),
  clauseIntervals: (fields, value, options) => ({ ...options, value, fields, meta: { type: 'interval' } }),
  clausePoints: (fields, value, options) => ({ ...options, value, fields, meta: { type: 'point' } }),
  clauseColumns: (clause) => (clause as Clause).fields,
  clauseArea: (fields, wkt, options) => ({ ...options, value: wkt, fields, meta: { type: 'area' } }),
};

class FakeMap implements MapLike {
  list: LinkableFilter[] = [];
  view = { west: -74.1, south: 40.6, east: -73.8, north: 40.9 };
  columns: Record<string, string> = { fare: 'real', borough: 'string', t: 'timestamp' };
  domains: Record<string, [number, number]> = { fare: [0, 100], t: [0, 10_000] };
  filters = () => this.list.map((f) => ({ ...f }));
  parkedFields = new Set<string>();
  parked = () => this.parkedFields;
  rowsHeld: unknown[] = [{}];
  rows = () => this.rowsHeld;
  fieldType = (field: string) => this.columns[field];
  hasFilter = (field: string) => this.list.some((f) => f.field === field);
  apply = (field: string, value: unknown) => {
    const existing = this.list.find((f) => f.field === field);
    if (existing) {
      existing.value = value;
      return true;
    }
    const type = this.columns[field];
    this.list.push({
      field,
      type: type === 'string' ? 'multiSelect' : type === 'timestamp' ? 'timeRange' : 'range',
      value,
      domain: this.domains[field],
      fieldType: type,
    });
    return true;
  };
  open = (field: string) => {
    const f = this.list.find((x) => x.field === field)!;
    f.value = f.type === 'multiSelect' ? [] : f.domain;
  };
  remove = (field: string) => {
    this.list = this.list.filter((f) => f.field !== field);
  };
  viewport = () => this.view;
  drawn: DrawnArea[] = [];
  areas = () => this.drawn;
  set(field: string, value: unknown) {
    this.list.find((f) => f.field === field)!.value = value;
  }
  /** New rows, as an answer to the map's query: kepler rebuilds the filter from its saved form, open. */
  reload(field: string) {
    this.rowsHeld = [{}];
    this.set(field, this.domains[field]);
  }
}

const setup = (options: Partial<LinkOptions> = {}) => {
  const selection = new FakeSelection();
  const map = new FakeMap();
  const link = new MosaicSelectionLink(runtime, selection, map, {
    linkTime: true,
    columns: null,
    viewport: false,
    area: false,
    ...options,
  });
  return { selection, map, link };
};

const otherBrush = (field: string, value: unknown, type = 'interval'): Clause => ({
  source: { reset: jest.fn() },
  value,
  fields: [field],
  meta: { type },
});

it('sends a dragged range as a clause on its column, with a scale to pre-aggregate on', () => {
  const { selection, map, link } = setup();
  map.list.push({ field: 'fare', type: 'range', value: [0, 100], domain: [0, 100], fieldType: 'real' });
  link.push();
  expect(selection.clauses).toHaveLength(0);

  map.set('fare', [5, 20]);
  link.push();
  expect(selection.clauses).toHaveLength(1);
  expect(selection.clauses[0]).toMatchObject({ value: [5, 20], fields: ['fare'], pixelSize: 1 });
  expect(selection.activations).toBe(1);

  map.set('fare', [6, 20]);
  link.push();
  expect(selection.clauses).toHaveLength(1);
  expect(selection.activations).toBe(1);

  // Unchanged: nothing sent.
  const updates = selection.updates;
  link.push();
  expect(selection.updates).toBe(updates);

  // Open again: the clause goes.
  map.set('fare', [0, 100]);
  link.push();
  expect(selection.clauses).toHaveLength(0);
});

it('sends a time window as Dates and picked values as points', () => {
  const { selection, map, link } = setup();
  map.list.push({ field: 't', type: 'timeRange', value: [1000, 2000], domain: [0, 10_000], fieldType: 'timestamp' });
  map.list.push({ field: 'borough', type: 'multiSelect', value: ['Queens'], fieldType: 'string' });
  link.push();
  const byField = Object.fromEntries(selection.clauses.map((c) => [c.fields[0], c]));
  expect(byField.t.value).toEqual([new Date(1000), new Date(2000)]);
  expect(byField.borough.value).toEqual([['Queens']]);
});

it('lands another panel’s brush on the map, making the filter, and sends nothing back', () => {
  const { selection, map, link } = setup();
  selection.update(otherBrush('fare', [10, 30]));
  link.pull();
  expect(map.list).toEqual([expect.objectContaining({ field: 'fare', value: [10, 30] })]);

  const updates = selection.updates;
  link.push();
  expect(selection.updates).toBe(updates);

  // The brush cleared: the filter the link made goes with it.
  selection.reset();
  link.pull();
  expect(map.list).toHaveLength(0);
});

it('lands the brush again when new rows rebuild the map’s filter, and sends nothing back', () => {
  const { selection, map, link } = setup();
  const theirs = otherBrush('t', [new Date(1000), new Date(2000)]);
  selection.update(theirs);
  link.pull();
  expect(map.list[0].value).toEqual([1000, 2000]);

  map.reload('t');
  link.push();
  expect(map.list[0].value).toEqual([1000, 2000]);
  expect(selection.clauses).toEqual([theirs]);
  expect(theirs.source.reset).not.toHaveBeenCalled();

  // The map's own move after that still goes out.
  map.set('t', [3000, 4000]);
  link.push();
  expect(selection.clauses).toHaveLength(1);
  expect(link.isOwn(selection.clauses[0].source)).toBe(true);
});

it('waits for a filter kepler parked with the new rows, then lands the brush on it', () => {
  const { selection, map, link } = setup();
  selection.update(otherBrush('fare', [10, 30]));
  link.pull();
  const filter = map.list.pop()!;

  map.rowsHeld = [{}];
  map.parkedFields = new Set(['fare']);
  link.push();
  expect(selection.clauses).toHaveLength(1);

  map.parkedFields = new Set();
  map.list.push({ ...filter, value: [0, 100] });
  link.push();
  expect(map.list[0].value).toEqual([10, 30]);
  expect(selection.clauses).toHaveLength(1);
  expect(link.isOwn(selection.clauses[0].source)).toBe(false);
});

it('opens, not removes, a filter the author put on the map when the brush clears', () => {
  const { selection, map, link } = setup();
  map.list.push({ field: 'fare', type: 'range', value: [0, 100], domain: [0, 100], fieldType: 'real' });
  selection.update(otherBrush('fare', [10, 30]));
  link.pull();
  selection.reset();
  link.pull();
  expect(map.list).toEqual([expect.objectContaining({ field: 'fare', value: [0, 100] })]);
});

it('takes a column over from the other panel when the map’s filter moves, and gives it back', () => {
  const { selection, map, link } = setup();
  const theirs = otherBrush('fare', [10, 30]);
  selection.update(theirs);
  link.pull();

  map.set('fare', [12, 30]);
  link.push();
  expect(theirs.source.reset).toHaveBeenCalled();
  expect(selection.clauses).toHaveLength(1);
  expect(selection.clauses[0]).toMatchObject({ value: [12, 30] });
  expect(link.isOwn(selection.clauses[0].source)).toBe(true);

  // Their brush moves again: the map's clause goes, their window lands.
  selection.update(otherBrush('fare', [40, 50]));
  link.pull();
  expect(selection.clauses).toHaveLength(1);
  expect(map.list[0].value).toEqual([40, 50]);
});

it('opens the map’s filter when another panel clears every clause', async () => {
  const { selection, map, link } = setup();
  map.list.push({ field: 'fare', type: 'range', value: [5, 20], domain: [0, 100], fieldType: 'real' });
  link.push();
  selection.reset();
  await Promise.resolve();
  expect(map.list[0].value).toEqual([0, 100]);
  link.push();
  expect(selection.clauses).toHaveLength(0);
});

it('leaves the time filter alone when it follows the dashboard range', () => {
  const { selection, map, link } = setup({ linkTime: false });
  map.list.push({ field: 't', type: 'timeRange', value: [1000, 2000], domain: [0, 10_000], fieldType: 'timestamp' });
  link.push();
  expect(selection.clauses).toHaveLength(0);
  selection.update(otherBrush('t', [new Date(3000), new Date(4000)]));
  link.pull();
  expect(map.list[0].value).toEqual([1000, 2000]);
});

it('ignores a brush on a column the map does not have', () => {
  const { selection, map, link } = setup();
  selection.update(otherBrush('tip', [1, 2]));
  link.pull();
  expect(map.list).toHaveLength(0);
});

it('sends the view as a bbox once per move, and takes everything out on release', () => {
  const { selection, map, link } = setup({ columns: ['lng', 'lat'], viewport: true });
  map.list.push({ field: 'fare', type: 'range', value: [5, 20], domain: [0, 100], fieldType: 'real' });
  link.push();
  const view = selection.clauses.find((c) => c.fields.length === 2)!;
  expect(view.meta).toEqual({ type: 'viewport' });
  expect(view.value).toEqual([
    [-74.1, -73.8],
    [40.6, 40.9],
  ]);
  const updates = selection.updates;
  link.push();
  expect(selection.updates).toBe(updates);

  map.view = { ...map.view, west: -74.2 };
  link.push();
  expect(selection.updates).toBe(updates + 1);

  link.release();
  expect(selection.clauses).toHaveLength(0);
});

const square = (id: string, x: number): DrawnArea => ({
  id,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [x, 0],
        [x + 1, 0],
        [x + 1, 1],
        [x, 1],
        [x, 0],
      ],
    ],
  },
});
const areaOf = (selection: FakeSelection) => selection.clauses.find((c) => c.meta?.type === 'area');

it('sends the latest drawn figure as an area, follows its edits, and takes it out when deleted', () => {
  const { selection, map, link } = setup({ columns: ['lng', 'lat'], area: true });
  link.push();
  expect(areaOf(selection)).toBeUndefined();

  map.drawn = [square('a', 0)];
  link.push();
  expect(areaOf(selection)).toMatchObject({ fields: ['lng', 'lat'], value: expect.stringMatching(/^POLYGON/) });
  expect(link.isOwn(areaOf(selection)!.source)).toBe(true);

  // A second figure is the latest: it replaces the first in the Selection.
  map.drawn = [square('a', 0), square('b', 5)];
  link.push();
  expect(selection.clauses.filter((c) => c.meta?.type === 'area')).toHaveLength(1);
  expect(areaOf(selection)!.value).toContain('5 0');

  // Unchanged: nothing sent.
  const updates = selection.updates;
  link.push();
  expect(selection.updates).toBe(updates);

  // The latest deleted: the one left is the area; none left, no area.
  map.drawn = [square('a', 0)];
  link.push();
  expect(areaOf(selection)!.value).toContain('0 0');
  map.drawn = [];
  link.push();
  expect(areaOf(selection)).toBeUndefined();
});

it('sends a figure already on the map at load, and none with the area off or no columns', () => {
  const on = setup({ columns: ['lng', 'lat'], area: true });
  on.map.drawn = [square('a', 0)];
  on.link.push();
  expect(areaOf(on.selection)).toBeDefined();

  const off = setup({ columns: ['lng', 'lat'], area: false });
  off.map.drawn = [square('a', 0)];
  off.link.push();
  expect(areaOf(off.selection)).toBeUndefined();

  const noColumns = setup({ area: true });
  noColumns.map.drawn = [square('a', 0)];
  noColumns.link.push();
  expect(areaOf(noColumns.selection)).toBeUndefined();
});

it('leaves the area out with a Chaski app that has no area clause', () => {
  const selection = new FakeSelection();
  const map = new FakeMap();
  const { clauseArea: _, ...older } = runtime;
  const link = new MosaicSelectionLink(older, selection, map, {
    linkTime: true,
    columns: ['lng', 'lat'],
    viewport: false,
    area: true,
  });
  map.drawn = [square('a', 0)];
  link.push();
  expect(selection.clauses).toHaveLength(0);
});

it('takes the area out on release', () => {
  const { selection, map, link } = setup({ columns: ['lng', 'lat'], area: true });
  map.drawn = [square('a', 0)];
  link.push();
  link.release();
  expect(selection.clauses).toHaveLength(0);
});
