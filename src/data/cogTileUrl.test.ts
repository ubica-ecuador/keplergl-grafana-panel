import { cogTileTemplate, withPaint } from './cogTileUrl';

const SERVER = 'http://localhost:8088';
const COG = 'https://ai4edataeuwest.blob.core.windows.net/io-lulc/io-annual-lulc-v02/17M_20230101-20240101.tif';

describe('cogTileTemplate', () => {
  it('asks TiTiler’s cog router for a painted PNG, leaving the tile placeholders alone', () => {
    // deck.gl fills {z}/{x}/{y} itself, so they must survive verbatim — encoding
    // the braces would leave every request asking for a tile called "{z}".
    // `.png` rather than `.npy` is the whole point of this layer: it is what
    // makes the server apply the colours instead of the browser.
    const template = cogTileTemplate({ serverUrl: SERVER, sourceUrl: COG });

    expect(template).toBe(`${SERVER}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(COG)}`);
  });

  it('carries a signed COG whole, as one opaque value', () => {
    // The COG this was built for is behind a SAS signature, so its url is
    // itself a query string. Encoded as a parameter it survives; spliced in
    // raw, its `&sig=` would arrive as a parameter of the tile request and the
    // server would open an unsigned url and answer 404.
    const signed = `${COG}?st=2026-08-27T22%3A50%3A34Z&se=2026-08-27T23%3A35%3A34Z&sig=abc%2Fdef%3D`;

    const template = cogTileTemplate({ serverUrl: SERVER, sourceUrl: signed });

    expect(template).not.toBeNull();
    const query = template!.slice(template!.indexOf('?') + 1);
    expect(new URLSearchParams(query).get('url')).toBe(signed);
  });

  it('has nothing to ask when the tile server is unset', () => {
    // The panel option defaults to a server, but a dashboard can blank it, and
    // half a url would ask a question that answers 404 on every tile.
    expect(cogTileTemplate({ serverUrl: '', sourceUrl: COG })).toBeNull();
  });

  it('has nothing to ask when the query named no image', () => {
    expect(cogTileTemplate({ serverUrl: SERVER, sourceUrl: '   ' })).toBeNull();
  });

  it('does not double the slash when the server url ends in one', () => {
    const template = cogTileTemplate({ serverUrl: `${SERVER}/`, sourceUrl: COG });

    expect(template).toContain(`${SERVER}/cog/tiles/`);
  });

  it('asks the server to paint it as the query says, after the file', () => {
    const template = cogTileTemplate({ serverUrl: SERVER, sourceUrl: COG, paint: 'bidx=1&colormap_name=viridis' });

    expect(template).toBe(
      `${SERVER}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(COG)}&bidx=1&colormap_name=viridis`
    );
  });
});

describe('withPaint', () => {
  const params = () =>
    new URLSearchParams([
      ['url', COG],
      ['assets', 'red'],
      ['assets', 'green'],
      ['rescale', '0,3000'],
    ]);

  it('lets the paint’s keys win, every value of a repeated one, and adds the rest', () => {
    const painted = withPaint(params(), '?rescale=0,255&assets=nir&colormap={"1":[0,128,0,255]}');

    expect(painted.getAll('rescale')).toEqual(['0,255']);
    expect(painted.getAll('assets')).toEqual(['nir']);
    expect(painted.get('colormap')).toBe('{"1":[0,128,0,255]}');
  });

  it('never takes a second image, and leaves the request alone without paint', () => {
    expect(withPaint(params(), 'url=https://elsewhere.test/a.tif&bidx=2').getAll('url')).toEqual([COG]);
    expect(withPaint(params(), '  ').toString()).toBe(params().toString());
    expect(withPaint(params(), undefined).toString()).toBe(params().toString());
  });
});

describe('cogTileTemplate with a painting', () => {
  it("adds the catalog's parameters after the file, and never a second url", () => {
    const template = cogTileTemplate({
      serverUrl: 'https://tiler.example/',
      sourceUrl: 'https://data.example/forest.tif',
      paint: 'bidx=1&colormap=%7B%221%22%3A%5B77%2C146%2C33%2C255%5D%7D&url=https%3A%2F%2Fevil.example%2Fx.tif',
    })!;
    const query = new URLSearchParams(template.split('?')[1]);
    expect(template.startsWith('https://tiler.example/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?')).toBe(true);
    expect(query.getAll('url')).toEqual(['https://data.example/forest.tif']);
    expect(query.get('bidx')).toBe('1');
    expect(JSON.parse(query.get('colormap')!)).toEqual({ '1': [77, 146, 33, 255] });
  });
});
