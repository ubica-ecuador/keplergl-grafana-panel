import { resolveCustomBasemapUrl } from './customBasemapUrl';

const PAGE = 'https://grafana.example.org/d/lulc-mundial/cobertura?orgId=1';

describe('resolveCustomBasemapUrl', () => {
  it('returns an empty string for nothing authored', () => {
    expect(resolveCustomBasemapUrl(undefined)).toBe('');
    expect(resolveCustomBasemapUrl('   ')).toBe('');
  });

  it('leaves an absolute URL alone', () => {
    const url = 'https://tiles.example.org/lulc/style-2025.json';
    expect(resolveCustomBasemapUrl(url, undefined, PAGE)).toBe(url);
  });

  it('interpolates dashboard variables', () => {
    const interpolate = (v: string) =>
      v.replace('${tilesBase}', 'https://tiles.example.org').replace('${anio}', '2019');
    expect(resolveCustomBasemapUrl('${tilesBase}/lulc/style-${anio}.json', interpolate, PAGE)).toBe(
      'https://tiles.example.org/lulc/style-2019.json'
    );
  });

  it('does not call the interpolator when there is nothing to interpolate', () => {
    const interpolate = jest.fn((v: string) => v);
    resolveCustomBasemapUrl('https://tiles.example.org/style.json', interpolate, PAGE);
    expect(interpolate).not.toHaveBeenCalled();
  });

  it('resolves a relative path against the page, which is what kepler needs', () => {
    expect(resolveCustomBasemapUrl('/tiles/lulc/style-2025.json', undefined, PAGE)).toBe(
      'https://grafana.example.org/tiles/lulc/style-2025.json'
    );
  });

  it('leaves relative values alone with no page to resolve against', () => {
    expect(resolveCustomBasemapUrl('/tiles/style.json')).toBe('/tiles/style.json');
  });

  it('treats a variable that resolves to nothing as nothing', () => {
    expect(resolveCustomBasemapUrl('${tilesBase}', () => '', PAGE)).toBe('');
  });

  it('never throws on a value that is neither absolute nor resolvable', () => {
    expect(resolveCustomBasemapUrl('://nope', undefined, 'not a url')).toBe('://nope');
  });
});
