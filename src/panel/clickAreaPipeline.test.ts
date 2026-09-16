import { registerEntry, setFeatures, wrapTo } from '@kepler.gl/actions';
import type { Store } from 'redux';

import { geoJsonToWkt } from '../data/geoJsonToWkt';
import { areaFingerprints, decideAreaPublish } from './areaSync';
import { isSquareSuperseded, squareAround, type PolygonGeometry } from './clickArea';
import { KEPLER_INSTANCE_ID } from './constants';
import { readDrawnAreas, readFigures, removeFigure, replaceFiguresWithSquare } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';

/**
 * The click-born square through the store the panel really builds and kepler's
 * real editor reducers, read back by the very functions `useAreaSync` publishes
 * from. What this proves is the design claim: the square needs no second writer
 * of the variable, because the area pipeline cannot tell it from a drawing.
 *
 * What it does not do is run `useAreaSync` itself, or click anything — deck's
 * picking has no place under jest. The hook and the click resolution have their
 * own tests; this one stands between them.
 */

/** `useAreaSync`'s state, driven the way its reconcile drives it. */
function areaPipeline(store: Store) {
  let lastSeen: Record<string, string> | null = null;
  let publishedId: string | null = null;
  let variable = '';
  return {
    get variable() {
      return variable;
    },
    pass() {
      const candidates = readDrawnAreas(store);
      const decision = decideAreaPublish({ candidates, lastSeen, publishedId });
      lastSeen = areaFingerprints(candidates);
      if (decision.action === 'publish') {
        variable = decision.wkt;
        publishedId = decision.id;
      } else if (decision.action === 'clear') {
        variable = '';
        publishedId = null;
      }
      return decision.action;
    },
  };
}

/** A figure as kepler's editor makes one when the user finishes a polygon. */
function handDrawn(id: string, lng: number, lat: number) {
  return {
    type: 'Feature',
    id,
    properties: { isClosed: true },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lng, lat],
          [lng + 0.1, lat],
          [lng + 0.1, lat + 0.1],
          [lng, lat],
        ],
      ],
    },
  };
}

function freshStore(): Store {
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
  return store;
}

const FIRE = { lng: -122.95, lat: 39.25 };
const SQUARE = squareAround(FIRE, 6000) as PolygonGeometry;

it('publishes a click-born square exactly like a drawing, and clears it when deleted', () => {
  const store = freshStore();
  const area = areaPipeline(store);
  expect(area.pass()).toBe('none'); // first pass adopts, as on dashboard load

  replaceFiguresWithSquare(store.dispatch, SQUARE, readFigures(store));
  expect(area.pass()).toBe('publish');
  expect(area.variable).toBe(geoJsonToWkt(SQUARE));

  // Deleted the way kepler's delete tool deletes it.
  removeFigure(store.dispatch, readFigures(store)[0]);
  expect(readDrawnAreas(store)).toEqual([]);
  expect(area.pass()).toBe('clear');
  expect(area.variable).toBe('');
});

it('draw, then click: the square replaces the drawing', () => {
  const store = freshStore();
  const area = areaPipeline(store);
  area.pass();

  store.dispatch(wrapTo(KEPLER_INSTANCE_ID, setFeatures([handDrawn('hand', -123, 39)] as never)) as never);
  area.pass();
  expect(area.variable).toContain('-123 39');

  replaceFiguresWithSquare(store.dispatch, SQUARE, readFigures(store));
  expect(readDrawnAreas(store).map((figure) => figure.id)).toHaveLength(1);
  expect(area.pass()).toBe('publish');
  expect(area.variable).toBe(geoJsonToWkt(SQUARE));
});

it('click, then draw: the drawing is published and the stale square removed', () => {
  const store = freshStore();
  const area = areaPipeline(store);
  area.pass();

  const squareId = replaceFiguresWithSquare(store.dispatch, SQUARE, readFigures(store));
  area.pass();

  // What kepler's editor dispatches on finishing a polygon: every figure it
  // shows, plus the new one at the end.
  const current = (store.getState() as { keplerGl: Record<string, { visState: { editor: { features: unknown[] } } }> })
    .keplerGl[KEPLER_INSTANCE_ID].visState.editor.features;
  store.dispatch(wrapTo(KEPLER_INSTANCE_ID, setFeatures([...current, handDrawn('hand', -121, 38)] as never)) as never);
  expect(area.pass()).toBe('publish');
  expect(area.variable).toContain('-121 38');

  const figures = readFigures(store);
  expect(isSquareSuperseded({ squareId, figures })).toBe(true);
  removeFigure(
    store.dispatch,
    figures.find((figure) => figure.id === squareId)!
  );

  expect(readDrawnAreas(store).map((figure) => figure.id)).toEqual(['hand']);
  // Removing the stale square does not disturb what is published.
  expect(area.pass()).toBe('none');
  expect(area.variable).toContain('-121 38');
});
