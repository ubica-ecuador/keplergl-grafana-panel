import type { WmsBox } from '../data/wmsDataset';
import {
  boxOverlapsView,
  decideWmsFraming,
  fitBoundsOfBox,
  judgedView,
  raisedToMinZoom,
  reliefBoundsOfBox,
  unionOfBounds,
  wmsClipBounds,
} from './wmsExtent';

/** IGN's Cassini map, the case that started this: France. */
const FRANCE: WmsBox = [-5.5, 41, 10, 51.5];
/** Fiji, across the antimeridian. */
const FIJI: WmsBox = [177, -21, -178, -12];
const WORLD: WmsBox = [-180, -90, 180, 90];

/** Cuenca, Ecuador, at a city zoom: where the dashboard's view was saved. */
const CUENCA = { west: -79.1, south: -2.95, east: -78.9, north: -2.85 };
/** A view of Paris and around. */
const PARIS = { west: 1.5, south: 48.5, east: 3.5, north: 49.2 };

const KEPLER_DEFAULT = { latitude: 37.75043, longitude: -122.34679, zoom: 9 };

describe('boxOverlapsView', () => {
  it('sees a box under the view, and one that is somewhere else', () => {
    expect(boxOverlapsView(FRANCE, PARIS)).toBe(true);
    expect(boxOverlapsView(FRANCE, CUENCA)).toBe(false);
  });

  it('counts a view that shows only an edge of the box', () => {
    expect(boxOverlapsView(FRANCE, { west: 9, south: 50, east: 12, north: 53 })).toBe(true);
  });

  it('finds the box on any copy of the world the view shows', () => {
    // Panned east past 180: Fiji at 182, and France at 362.
    expect(boxOverlapsView(FIJI, { west: 175, south: -25, east: 190, north: -10 })).toBe(true);
    expect(boxOverlapsView(FIJI, { west: -185, south: -25, east: -175, north: -10 })).toBe(true);
    expect(boxOverlapsView(FRANCE, { west: 355, south: 45, east: 365, north: 50 })).toBe(true);
    expect(boxOverlapsView(FIJI, { west: 100, south: -25, east: 150, north: -10 })).toBe(false);
  });

  it('is never fooled by latitude alone', () => {
    expect(boxOverlapsView(FRANCE, { west: 0, south: 55, east: 5, north: 60 })).toBe(false);
  });
});

describe('decideWmsFraming', () => {
  it('frames a layer the saved view shows none of', () => {
    expect(decideWmsFraming({ box: FRANCE, hasSavedView: true, view: CUENCA })).toBe('fit');
  });

  it('keeps a saved view that shows part of the layer', () => {
    expect(decideWmsFraming({ box: FRANCE, hasSavedView: true, view: PARIS })).toBe('keep');
  });

  it('frames a map with no saved view, whatever it shows', () => {
    expect(decideWmsFraming({ box: FRANCE, hasSavedView: false, view: PARIS })).toBe('fit');
    expect(decideWmsFraming({ box: FRANCE, hasSavedView: false, view: null })).toBe('fit');
  });

  it('keeps the view of a layer with no box', () => {
    expect(decideWmsFraming({ box: null, hasSavedView: false, view: CUENCA })).toBe('keep');
  });

  it('waits for a view it can measure', () => {
    expect(decideWmsFraming({ box: FRANCE, hasSavedView: true, view: null })).toBe('wait');
  });
});

describe('judgedView', () => {
  const sized = { width: 800, height: 600 };

  it('measures the map’s own view', () => {
    const view = judgedView({ latitude: 48.85, longitude: 2.35, zoom: 8, ...sized }, null)!;
    expect(view.west).toBeLessThan(2.35);
    expect(view.east).toBeGreaterThan(2.35);
    expect(boxOverlapsView(FRANCE, view)).toBe(true);
  });

  it('judges the saved view while the map still sits on kepler’s default', () => {
    const view = judgedView({ ...KEPLER_DEFAULT, ...sized }, { latitude: -2.9, longitude: -79, zoom: 12 })!;
    expect(view.west).toBeCloseTo(-79, 0);
    expect(boxOverlapsView(FRANCE, view)).toBe(false);
  });

  it('is null before the map has a size', () => {
    expect(judgedView({ latitude: 48.85, longitude: 2.35, zoom: 8, width: 0, height: 0 }, null)).toBeNull();
    expect(judgedView(null, null)).toBeNull();
  });
});

