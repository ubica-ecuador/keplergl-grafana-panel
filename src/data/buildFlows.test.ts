import { buildFlows } from './buildFlows';

describe('buildFlows', () => {
  it('builds a LAT_LNG flow layer from origin/destination coordinate roles', () => {
    const layer = buildFlows(
      { originLat: 'origin_lat', originLng: 'origin_lon', destLat: 'dest_lat', destLng: 'dest_lon' },
      'grafana-A'
    );

    expect(layer).not.toBeNull();
    expect(layer!.type).toBe('flow');
    // Recognised as a saved-v1 layer config so kepler parses it.
    expect(layer!.visualChannels).toBeDefined();
    expect(layer!.config.dataId).toBe('grafana-A');
    expect(layer!.config.columnMode).toBe('LAT_LNG');
    // Columns bind to the kepler names toKeplerRows already renamed them to.
    expect(layer!.config.columns).toEqual({ lat0: 'lat0', lng0: 'lng0', lat1: 'lat1', lng1: 'lng1' });
  });

  it('adds the count column when a count role is present', () => {
    const layer = buildFlows(
      { originLat: 'a', originLng: 'b', destLat: 'c', destLng: 'd', count: 'trips' },
      'grafana-A'
    );

    expect(layer!.config.columns).toEqual({
      lat0: 'lat0',
      lng0: 'lng0',
      lat1: 'lat1',
      lng1: 'lng1',
      count: 'count',
    });
  });

  it('builds an H3 flow layer from origin/destination hexagon roles', () => {
    const layer = buildFlows({ originH3: 'from_h3', destH3: 'to_h3', count: 'trips' }, 'grafana-A');

    expect(layer!.config.columnMode).toBe('H3');
    // Column keys are the flow layer's own (sourceH3/targetH3); values are the
    // dataset field names toKeplerRows produced (source_h3/target_h3).
    expect(layer!.config.columns).toEqual({ sourceH3: 'source_h3', targetH3: 'target_h3', count: 'count' });
  });

  it('prefers H3 when both coordinate and hexagon roles are present', () => {
    const layer = buildFlows(
      { originLat: 'a', originLng: 'b', destLat: 'c', destLng: 'd', originH3: 'e', destH3: 'f' },
      'grafana-A'
    );

    expect(layer!.config.columnMode).toBe('H3');
  });

  it('returns null when the roles do not describe an origin-destination flow', () => {
    expect(buildFlows({ latitude: 'lat', longitude: 'lng' }, 'grafana-A')).toBeNull();
    // A half-specified OD pair is not a flow.
    expect(buildFlows({ originLat: 'a', originLng: 'b' }, 'grafana-A')).toBeNull();
    expect(buildFlows({ originH3: 'a' }, 'grafana-A')).toBeNull();
  });

  it('carries the rendering mode into the layer vis config', () => {
    const layer = buildFlows({ originLat: 'a', originLng: 'b', destLat: 'c', destLng: 'd' }, 'grafana-A', {
      renderingMode: 'curved',
    });

    expect(layer!.config.visConfig.flowLinesRenderingMode).toBe('curved');
  });

  it('defaults the rendering mode to straight', () => {
    const layer = buildFlows({ originLat: 'a', originLng: 'b', destLat: 'c', destLng: 'd' }, 'grafana-A');
    expect(layer!.config.visConfig.flowLinesRenderingMode).toBe('straight');
  });

  it('derives a stable layer id from the dataset id', () => {
    const a = buildFlows({ originLat: 'a', originLng: 'b', destLat: 'c', destLng: 'd' }, 'grafana-A');
    const b = buildFlows({ originLat: 'a', originLng: 'b', destLat: 'c', destLng: 'd' }, 'grafana-A');
    expect(a!.id).toBe(b!.id);
    expect(a!.config.dataId).toBe('grafana-A');
  });
});
