import { toDataFrame } from '@grafana/data';

import {
  attributionStrings,
  attributionsOf,
  frameCreditsOf,
  frameLayerOf,
  frameZoomsOf,
  layerBoxOf,
} from './frameLayer';

const frameWith = (custom: unknown) => toDataFrame({ refId: 'A', fields: [], meta: { custom } as never });

describe('frameLayerOf', () => {
  it('reads the key and the box a frame names', () => {
    expect(frameLayerOf(frameWith({ layer: { key: 'cat|vector|a', bbox: [-81, -5, -75, 1.5] } }))).toEqual({
      key: 'cat|vector|a',
      bbox: [-81, -5, -75, 1.5],
    });
  });

  it('takes a layer with no box, or a null one', () => {
    expect(frameLayerOf(frameWith({ layer: { key: 'k' } }))).toEqual({ key: 'k', bbox: null });
    expect(frameLayerOf(frameWith({ layer: { key: 'k', bbox: null } }))).toEqual({ key: 'k', bbox: null });
  });

  it('names no layer without a key', () => {
    expect(frameLayerOf(toDataFrame({ refId: 'A', fields: [] }))).toBeNull();
    expect(frameLayerOf(frameWith({ tileServerUrl: 'https://tiles.example.org' }))).toBeNull();
    expect(frameLayerOf(frameWith({ layer: { key: '' } }))).toBeNull();
    expect(frameLayerOf(frameWith({ layer: { key: 3, bbox: [0, 0, 1, 1] } }))).toBeNull();
    expect(frameLayerOf(frameWith({ layer: 'k' }))).toBeNull();
  });
});

describe('layerBoxOf', () => {
  it('keeps a point, and a box across the antimeridian', () => {
    expect(layerBoxOf([-79, -2.9, -79, -2.9])).toEqual([-79, -2.9, -79, -2.9]);
    expect(layerBoxOf([170, -20, -170, -10])).toEqual([170, -20, -170, -10]);
  });

  it('pulls a box a hair outside the world back to its edge', () => {
    expect(layerBoxOf([-180.0000001, -90, 180, 90.0000001])).toEqual([-180, -90, 180, 90]);
  });

  it('refuses what is not a box in degrees', () => {
    expect(layerBoxOf([0, 10, 1, 5])).toBeNull();
    expect(layerBoxOf([0, 0, 1])).toBeNull();
    expect(layerBoxOf([0, 0, 1, Number.NaN])).toBeNull();
    expect(layerBoxOf([500000, 4000000, 600000, 4100000])).toBeNull();
    expect(layerBoxOf('0 0 1 1')).toBeNull();
  });
});

describe("a layer's credits", () => {
  it('takes a title, a title and a page, or a list of either, with or without a key', () => {
    expect(frameCreditsOf(frameWith({ layer: { attribution: '© ESA' } }))).toEqual([{ title: '© ESA' }]);
    expect(
      frameCreditsOf(
        frameWith({
          layer: {
            key: 'k',
            attribution: [{ title: 'Copernicus', url: 'https://www.copernicus.eu' }, 'CC-BY-4.0', 'cc-by-4.0'],
          },
        })
      )
    ).toEqual([{ title: 'Copernicus', url: 'https://www.copernicus.eu/' }, { title: 'CC-BY-4.0' }]);
    expect(frameCreditsOf(frameWith({ layer: { key: 'k' } }))).toEqual([]);
    expect(frameCreditsOf(toDataFrame({ refId: 'A', fields: [] }))).toEqual([]);
  });

  it('keeps only web pages as links and no markup in a title', () => {
    const credits = frameCreditsOf(
      frameWith({
        layer: {
          attribution: [
            { title: 'Bad', url: 'javascript:alert(1)' },
            { title: '<b>"Quoted"</b> <img src=x onerror=alert(1)>', url: 'https://ok.example.org/a"b' },
            { url: 'https://untitled.example.org' },
          ],
        },
      })
    );
    expect(credits).toEqual([
      { title: 'Bad' },
      { title: 'bQuoted/b img src=x onerror=alert(1)', url: 'https://ok.example.org/a%22b' },
    ]);
    // What kepler is handed: its link pattern reads the href and title back whole.
    const [plain, link] = attributionStrings(credits);
    expect(plain).toBe('Bad');
    expect(link).toBe(
      '<a href="https://ok.example.org/a%22b" title="bQuoted/b img src=x onerror=alert(1)">bQuoted/b img src=x onerror=alert(1)</a>'
    );
    expect(/href="([^"]*)/.exec(link)?.[1]).toBe('https://ok.example.org/a%22b');
  });

  it('keeps a footer short: four credits, each one line', () => {
    const many = Array.from({ length: 9 }, (_, i) => `Credit ${i}`);
    expect(frameCreditsOf(frameWith({ layer: { attribution: many } }))).toHaveLength(4);
    const [long] = frameCreditsOf(frameWith({ layer: { attribution: 'word\n'.repeat(100) } }));
    expect(long.title.length).toBeLessThanOrEqual(160);
    expect(long.title).not.toContain('\n');
  });

  it("is spread into a dataset's metadata only when there is one", () => {
    expect(attributionsOf(frameWith({ layer: { attribution: 'OSM' } }))).toEqual({ attributions: ['OSM'] });
    expect(attributionsOf(frameWith({ layer: { key: 'k' } }))).toEqual({});
  });
});

describe("a layer's zoom levels", () => {
  it('reads whole levels, and drops a maximum under the minimum', () => {
    expect(frameZoomsOf(frameWith({ layer: { minZoom: 2, maxZoom: 14 } }))).toEqual({ minZoom: 2, maxZoom: 14 });
    expect(frameZoomsOf(frameWith({ layer: { minZoom: 10, maxZoom: 4 } }))).toEqual({ minZoom: 10 });
    expect(frameZoomsOf(frameWith({ layer: { minZoom: 1.5, maxZoom: '9' } }))).toEqual({});
    expect(frameZoomsOf(frameWith({}))).toEqual({});
  });
});
