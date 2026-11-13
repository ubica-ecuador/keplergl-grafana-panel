import { pictureKey } from './pictureKeys';
import { readPictureAssignment, resetPictureStateForTests } from './pictureState';
import { makePhotosLayer, photoAccessor, PhotosDeckLayersFactory } from './photosLayer';

const dataset = {
  fields: [{ name: 'name' }, { name: 'photo' }],
  dataContainer: {
    valueAt: (row: number, column: number) =>
      [
        ['Quito', 'https://x/q.png'],
        ['Loja', ''],
      ][row][column],
  },
};

describe('photoAccessor', () => {
  it('reads each row’s picture from the named column, and nothing where it is empty', () => {
    const photo = photoAccessor(dataset, 'photo');
    expect(photo({ index: 0 })).toBe('https://x/q.png');
    expect(photo({ index: 1 })).toBeNull();
  });

  it('gives nothing when the column is not there', () => {
    expect(photoAccessor(dataset, 'missing')({ index: 0 })).toBeNull();
    expect(photoAccessor(undefined, 'photo')({ index: 0 })).toBeNull();
  });
});

describe('the photos layer’s pictures', () => {
  const urls = [
    'https://x/q.png',
    'javascript:alert(1)',
    '',
    'data:image/png;base64,iVBORw0KGgo=',
    'https://x/q.png',
    'file:///etc/passwd',
  ];
  const photos = {
    fields: [{ name: 'photo' }],
    dataContainer: { valueAt: (row: number) => urls[row] },
  };
  const rows = urls.map((_, index) => ({ index }));

  class FakePointLayer {
    config = {
      dataId: 'd',
      color: [1, 2, 3],
      columns: {},
      visConfig: { photoField: 'photo' } as Record<string, unknown>,
    };
    registerVisConfig(): void {}
    getDefaultDeckLayerProps(): Record<string, unknown> {
      return { id: 'layer-1' };
    }
    formatLayerData(): Record<string, unknown> {
      return { data: rows };
    }
  }

  beforeEach(() => {
    resetPictureStateForTests();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function render() {
    const factory = jest.fn((_args: Parameters<PhotosDeckLayersFactory>[0]) => []);
    const Layer = makePhotosLayer(FakePointLayer, factory as unknown as PhotosDeckLayersFactory);
    const layer = new Layer() as any;
    const data = layer.formatLayerData({ d: photos });
    return { layer, data, factory };
  }

  it('draws a picture only on the rows whose address can load, and frames every row', () => {
    const { layer, data, factory } = render();

    layer.renderLayer({ data });

    const [{ shared, pictured }] = factory.mock.calls[0];
    expect(shared.data).toBe(rows);
    expect(pictured.rows.map((r) => r.index)).toEqual([0, 3, 4]);
    // One icon per address, named by its key: deck is never handed the address itself.
    expect(pictured.keys).toEqual([pictureKey('https://x/q.png', 'center'), pictureKey(urls[3], 'center')]);
    expect(pictured.icons.get(0)?.url).toBe(pictureKey('https://x/q.png', 'center'));
    expect(pictured.icons.get(4)).toBe(pictured.icons.get(0));
  });

  it('tells the layer panel which addresses were refused, and why', () => {
    const { layer, data } = render();

    layer.renderLayer({ data });

    expect(readPictureAssignment(layer)?.failures).toEqual([
      { url: 'javascript:alert(1)', problem: 'scheme' },
      { url: 'file:///etc/passwd', problem: 'scheme' },
    ]);
  });

  it('decides again only when the rows or the picture column change', () => {
    const { layer, data, factory } = render();

    layer.renderLayer({ data });
    layer.renderLayer({ data });
    expect(factory.mock.calls[1][0].pictured).toBe(factory.mock.calls[0][0].pictured);

    layer.config.visConfig = { ...layer.config.visConfig, photoField: 'other' };
    layer.renderLayer({ data: layer.formatLayerData({ d: photos }) });
    expect(factory.mock.calls[2][0].pictured.rows).toEqual([]);
  });
});
