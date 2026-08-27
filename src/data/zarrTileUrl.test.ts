import { zarrTileTemplate, ZarrTileSpec } from './zarrTileUrl';

/** The template for a spec that must produce one, narrowed away from null. */
function built(spec: ZarrTileSpec): string {
  const template = zarrTileTemplate(spec);
  if (template === null) {
    throw new Error('expected zarrTileTemplate to build a template for this spec');
  }
  return template;
}

const SERVER = 'http://localhost:8088';
const STORE = 'https://ncsa.osn.xsede.org/Pangeo/pangeo-forge/gpcp-feedstock/gpcp.zarr';

/** The parameters of a built template, as a plain object. */
function paramsOf(template: string): Record<string, string> {
  const query = template.slice(template.indexOf('?') + 1);
  return Object.fromEntries(new URLSearchParams(query));
}

describe('zarrTileTemplate', () => {
  it('addresses TiTiler’s zarr router, leaving the tile placeholders alone', () => {
    // deck.gl fills {z}/{x}/{y} itself, so they must survive verbatim — encoding
    // the braces would leave every request asking for a tile called "{z}".
    const template = built({ serverUrl: SERVER, storeUrl: STORE, variable: 'precip' });

    expect(template).toContain('/zarr/tiles/WebMercatorQuad/{z}/{x}/{y}.png?');
    expect(template.startsWith(`${SERVER}/zarr/tiles/`)).toBe(true);
  });

  it('carries the store and the variable', () => {
    const template = built({ serverUrl: SERVER, storeUrl: STORE, variable: 'precip' });

    expect(paramsOf(template)).toMatchObject({ url: STORE, variable: 'precip' });
  });

  it('asks for one moment as sel=time=<label>', () => {
    // TiTiler wants a single `sel` whose value is itself `dimension=label`.
    const template = built({
      serverUrl: SERVER,
      storeUrl: STORE,
      variable: 'precip',
      label: '1996-10-01T00:00:00.000000000',
    });

    expect(paramsOf(template).sel).toBe('time=1996-10-01T00:00:00.000000000');
  });

  it('walks a dimension that is not called time, when the store names it otherwise', () => {
    // The map's clock is not obliged to drive an axis called `time`. A climate
    // store may hold twelve months as `month=1..12` — integers, not dates — and
    // that is still the axis the timeline should walk.
    const template = built({
      serverUrl: SERVER,
      storeUrl: STORE,
      variable: 'climate',
      dimension: 'month',
      label: '7',
    });

    expect(paramsOf(template).sel).toBe('month=7');
  });

  it('omits sel entirely for a store with no time dimension', () => {
    // Sending an empty `sel` is not the same as sending none: TiTiler reads the
    // whole time axis as bands and answers "Source data must be 1 band".
    const template = built({ serverUrl: SERVER, storeUrl: STORE, variable: 'precip' });

    expect(paramsOf(template).sel).toBeUndefined();
  });

  it('passes the colour ramp and range through under TiTiler’s own names', () => {
    const template = built({
      serverUrl: SERVER,
      storeUrl: STORE,
      variable: 'precip',
      rescale: '0,30',
      colormap: 'blues',
    });

    expect(paramsOf(template)).toMatchObject({ rescale: '0,30', colormap_name: 'blues' });
  });

  it('omits the ramp and range when unset, so TiTiler picks its own', () => {
    const params = paramsOf(built({ serverUrl: SERVER, storeUrl: STORE, variable: 'precip' }));

    expect(params.rescale).toBeUndefined();
    expect(params.colormap_name).toBeUndefined();
  });

  it('tolerates a server url with a trailing slash', () => {
    const template = built({ serverUrl: `${SERVER}/`, storeUrl: STORE, variable: 'precip' });

    expect(template.startsWith(`${SERVER}/zarr/tiles/`)).toBe(true);
  });

  it('asks each zoom for its own pyramid level, leaving {z} for deck to fill', () => {
    // The whole point of a pyramid is that the server stops reading native
    // resolution to draw a continental view. TiTiler will not pick the level
    // itself — `titiler.xarray` knows nothing of `multiscales` — but its
    // `group` parameter selects one, and deck substitutes {z} anywhere in the
    // template, query string included.
    const template = built({ serverUrl: SERVER, storeUrl: STORE, variable: 'precip', levels: 6 });

    expect(template).toContain('group={z}');
    // Percent-encoded braces would never match deck's {z} regex, and every
    // request would ask for a group literally called "{z}".
    expect(template).not.toContain('%7B');
  });

  it('asks for no group at all when the store is not a pyramid', () => {
    const template = built({ serverUrl: SERVER, storeUrl: STORE, variable: 'precip' });

    expect(template).not.toContain('group=');
  });

  it('carries one sel per non-spatial dimension', () => {
    // A store can have more than one axis that is not space — CarbonPlan's demo
    // has a band and a month — and TiTiler takes a repeated `sel` for each.
    const template = built({
      serverUrl: SERVER,
      storeUrl: STORE,
      variable: 'climate',
      label: '1996-10-01T00:00:00.000000000',
      selectors: ['band=tavg'],
    });

    const sels = new URLSearchParams(template.slice(template.indexOf('?') + 1)).getAll('sel');
    expect(sels).toEqual(['band=tavg', 'time=1996-10-01T00:00:00.000000000']);
  });

  it('ignores selectors that name no dimension', () => {
    const template = built({
      serverUrl: SERVER,
      storeUrl: STORE,
      variable: 'climate',
      selectors: ['  ', 'band=tavg', 'nonsense'],
    });

    const sels = new URLSearchParams(template.slice(template.indexOf('?') + 1)).getAll('sel');
    expect(sels).toEqual(['band=tavg']);
  });

  it('draws nothing without a server, a store or a variable', () => {
    // A Zarr store is not tiles: with no server there is nothing to ask, and
    // with no variable the store is a bag of arrays rather than a picture.
    expect(zarrTileTemplate({ serverUrl: '', storeUrl: STORE, variable: 'precip' })).toBeNull();
    expect(zarrTileTemplate({ serverUrl: SERVER, storeUrl: '  ', variable: 'precip' })).toBeNull();
    expect(zarrTileTemplate({ serverUrl: SERVER, storeUrl: STORE, variable: '' })).toBeNull();
  });
});
