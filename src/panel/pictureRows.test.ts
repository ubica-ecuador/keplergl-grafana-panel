import { pictureKey } from './pictureKeys';
import { assignPictures, MAX_PICTURES, nextGeneration } from './pictureRows';

const page = 'http://localhost:3000/';
const rows = (n: number) => Array.from({ length: n }, (_, index) => ({ index }));

describe('assignPictures', () => {
  it('gives every row the layer picture when no column is bound', () => {
    const result = assignPictures(rows(3), { urlOf: null, layerPicture: 'https://a/pin.png', anchor: 'center', pageHref: page });

    expect(result.rows).toHaveLength(3);
    expect(result.icons.get(2)?.id).toBe(pictureKey('https://a/pin.png', 'center'));
    expect(result.keys).toEqual([pictureKey('https://a/pin.png', 'center')]);
    expect(result.urls).toEqual(['https://a/pin.png']);
    expect(result.failures).toEqual([]);
    expect(result.overflow).toBe(0);
  });

  it('draws nothing when there is neither a column nor a layer picture', () => {
    const result = assignPictures(rows(3), { urlOf: null, layerPicture: '  ', anchor: 'center', pageHref: page });

    expect(result.rows).toEqual([]);
    expect(result.keys).toEqual([]);
  });

  it("takes each row's own URL, and the layer picture for a row with none", () => {
    const urls: unknown[] = ['https://a/1.png', '', null, 42];
    const result = assignPictures(rows(4), {
      urlOf: (row) => urls[row.index],
      layerPicture: 'https://a/layer.png',
      anchor: 'bottom',
      pageHref: page,
    });

    expect(result.rows.map((row) => row.index)).toEqual([0, 1, 2, 3]);
    expect(result.icons.get(0)?.id).toBe(pictureKey('https://a/1.png', 'bottom'));
    for (const index of [1, 2, 3]) {
      expect(result.icons.get(index)?.id).toBe(pictureKey('https://a/layer.png', 'bottom'));
    }
    expect(result.urls).toEqual(['https://a/1.png', 'https://a/layer.png']);
  });

  it('leaves out a row with no picture of its own when there is no layer picture', () => {
    const urls = ['https://a/1.png', ''];
    const result = assignPictures(rows(2), { urlOf: (row) => urls[row.index], layerPicture: '', anchor: 'center', pageHref: page });

    expect(result.rows.map((row) => row.index)).toEqual([0]);
  });

  it('leaves out a row whose URL cannot load, and names that URL once', () => {
    const urls = ['javascript:alert(1)', 'javascript:alert(1)', 'https://a/ok.png'];
    const result = assignPictures(rows(3), {
      urlOf: (row) => urls[row.index],
      layerPicture: 'https://a/layer.png',
      anchor: 'center',
      pageHref: page,
    });

    expect(result.rows.map((row) => row.index)).toEqual([2]);
    expect(result.failures).toEqual([{ url: 'javascript:alert(1)', problem: 'scheme' }]);
  });

  it('reports a layer picture that cannot load, and draws no row with it', () => {
    const result = assignPictures(rows(2), {
      urlOf: null,
      layerPicture: 'http://a/layer.png',
      anchor: 'center',
      pageHref: 'https://grafana.example.org/',
    });

    expect(result.rows).toEqual([]);
    expect(result.failures).toEqual([{ url: 'http://a/layer.png', problem: 'mixed-content' }]);
  });

  it('stops at the cap in row order, and falls back to the layer picture beyond it', () => {
    const n = MAX_PICTURES + 10;
    const result = assignPictures(rows(n), {
      urlOf: (row) => `https://a/${row.index}.png`,
      layerPicture: 'https://a/layer.png',
      anchor: 'center',
      pageHref: page,
    });

    // The layer picture takes a slot first, so the fallback is always there.
    expect(result.keys).toHaveLength(MAX_PICTURES);
    expect(result.icons.get(MAX_PICTURES - 2)?.id).toBe(pictureKey(`https://a/${MAX_PICTURES - 2}.png`, 'center'));
    expect(result.icons.get(MAX_PICTURES - 1)?.id).toBe(pictureKey('https://a/layer.png', 'center'));
    expect(result.overflow).toBe(11);
    expect(result.rows).toHaveLength(n);
  });

  it('leaves out a row beyond the cap when there is no layer picture', () => {
    const result = assignPictures(rows(MAX_PICTURES + 1), {
      urlOf: (row) => `https://a/${row.index}.png`,
      layerPicture: '',
      anchor: 'center',
      pageHref: page,
    });

    expect(result.rows).toHaveLength(MAX_PICTURES);
    expect(result.overflow).toBe(1);
  });

  it('lists only the pictures a drawn row uses', () => {
    const result = assignPictures(rows(1), {
      urlOf: () => 'https://a/own.png',
      layerPicture: 'https://a/layer.png',
      anchor: 'center',
      pageHref: page,
    });

    expect(result.keys).toEqual([pictureKey('https://a/own.png', 'center')]);
    expect(result.urls).toEqual(['https://a/own.png']);
  });
});

describe('nextGeneration', () => {
  it('starts at generation zero', () => {
    expect(nextGeneration(undefined, ['a', 'b'], 3)).toEqual({ generation: 0, seen: ['a', 'b'] });
  });

  it('hands back the same record while nothing new appears', () => {
    const record = nextGeneration(undefined, ['a', 'b'], 3);
    expect(nextGeneration(record, ['b'], 3)).toBe(record);
  });

  it('keeps the generation while everything seen still fits', () => {
    const record = nextGeneration(undefined, ['a', 'b'], 3);
    expect(nextGeneration(record, ['c'], 3)).toEqual({ generation: 0, seen: ['a', 'b', 'c'] });
  });

  it('starts a new generation, remembering only the current keys, once the union overflows', () => {
    const record = nextGeneration(nextGeneration(undefined, ['a', 'b'], 3), ['c'], 3);
    expect(nextGeneration(record, ['d', 'e'], 3)).toEqual({ generation: 1, seen: ['d', 'e'] });
  });
});
