import { IconLayer } from '@deck.gl/layers';

import { PictureIconLayer } from './pictureDeckLayer';
import { PictureError, pictureFetch } from './pictureFetch';
import { pictureKey } from './pictureKeys';
import { MAX_PICTURES } from './pictureRows';
import { readPictureOutcomes, resetPictureStateForTests } from './pictureState';
import { buildSymbolDeckLayer } from './symbolDeckLayer';

beforeEach(() => {
  resetPictureStateForTests();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const props = { picture: true, id: 'l1-picture-symbol', data: [], billboard: true };

describe('the picture branch of buildSymbolDeckLayer', () => {
  it('builds an icon layer that packs its own atlas and loads through the picture fetch', () => {
    const layer = buildSymbolDeckLayer(props) as any;

    expect(layer).toBeInstanceOf(PictureIconLayer);
    expect(layer).toBeInstanceOf(IconLayer);
    expect(layer.id).toBe('l1-picture-symbol');
    expect(layer.props.iconAtlas).toBeFalsy();
    expect(layer.props.loadOptions).toEqual({ core: { fetch: pictureFetch } });
    expect(layer.props.sizeUnits).toBe('pixels');
    expect(layer.props.billboard).toBe(true);
  });

  it('hands deck the same load options on every render', () => {
    const first = buildSymbolDeckLayer(props) as any;
    const second = buildSymbolDeckLayer(props) as any;

    expect(second.props.loadOptions).toBe(first.props.loadOptions);
    expect(second.props.onIconError).toBe(first.props.onIconError);
  });

  it('passes none of the glyph atlas’s own props on to deck', () => {
    const layer = buildSymbolDeckLayer({
      ...props,
      symbols: ['arrow'],
      shadow: true,
      outline: 3,
      gradient: 0.5,
    }) as any;

    for (const key of ['picture', 'symbols', 'shadow', 'outline', 'gradient']) {
      expect(layer.props[key]).toBeUndefined();
    }
    expect(layer.props.sizeScale).toBe(1);
  });

  it('records a picture deck could not decode against its key', () => {
    const layer = buildSymbolDeckLayer(props) as any;
    const key = pictureKey('https://a/pin.png', 'center');

    layer.props.onIconError({ url: key, error: new Error('bad bytes') });

    expect(readPictureOutcomes().get(key)).toBe('decode');
  });

  it('keeps the fetch’s own reason when the failure came from the fetch', () => {
    const layer = buildSymbolDeckLayer(props) as any;
    const key = pictureKey('https://a/pin.png', 'center');

    layer.props.onIconError({ url: key, error: new PictureError('timeout') });

    expect(readPictureOutcomes().get(key)).toBe('timeout');
  });
});

describe('PictureIconLayer', () => {
  /** Stands in for deck's `IconManager`, which needs a GPU device. */
  class FakeIconManager {
    finalize = jest.fn();
    constructor(
      readonly device: unknown,
      readonly callbacks: { onUpdate: unknown; onError: unknown }
    ) {}
  }

  /** A layer as deck's layer manager leaves it after `initializeState`. */
  function initialised(): { layer: PictureIconLayer; first: FakeIconManager } {
    const layer = buildSymbolDeckLayer(props) as PictureIconLayer;
    const first = new FakeIconManager('device', { onUpdate: null, onError: null });
    Object.assign(layer, { context: { device: 'device' }, state: { iconManager: first } });
    return { layer, first };
  }

  const pictures = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}` }));
  const getIcon = (row: { key: string }) => ({ id: row.key, url: row.key });
  const managerOf = (layer: PictureIconLayer) => layer.state.iconManager as unknown as FakeIconManager;

  it('keeps its icon manager while every picture it has packed fits the cap', () => {
    const { layer, first } = initialised();

    layer.renewIconManagerIfFull(pictures('a', MAX_PICTURES), getIcon);
    layer.renewIconManagerIfFull(pictures('a', 10), getIcon);

    expect(managerOf(layer)).toBe(first);
    expect(first.finalize).not.toHaveBeenCalled();
  });

  it('frees a full texture and packs into a new icon manager, built as IconLayer builds its own', () => {
    const { layer, first } = initialised();
    layer.renewIconManagerIfFull(pictures('a', MAX_PICTURES), getIcon);

    layer.renewIconManagerIfFull(pictures('b', 1), getIcon);

    const next = managerOf(layer);
    expect(next).not.toBe(first);
    expect(next).toBeInstanceOf(FakeIconManager);
    expect(first.finalize).toHaveBeenCalledTimes(1);
    expect(next.device).toBe('device');
    expect(next.callbacks.onUpdate).toEqual(expect.any(Function));
    expect(next.callbacks.onError).toEqual(expect.any(Function));
  });

  it('counts afresh from the pictures drawn when the new manager began', () => {
    const { layer } = initialised();
    layer.renewIconManagerIfFull(pictures('a', MAX_PICTURES), getIcon);
    layer.renewIconManagerIfFull(pictures('b', 1), getIcon);
    const second = managerOf(layer);

    layer.renewIconManagerIfFull(pictures('b', MAX_PICTURES), getIcon);

    expect(managerOf(layer)).toBe(second);
  });

  it('checks the cap exactly when IconLayer packs icons, and before it packs them', () => {
    const { layer } = initialised();
    const calls: string[] = [];
    jest.spyOn(IconLayer.prototype, 'updateState').mockImplementation(() => void calls.push('pack'));
    jest.spyOn(layer, 'renewIconManagerIfFull').mockImplementation(() => void calls.push('renew'));
    const update = (changeFlags: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      calls.length = 0;
      layer.updateState({ props: { ...layer.props, ...extra }, oldProps: layer.props, changeFlags } as never);
      return [...calls];
    };

    expect(update({ dataChanged: true })).toEqual(['renew', 'pack']);
    expect(update({ updateTriggersChanged: { getIcon: true } })).toEqual(['renew', 'pack']);
    expect(update({ updateTriggersChanged: { all: true } })).toEqual(['renew', 'pack']);
    expect(update({ updateTriggersChanged: { getColor: true } })).toEqual(['pack']);
    expect(update({ propsChanged: true })).toEqual(['pack']);
    expect(update({ dataChanged: true }, { iconAtlas: {} })).toEqual(['pack']);
  });

  it('counts only its own pictures, not another deck layer’s with the same id', () => {
    const panelA = initialised();
    const panelB = initialised();
    panelA.layer.renewIconManagerIfFull(pictures('a', MAX_PICTURES), getIcon);

    panelB.layer.renewIconManagerIfFull(pictures('b', 1), getIcon);
    panelB.layer.renewIconManagerIfFull(pictures('b', 2), getIcon);

    expect(managerOf(panelB.layer)).toBe(panelB.first);
  });
});
