import { FieldType, toDataFrame } from '@grafana/data';

import {
  boxFitBounds,
  decideLayerFraming,
  MIN_BOX_SPAN,
  type QueryLayerAnswer,
  queryDatasetIds,
  queryLayerAnswers,
} from './layerFraming';

/**
 * The rules behind "a query pointed at another layer is framed on it". Literal
 * values only: no kepler, no store, no React.
 */

const ECUADOR: [number, number, number, number] = [-81, -5, -75, 1.5];
const PERU: [number, number, number, number] = [-81.4, -18.4, -68.7, -0.1];

const answer = (more: Partial<QueryLayerAnswer> = {}): QueryLayerAnswer => ({
  refId: 'A',
  key: 'cat|vector|ecuador',
  boxes: [],
  hasRows: true,
  boxFramed: false,
  ...more,
});

const known = (entries: Record<string, string | null>) => new Map(Object.entries(entries));

describe('decideLayerFraming', () => {
  it('only records the first answer: the load frames it, or keeps the saved view', () => {
    const decision = decideLayerFraming(known({}), [answer({ boxes: [ECUADOR] })]);
    expect(decision.known.get('A')).toBe('cat|vector|ecuador');
    expect(decision.box).toBeNull();
    expect(decision.rows).toEqual([]);
  });

  it('frames another layer on its box', () => {
    const decision = decideLayerFraming(known({ A: 'cat|vector|ecuador' }), [
      answer({ key: 'cat|vector|peru', boxes: [PERU] }),
    ]);
    expect(decision.box).toEqual(PERU);
    expect(decision.rows).toEqual([]);
    expect(decision.known.get('A')).toBe('cat|vector|peru');
  });

  it('frames another layer with no box on its rows', () => {
    const decision = decideLayerFraming(known({ A: 'cat|vector|ecuador' }), [answer({ key: 'cat|vector|peru' })]);
    expect(decision.box).toBeNull();
    expect(decision.rows).toEqual(['A']);
  });

  it('moves nothing for the same layer again: a refresh', () => {
    const decision = decideLayerFraming(known({ A: 'cat|vector|ecuador' }), [answer({ boxes: [ECUADOR] })]);
    expect(decision.box).toBeNull();
    expect(decision.rows).toEqual([]);
  });

  it('frames the box of another layer that answered no rows; keeps the view with neither', () => {
    const before = known({ A: 'cat|vector|ecuador' });
    expect(decideLayerFraming(before, [answer({ key: 'p', boxes: [PERU], hasRows: false })]).box).toEqual(PERU);
    const empty = decideLayerFraming(before, [answer({ key: 'p', hasRows: false })]);
    expect(empty.box).toBeNull();
    expect(empty.rows).toEqual([]);
    expect(empty.known.get('A')).toBe('p');
  });

  it('leaves a query framed on its own box to that framing', () => {
    const decision = decideLayerFraming(known({ A: 'cat|service|wms-a' }), [
      answer({ key: 'cat|service|wms-b', boxes: [PERU], boxFramed: true }),
    ]);
    expect(decision.box).toBeNull();
    expect(decision.rows).toEqual([]);
    expect(decision.known.get('A')).toBe('cat|service|wms-b');
  });

  it('frames the queries that changed together, on the union of their boxes', () => {
    const decision = decideLayerFraming(known({ A: 'a1', B: 'b1', C: 'c1' }), [
      answer({ refId: 'A', key: 'a2', boxes: [ECUADOR] }),
      answer({ refId: 'B', key: 'b2', boxes: [PERU] }),
      answer({ refId: 'C', key: 'c1', boxes: [[0, 40, 10, 50]] }),
    ]);
    expect(decision.box).toEqual([-81.4, -18.4, -68.7, 1.5]);
  });

  it('keeps the layer of a query that did not answer, so its return is no switch', () => {
    const decision = decideLayerFraming(known({ A: 'a1', B: 'b1' }), [answer({ refId: 'A', key: 'a1' })]);
    expect(decision.known.get('B')).toBe('b1');
    const back = decideLayerFraming(decision.known, [answer({ refId: 'B', key: 'b1', boxes: [PERU] })]);
    expect(back.box).toBeNull();
  });

  it('frames a query that starts naming a layer, not one that stops', () => {
    expect(decideLayerFraming(known({ A: null }), [answer({ key: 'a', boxes: [PERU] })]).box).toEqual(PERU);
    const stopped = decideLayerFraming(known({ A: 'a' }), [answer({ key: null, boxes: [] })]);
    expect(stopped.rows).toEqual([]);
    expect(stopped.known.get('A')).toBeNull();
  });
});

describe('boxFitBounds', () => {
  it('frames a box as a WMS box is framed: unwrapped, inside Web Mercator', () => {
    expect(boxFitBounds([170, -20, -170, -10])).toEqual([170, -20, 190, -10]);
    expect(boxFitBounds([-180, -90, 180, 90])).toEqual([-180, -85.051129, 180, 85.051129]);
  });

  it('gives a point a span of its own, centred on it', () => {
    const [west, south, east, north] = boxFitBounds([-79, -2.9, -79, -2.9]);
    expect(east - west).toBeCloseTo(MIN_BOX_SPAN);
    expect(north - south).toBeCloseTo(MIN_BOX_SPAN);
    expect((west + east) / 2).toBeCloseTo(-79);
    expect((south + north) / 2).toBeCloseTo(-2.9);
  });

  it('keeps a box squeezed against the projection edge inside it', () => {
    const [, south, , north] = boxFitBounds([0, 86, 10, 90]);
    expect(north).toBeCloseTo(85.051129);
    expect(north - south).toBeCloseTo(MIN_BOX_SPAN);
  });
});

describe('queryLayerAnswers', () => {
  const frame = (refId: string, custom: unknown, rows = 1) =>
    toDataFrame({
      refId,
      meta: { custom } as never,
      fields: [{ name: 'v', type: FieldType.number, values: Array.from({ length: rows }, (_, i) => i) }],
    });

  it('reads each query once, its frames joined', () => {
    const answers = queryLayerAnswers(
      [
        frame('A', { layer: { key: 'a', bbox: ECUADOR } }),
        frame('A', { layer: { key: 'a2' } }, 0),
        frame('B', { layer: { key: 'b' } }, 0),
        frame('C', {}),
      ],
      new Set()
    );
    expect(answers).toEqual([
      { refId: 'A', key: 'a\na2', boxes: [ECUADOR], hasRows: true, boxFramed: false },
      { refId: 'B', key: 'b', boxes: [], hasRows: false, boxFramed: false },
      { refId: 'C', key: null, boxes: [], hasRows: true, boxFramed: false },
    ]);
  });

  it('tells a query whose service is framed on its own box', () => {
    const [a] = queryLayerAnswers([frame('A', { layer: { key: 'a' } })], new Set(['grafana-A-wms']));
    expect(a.boxFramed).toBe(true);
    expect(queryDatasetIds('A')).toContain('grafana-A-tiles');
  });
});
