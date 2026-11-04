import { relativeRemoteSource, resolveRemoteSource } from './remoteSource';

const BASE = 'https://grafana.example.org/sub/';

describe('remote dataset sources', () => {
  it('resolves a path under Grafana against its root, sub-path included', () => {
    expect(resolveRemoteSource('public/maps/countries.geojson', BASE)).toBe(
      'https://grafana.example.org/sub/public/maps/countries.geojson'
    );
  });

  it('leaves an address that is already absolute alone', () => {
    expect(resolveRemoteSource('https://data.example.org/a.geojson', BASE)).toBe('https://data.example.org/a.geojson');
  });

  it('stores a file under Grafana relative to it, and any other address in full', () => {
    expect(relativeRemoteSource('https://grafana.example.org/sub/public/maps/x.geojson', BASE)).toBe(
      'public/maps/x.geojson'
    );
    expect(relativeRemoteSource('https://data.example.org/a.geojson', BASE)).toBe('https://data.example.org/a.geojson');
  });
});