describe('fitBoundsOfBox and unionOfBounds', () => {
  it('frames a box across the antimeridian as one span east of its west', () => {
    expect(fitBoundsOfBox(FIJI)).toEqual([177, -21, 182, -12]);
  });

  it('keeps the frame inside Web Mercator', () => {
    const [, south, , north] = fitBoundsOfBox(WORLD);
    expect(south).toBeCloseTo(-85.05, 2);
    expect(north).toBeCloseTo(85.05, 2);
  });

  it('frames several layers on all of them', () => {
    expect(unionOfBounds([fitBoundsOfBox(FRANCE), [-9.5, 36, 3.3, 43.8]])).toEqual([-9.5, 36, 10, 51.5]);
    expect(unionOfBounds([])).toBeNull();
  });
});

describe('raisedToMinZoom', () => {
  /** IGN's WMTS of France, whose levels start at 6. */
  const IGN: [number, number, number, number] = [-5.15, 41.33, 9.57, 51.1];

  it('brings a fit below the first level in to it, on the box’s centre', () => {
    const raised = raisedToMinZoom(IGN, 6, 5.35)!;
    expect(raised.zoom).toBe(6);
    expect(raised.latitude).toBeCloseTo(46.215, 3);
    expect(raised.longitude).toBeCloseTo(2.21, 3);
  });

  it('leaves a fit at or past the first level, or with none, as it is', () => {
    expect(raisedToMinZoom(IGN, 6, 6)).toBeNull();
    expect(raisedToMinZoom(IGN, 6, 7.2)).toBeNull();
    expect(raisedToMinZoom(IGN, undefined, 3)).toBeNull();
    expect(raisedToMinZoom(IGN, 6, undefined)).toBeNull();
  });

  it('brings a centre past the antimeridian back into ±180', () => {
    expect(raisedToMinZoom(fitBoundsOfBox(FIJI), 8, 4)?.longitude).toBeCloseTo(179.5, 6);
    expect(raisedToMinZoom([176, -21, 190, -12], 8, 4)?.longitude).toBeCloseTo(-177, 6);
  });
});

describe('wmsClipBounds', () => {
  it('cuts the picture to the box', () => {
    expect(wmsClipBounds(FRANCE, [-20, 35, 20, 55], false)).toEqual(FRANCE);
  });

  it('cuts nothing without a box, or on a globe', () => {
    expect(wmsClipBounds(null, [-20, 35, 20, 55], false)).toBeNull();
    expect(wmsClipBounds(FRANCE, [-20, 35, 20, 55], true)).toBeNull();
  });

  it('cuts nothing for a box that covers the world', () => {
    expect(wmsClipBounds(WORLD, [-180, -85, 180, 85], false)).toBeNull();
  });

  it('cuts only north and south for a band around the world', () => {
    expect(wmsClipBounds([-180, -60, 180, 60], [-200, -70, 200, 70], false)).toEqual([-201, -60, 201, 60]);
  });

  it('stops at Web Mercator’s edge rather than at the pole', () => {
    const [, south, , north] = wmsClipBounds([-10, -90, 10, 90], [-20, -80, 20, 80], false)!;
    expect(south).toBeCloseTo(-85.05, 2);
    expect(north).toBeCloseTo(85.05, 2);
  });

  it('cuts around the copy of the world the picture is of', () => {
    // A view panned past 180 over Fiji, and one panned west of -180.
    expect(wmsClipBounds(FIJI, [170, -30, 190, -5], false)).toEqual([177, -21, 182, -12]);
    expect(wmsClipBounds(FIJI, [-190, -30, -170, -5], false)).toEqual([-183, -21, -178, -12]);
    expect(wmsClipBounds(FRANCE, [350, 35, 370, 55], false)).toEqual([354.5, 41, 370, 51.5]);
  });

  it('cuts on the box itself before any picture has landed', () => {
    expect(wmsClipBounds(FRANCE, undefined, false)).toEqual(FRANCE);
  });
});

describe('reliefBoundsOfBox', () => {
  it('bounds the MapLibre source by the box', () => {
    expect(reliefBoundsOfBox(FRANCE)).toEqual(FRANCE);
  });

  it('gives none across the antimeridian, around the world, or without a box', () => {
    expect(reliefBoundsOfBox(FIJI)).toBeNull();
    expect(reliefBoundsOfBox(WORLD)).toBeNull();
    expect(reliefBoundsOfBox(null)).toBeNull();
  });
});
