import { esriImageTemplate, esriImageUrl, mapServiceOf } from './esriImageUrl';

const SERVICE = 'https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer';

/** One Web Mercator tile, as deck hands it over: degrees. */
const TILE = { west: -81.5625, south: -2.811371, east: -80.15625, north: -1.406109 };

/** The parameters of a built url, as a plain object. */
function paramsOf(url: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(url.slice(url.indexOf('?') + 1)));
}

describe('esriImageUrl', () => {
  it('asks the service to export the image for one tile', () => {
    const url = esriImageUrl({ serviceUrl: SERVICE }, TILE);

    expect(url).not.toBeNull();
    expect(url!.startsWith(`${SERVICE}/exportImage?`)).toBe(true);
    expect(paramsOf(url!)).toMatchObject({ f: 'image', format: 'png32', size: '256,256' });
  });

  it('sends the tile bounds as Web Mercator metres, not degrees', () => {
    // A tile is a square of Web Mercator; its extent in degrees is not. Sent as
    // degrees, the service reprojects a box whose edges do not line up with the
    // tile, and the picture arrives shifted north-south by more the further
    // from the equator.
    const url = esriImageUrl({ serviceUrl: SERVICE }, TILE);
    const { bbox, bboxSR, imageSR } = paramsOf(url!);
    const [xmin, ymin] = bbox.split(',').map(Number);

    expect(bboxSR).toBe('3857');
    expect(imageSR).toBe('3857');
    expect(xmin).toBeCloseTo(-9079495.97, 0);
    expect(ymin).toBeCloseTo(-313086.07, 0);
  });

  it('clamps a latitude past the edge of the projection', () => {
    // Web Mercator runs to infinity at the poles. deck asks for the top tile of
    // the world at every zoom, and an infinite bbox is a 400 on every one.
    const url = esriImageUrl({ serviceUrl: SERVICE }, { west: -180, south: -90, east: 180, north: 90 });
    const values = paramsOf(url!).bbox.split(',').map(Number);

    expect(values.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('asks for a format that can actually carry transparency', () => {
    // `transparent=true` alone is not enough, and this is measured rather than
    // assumed: with `format=png` the land-cover service returns nodata as
    // **opaque black** over half an ocean-side tile, flag or no flag. Only
    // `png32` comes back with a real alpha channel. Asking for the wrong one
    // would blanket the base map with black sea.
    const params = paramsOf(esriImageUrl({ serviceUrl: SERVICE }, TILE)!);

    expect(params.format).toBe('png32');
    expect(params.transparent).toBe('true');
  });

  it('carries the rule that picks which rasters of the mosaic to draw', () => {
    // How a year is chosen on a multi-temporal service — the same rule the
    // land-cover figures already send with computeHistograms.
    const rule = '{"mosaicMethod":"esriMosaicAttribute","where":"Year=2023"}';
    const url = esriImageUrl({ serviceUrl: SERVICE, mosaicRule: rule }, TILE);

    expect(paramsOf(url!).mosaicRule).toBe(rule);
  });

  it('carries a rendering rule when one is given, and omits it when not', () => {
    const rule = '{"rasterFunction":"Stretch"}';

    expect(paramsOf(esriImageUrl({ serviceUrl: SERVICE, renderingRule: rule }, TILE)!).renderingRule).toBe(rule);
    expect(paramsOf(esriImageUrl({ serviceUrl: SERVICE }, TILE)!).renderingRule).toBeUndefined();
  });

  it('asks for the tile size deck is using', () => {
    expect(paramsOf(esriImageUrl({ serviceUrl: SERVICE, size: 512 }, TILE)!).size).toBe('512,512');
  });

  it('has nothing to ask when the query named no service', () => {
    expect(esriImageUrl({ serviceUrl: '   ' }, TILE)).toBeNull();
  });

  it('does not double the slash when the service url ends in one', () => {
    const url = esriImageUrl({ serviceUrl: `${SERVICE}/` }, TILE);

    expect(url!.startsWith(`${SERVICE}/exportImage?`)).toBe(true);
  });
});

describe('esriImageTemplate', () => {
  it('is the same request with MapLibre’s box placeholder, braces and all', () => {
    const spec = { serviceUrl: SERVICE, mosaicRule: '{"where":"Year=2023"}' };
    const template = esriImageTemplate(spec)!;
    expect(template.endsWith('&bbox={bbox-epsg-3857}')).toBe(true);
    const filled = template.replace('{bbox-epsg-3857}', paramsOf(esriImageUrl(spec, TILE)!).bbox);
    expect(paramsOf(filled)).toEqual(paramsOf(esriImageUrl(spec, TILE)!));
  });

  it('is null without a service', () => {
    expect(esriImageTemplate({ serviceUrl: ' ' })).toBeNull();
  });
});

describe('a Map Service', () => {
  const USA = 'https://sampleserver6.arcgisonline.com/arcgis/rest/services/USA/MapServer';

  it('is asked to export a picture of each tile, every layer it shows by default', () => {
    const url = esriImageUrl({ serviceUrl: USA }, TILE)!;

    expect(url.startsWith(`${USA}/export?`)).toBe(true);
    const params = paramsOf(url);
    expect(params).toMatchObject({
      bboxSR: '3857',
      imageSR: '3857',
      size: '256,256',
      format: 'png32',
      transparent: 'true',
      f: 'image',
    });
    expect(params).not.toHaveProperty('layers');
    expect(paramsOf(url).bbox).toBe(paramsOf(esriImageUrl({ serviceUrl: SERVICE }, TILE)!).bbox);
  });

  it('shows only the layer its address names, and takes no mosaic or rendering rule', () => {
    const url = esriImageUrl(
      { serviceUrl: `${USA}/2/`, mosaicRule: '{"where":"Year=2023"}', renderingRule: '{}' },
      TILE
    )!;

    expect(url.startsWith(`${USA}/export?`)).toBe(true);
    expect(paramsOf(url)).toMatchObject({ layers: 'show:2' });
    expect(paramsOf(url)).not.toHaveProperty('mosaicRule');
    expect(paramsOf(url)).not.toHaveProperty('renderingRule');
  });

  it('gives MapLibre the same request on a relief', () => {
    expect(esriImageTemplate({ serviceUrl: `${USA}/2` })).toMatch(
      /\/MapServer\/export\?.*layers=show%3A2.*&bbox=\{bbox-epsg-3857\}$/
    );
  });

  it('is told apart from an Image Service by its address', () => {
    expect(mapServiceOf(USA)).toEqual({ endpoint: USA });
    expect(mapServiceOf(`${USA}/12`)).toEqual({ endpoint: USA, layerId: '12' });
    expect(mapServiceOf('https://x.test/arcgis/rest/services/Landcover/ImageServer')).toBeNull();
    expect(mapServiceOf(`${USA}/2/query`)).toBeNull();
  });
});
