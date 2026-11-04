import { toDataFrame } from '@grafana/data';

import {
  annotationWrite,
  geoTag,
  overlapsWindow,
  placeFromTags,
  plainText,
  readGeoAnnotations,
  toKeplerAnnotation,
} from './grafanaAnnotations';

describe('placeFromTags', () => {
  it('reads lng,lat from a geo tag', () => {
    expect(placeFromTags(['quake', 'geo:-78.5, -0.22'])).toEqual([-78.5, -0.22]);
  });
  it('takes a space or a semicolon, and a pair a comma split apart', () => {
    expect(placeFromTags(['geo:-78.5 -0.22'])).toEqual([-78.5, -0.22]);
    expect(placeFromTags(['geo:-78.5;-0.22'])).toEqual([-78.5, -0.22]);
    expect(placeFromTags(['quake', 'geo:-78.5', '-0.22'])).toEqual([-78.5, -0.22]);
  });
  it('ignores tags out of range or malformed', () => {
    expect(placeFromTags(['geo:200,10', 'geo:abc', 'map'])).toBeNull();
  });
  it('round-trips with geoTag', () => {
    expect(placeFromTags([geoTag(-79.004567891, -2.9001234)])).toEqual([-79.00457, -2.90012]);
  });
});

describe('readGeoAnnotations', () => {
  const frame = toDataFrame({
    fields: [
      { name: 'id', values: [1, 2, 3, 4] },
      { name: 'time', values: [1000, 2000, 3000, 4000] },
      { name: 'timeEnd', values: [1500, 2000, 3000, 4000] },
      { name: 'text', values: ['<b>M6.1</b> Ecuador', 'no place', 'from data', 'columns'] },
      { name: 'tags', values: [['geo:-80.1,-1.2'], ['deploy'], [], []] },
      {
        name: 'data',
        values: [undefined, undefined, { kepler: { kind: 'CIRCLE', anchorPoint: [10, 20] } }, undefined],
      },
      { name: 'longitude', values: [null, null, null, 5] },
      { name: 'latitude', values: [null, null, null, 6] },
    ],
  });

  it('keeps the annotations with a place and drops the rest', () => {
    const out = readGeoAnnotations([frame]);
    expect(out.map((a) => a.id)).toEqual(['1', '3', '4']);
    expect(out[0]).toMatchObject({ lng: -80.1, lat: -1.2, text: 'M6.1 Ecuador', time: 1000, timeEnd: 1500 });
    expect(out[1]).toMatchObject({ lng: 10, lat: 20, shape: { kind: 'CIRCLE' } });
    expect(out[2]).toMatchObject({ lng: 5, lat: 6 });
  });

  it('splits a query tags string without breaking the geo pair', () => {
    const q = toDataFrame({
      fields: [
        { name: 'time', values: [1] },
        { name: 'text', values: ['x'] },
        { name: 'tags', values: ['quake, geo:-78.5,-0.2, strong'] },
      ],
    });
    const [a] = readGeoAnnotations([q]);
    expect(a.tags).toEqual(['quake', 'geo:-78.5,-0.2', 'strong']);
    expect(a.id).toMatch(/^q/);
  });
});

describe('overlapsWindow', () => {
  it('shows a range annotation touching the window', () => {
    expect(overlapsWindow({ time: 10, timeEnd: 20 }, [15, 30])).toBe(true);
    expect(overlapsWindow({ time: 10, timeEnd: 20 }, [21, 30])).toBe(false);
    expect(overlapsWindow({ time: 10, timeEnd: 10 }, null)).toBe(true);
  });
});

describe('kepler callouts', () => {
  it('draws a Grafana annotation as a point callout with its colour', () => {
    const k = toKeplerAnnotation(
      { id: '7', time: 0, timeEnd: 0, text: 'hi', tags: [], color: '#ff0000', lng: 1, lat: 2 },
      false
    );
    expect(k).toMatchObject({
      id: 'grafana-7',
      kind: 'POINT',
      anchorPoint: [1, 2],
      label: 'hi',
      lineColor: '#FF0000',
      isVisible: false,
    });
  });

  it('writes a map note with its place as a tag and its shape as data', () => {
    const w = annotationWrite(
      { id: 'abc', kind: 'ARROW', label: 'Landfall', anchorPoint: [-80.12345678, -1.5], isVisible: true, mapIndex: 0 },
      ['map', 'geo:0,0']
    );
    expect(w.text).toBe('Landfall');
    expect(w.tags).toEqual(['map', 'geo:-80.12346,-1.5']);
    expect(w.data.kepler).toEqual({ kind: 'ARROW', label: 'Landfall', anchorPoint: [-80.12345678, -1.5] });
  });

  it('strips HTML from Grafana text', () => {
    expect(plainText('a<br/>b &amp; <i>c</i>')).toBe('a\nb & c');
  });
});
