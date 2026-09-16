import { stacTileTemplate } from './stacTileUrl';

const ITEM = 'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/S2C_10SEJ_20260913_0_L2A';

describe('stacTileTemplate', () => {
  it('asks the /stac router for png tiles, leaving the z/x/y placeholders alone', () => {
    const template = stacTileTemplate({
      serverUrl: 'https://titiler.ubica.ec',
      itemUrl: ITEM,
      assets: ['swir22', 'nir', 'blue'],
      rescale: ['0,4000', '0,4000', '0,4000'],
    });
    expect(template).toContain('https://titiler.ubica.ec/stac/tiles/WebMercatorQuad/{z}/{x}/{y}.png?');
  });

  it('repeats the assets parameter, because a comma-separated list is a 404', () => {
    const template = stacTileTemplate({ serverUrl: 'https://t', itemUrl: ITEM, assets: ['swir22', 'nir', 'blue'] })!;
    expect(template.match(/[?&]assets=/g)).toHaveLength(3);
    expect(template).not.toContain('assets=swir22%2Cnir');
  });

  it('repeats the stretch once per asset, in the same order', () => {
    const template = stacTileTemplate({
      serverUrl: 'https://t',
      itemUrl: ITEM,
      assets: ['nir', 'red', 'green'],
      rescale: ['0,3000', '0,2500', '0,2000'],
    })!;
    expect(template.match(/[?&]rescale=/g)).toHaveLength(3);
    expect(template.indexOf('0%2C3000')).toBeLessThan(template.indexOf('0%2C2000'));
  });

  it('encodes an item url that carries a query of its own', () => {
    const signed = `${ITEM}?token=abc&x=1`;
    const template = stacTileTemplate({ serverUrl: 'https://t', itemUrl: signed, assets: ['nir'] })!;
    expect(template).toContain(encodeURIComponent(signed).replace(/%20/g, '+'));
    expect(template.match(/\?/g)).toHaveLength(1);
  });

  it('trims a trailing slash on the server, which would 404 or redirect', () => {
    const template = stacTileTemplate({ serverUrl: 'https://t///', itemUrl: ITEM, assets: ['nir'] })!;
    expect(template).toContain('https://t/stac/tiles/');
  });

  it('returns null rather than a half-built url', () => {
    expect(stacTileTemplate({ serverUrl: '', itemUrl: ITEM, assets: ['nir'] })).toBeNull();
    expect(stacTileTemplate({ serverUrl: 'https://t', itemUrl: '  ', assets: ['nir'] })).toBeNull();
    expect(stacTileTemplate({ serverUrl: 'https://t', itemUrl: ITEM, assets: [] })).toBeNull();
    expect(stacTileTemplate({ serverUrl: 'https://t', itemUrl: ITEM, assets: ['  '] })).toBeNull();
  });
});
