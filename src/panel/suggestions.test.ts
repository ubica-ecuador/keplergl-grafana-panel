import { createDataFrame, type DataFrame, FieldType, VisualizationSuggestionScore } from '@grafana/data';

import { keplerSuggestions, PREVIEW_MAX_ROWS } from './suggestions';

const frame = (fields: Array<{ name: string; type: FieldType; values: unknown[] }>): DataFrame =>
  createDataFrame({ fields });

const score = (...frames: DataFrame[]) => {
  const list = keplerSuggestions({ hasData: true, rawFrames: frames });
  return list ? list.map((s) => s.score) : undefined;
};

describe('keplerSuggestions', () => {
  it('suggests nothing without data', () => {
    expect(keplerSuggestions({ hasData: false, rawFrames: [] })).toBeUndefined();
    expect(keplerSuggestions({ hasData: true })).toBeUndefined();
  });

  it('suggests nothing for a time series', () => {
    expect(
      score(
        frame([
          { name: 'time', type: FieldType.time, values: [1, 2] },
          { name: 'value', type: FieldType.number, values: [3, 4] },
        ])
      )
    ).toBeUndefined();
  });

  it('is the best fit for named coordinates', () => {
    expect(
      score(
        frame([
          { name: 'Latitude', type: FieldType.number, values: [-2.9] },
          { name: 'lng', type: FieldType.number, values: [-79] },
        ])
      )
    ).toEqual([VisualizationSuggestionScore.Best]);
  });

  it('wants coordinates to be numbers', () => {
    expect(
      score(
        frame([
          { name: 'lat', type: FieldType.string, values: ['north'] },
          { name: 'lon', type: FieldType.string, values: ['west'] },
        ])
      )
    ).toBeUndefined();
  });

  it('is only an option for x and y, which XY charts are fed too', () => {
    expect(
      score(
        frame([
          { name: 'x', type: FieldType.number, values: [1] },
          { name: 'y', type: FieldType.number, values: [2] },
        ])
      )
    ).toEqual([VisualizationSuggestionScore.OK]);
  });

  it.each([
    ['geom', FieldType.string, 'POINT (-79 -2.9)'],
    ['geometry', FieldType.other, new Uint8Array([1, 1, 0, 0, 0])],
    ['h3', FieldType.string, '8a2a1072b59ffff'],
    ['geohash', FieldType.string, '6r8b'],
  ])('is the best fit for a %s column', (name, type, value) => {
    expect(score(frame([{ name, type, values: [value] }]))).toEqual([VisualizationSuggestionScore.Best]);
  });

  it('reads no shape in a number called geometry', () => {
    expect(score(frame([{ name: 'geometry', type: FieldType.number, values: [1] }]))).toBeUndefined();
  });

  it('is the best fit for flows', () => {
    expect(
      score(
        frame([
          { name: 'origin_lat', type: FieldType.number, values: [1] },
          { name: 'origin_lng', type: FieldType.number, values: [2] },
          { name: 'dest_lat', type: FieldType.number, values: [3] },
          { name: 'dest_lng', type: FieldType.number, values: [4] },
        ])
      )
    ).toEqual([VisualizationSuggestionScore.Best]);
  });

  it('is only an option for a bare link', () => {
    expect(score(frame([{ name: 'href', type: FieldType.string, values: ['https://x/a.pmtiles'] }]))).toEqual([
      VisualizationSuggestionScore.OK,
    ]);
    expect(score(frame([{ name: 'layer', type: FieldType.string, values: ['roads'] }]))).toBeUndefined();
  });

  it('offers a card for imagery whose frame names its own tile server, which the map draws through', () => {
    const served = (fields: Parameters<typeof frame>[0]) => {
      const f = frame(fields);
      f.meta = { custom: { tileServerUrl: 'https://titiler.catalog.test' } };
      return f;
    };
    expect(score(served([{ name: 'raster_url', type: FieldType.string, values: ['https://x/a.tif'] }]))).toEqual([
      VisualizationSuggestionScore.OK,
    ]);
    expect(
      score(
        served([
          { name: 'zarr_url', type: FieldType.string, values: ['https://x/store.zarr'] },
          { name: 'zarr_variable', type: FieldType.string, values: ['precip'] },
        ])
      )
    ).toEqual([VisualizationSuggestionScore.OK]);
  });

  it('suggests nothing for imagery that waits for a raster tile server, which a card has not', () => {
    const cog = frame([{ name: 'raster_url', type: FieldType.string, values: ['http://feeds/a.tif'] }]);
    const zarr = frame([{ name: 'zarr_url', type: FieldType.string, values: ['https://x/store.zarr'] }]);
    expect(score(cog)).toBeUndefined();
    expect(score(zarr)).toBeUndefined();
    expect(score(frame([{ name: 'esri_url', type: FieldType.string, values: ['https://x/ImageServer'] }]))).toEqual([
      VisualizationSuggestionScore.Best,
    ]);
  });

  it('is the best fit for map tiles, pictures, vector tiles and archives, and nothing for a template with no tile', () => {
    const tiles = (url: string, format: string) =>
      frame([
        { name: 'tiles_url', type: FieldType.string, values: [url] },
        { name: 'tiles_format', type: FieldType.string, values: [format] },
      ]);

    expect(score(tiles('https://t.test/{z}/{x}/{y}.png', 'raster'))).toEqual([VisualizationSuggestionScore.Best]);
    expect(score(tiles('https://t.test/{z}/{x}/{y}.mvt', 'mvt'))).toEqual([VisualizationSuggestionScore.Best]);
    expect(score(tiles('https://t.test/a.pmtiles', 'pmtiles'))).toEqual([VisualizationSuggestionScore.Best]);
    expect(score(tiles('https://t.test/tiles.mvt', 'mvt'))).toBeUndefined();
  });

  it('takes the best frame of several, and skips empty ones', () => {
    const empty = frame([
      { name: 'lat', type: FieldType.number, values: [] },
      { name: 'lon', type: FieldType.number, values: [] },
    ]);
    const xy = frame([
      { name: 'x', type: FieldType.number, values: [1] },
      { name: 'y', type: FieldType.number, values: [2] },
    ]);
    const cells = frame([{ name: 'h3', type: FieldType.string, values: ['8a2a1072b59ffff'] }]);
    expect(score(empty)).toBeUndefined();
    expect(score(empty, xy, cells)).toEqual([VisualizationSuggestionScore.Best]);
  });

  it('keeps the preview card small, without the side panel or the time widget', () => {
    const [suggestion] = keplerSuggestions({
      hasData: true,
      rawFrames: [frame([{ name: 'h3', type: FieldType.string, values: ['8a2a1072b59ffff'] }])],
    })!;
    expect(suggestion.cardOptions.maxRows).toBe(PREVIEW_MAX_ROWS);
    const card: { options?: Record<string, unknown> } = { options: { followGrafanaTheme: true } };
    suggestion.cardOptions.previewModifier(card);
    expect(card.options).toEqual({ followGrafanaTheme: true, showSidePanel: false, timeSync: 'off' });
  });
});
