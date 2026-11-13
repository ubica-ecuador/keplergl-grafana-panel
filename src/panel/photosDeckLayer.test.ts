import { PictureIconLayer } from './pictureDeckLayer';
import { pictureFetch } from './pictureFetch';
import { pictureIcon, pictureKey } from './pictureKeys';
import { buildPhotosDeckLayers } from './photosDeckLayer';

const rows = [{ index: 0 }, { index: 1 }];
const icon = pictureIcon('https://x/q.png', 'center');

function build(kind: 'square' | 'circle' = 'square') {
  return buildPhotosDeckLayers({
    shared: { id: 'layer-1', data: rows, updateTriggers: { getPosition: 'columns' } },
    pictured: { rows: [rows[1]], icons: new Map([[1, icon]]), keys: [icon.id] },
    size: 40,
    kind,
    border: 2,
    borderColor: [10, 20, 30],
  }) as any[];
}

describe('buildPhotosDeckLayers', () => {
  it('loads the frames and the pictures through the picture fetch, never through loaders.gl’s own', () => {
    for (const layer of build()) {
      expect(layer).toBeInstanceOf(PictureIconLayer);
      expect(layer.props.loadOptions).toEqual({ core: { fetch: pictureFetch } });
      expect(layer.props.billboard).toBe(true);
    }
  });

  it('frames every row in the layer’s colour, with a mask named by its key', () => {
    const [frame] = build('circle');

    expect(frame.id).toBe('layer-1-frame');
    expect(frame.props.data).toBe(rows);
    expect(frame.props.getColor).toEqual([10, 20, 30]);
    const frameIcon = frame.props.getIcon(rows[0]);
    expect(frameIcon.mask).toBe(true);
    expect(frameIcon.url.startsWith('picture:')).toBe(true);
    expect(frameIcon.url).toBe(frameIcon.id);
  });

  it('draws the pictures on the rows that have one, by key', () => {
    const [, photo] = build();

    expect(photo.id).toBe('layer-1-photo');
    expect(photo.props.data).toEqual([rows[1]]);
    expect(photo.props.getIcon(rows[1]).url).toBe(pictureKey('https://x/q.png', 'center'));
    expect(photo.props.updateTriggers).toEqual({ getPosition: 'columns', getIcon: [icon.id] });
  });

  it('inscribes the picture in a round frame', () => {
    const [frame, photo] = build('circle');

    expect(frame.props.getSize).toBe(44);
    expect(photo.props.getSize).toBeCloseTo(44 * Math.SQRT1_2);
  });
});
