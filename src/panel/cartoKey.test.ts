import { cartoTransformRequest, isCartoUrl, resolveCartoKey, withCartoKey } from './cartoKey';

describe('withCartoKey', () => {
  it('adds the key to every CARTO host', () => {
    expect(withCartoKey('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json', 'k')).toBe(
      'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json?key=k'
    );
    expect(
      withCartoKey('https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt', 'k')
    ).toBe('https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt?key=k');
  });

  it('appends to an existing query and keeps a fragment last', () => {
    expect(withCartoKey('https://basemaps.cartocdn.com/a.json?x=1#f', 'k')).toBe(
      'https://basemaps.cartocdn.com/a.json?x=1&key=k#f'
    );
  });

  it('keeps templates such as {fontstack} as they are', () => {
    expect(withCartoKey('https://basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf', 'k')).toContain(
      '{fontstack}/{range}.pbf?key=k'
    );
  });

  it('never adds a second key', () => {
    expect(withCartoKey('https://basemaps.cartocdn.com/a.json?key=old', 'k')).toBe(
      'https://basemaps.cartocdn.com/a.json?key=old'
    );
  });

  it('does not take a parameter ending in "key" for the key', () => {
    expect(withCartoKey('https://basemaps.cartocdn.com/a.json?monkey=1', 'k')).toBe(
      'https://basemaps.cartocdn.com/a.json?monkey=1&key=k'
    );
  });

  it('encodes the key', () => {
    expect(withCartoKey('https://basemaps.cartocdn.com/a.json', 'a b&c')).toBe(
      'https://basemaps.cartocdn.com/a.json?key=a%20b%26c'
    );
  });

  it('leaves other hosts alone, look-alikes included', () => {
    for (const url of [
      'https://tiles.openfreemap.org/styles/liberty',
      'https://basemaps.cartocdn.com.evil.example/x',
      'https://evilbasemaps.cartocdn.com/x',
      'http://basemaps.cartocdn.com/x',
    ]) {
      expect(withCartoKey(url, 'k')).toBe(url);
      expect(isCartoUrl(url)).toBe(false);
    }
  });
});

describe('resolveCartoKey', () => {
  const vars = (s: string) => s.replace('$key', '  abc  ').replace('$none', '');

  it('interpolates dashboard variables and trims', () => {
    expect(resolveCartoKey('$key', vars)).toBe('abc');
  });

  it('counts empty or blank as no key', () => {
    expect(resolveCartoKey(undefined, vars)).toBeUndefined();
    expect(resolveCartoKey('   ', vars)).toBeUndefined();
    expect(resolveCartoKey('$none', vars)).toBeUndefined();
  });
});

describe('cartoTransformRequest', () => {
  it('reads the key at each request, so a new key needs no new map', () => {
    let key: string | undefined;
    const transform = cartoTransformRequest(() => key);
    expect(transform('https://basemaps.cartocdn.com/a.png').url).toBe('https://basemaps.cartocdn.com/a.png');
    key = 'k';
    expect(transform('https://basemaps.cartocdn.com/a.png').url).toBe('https://basemaps.cartocdn.com/a.png?key=k');
  });
});
