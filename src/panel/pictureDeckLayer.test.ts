import { IconLayer } from '@deck.gl/layers';

import { PictureError, pictureFetchFor } from './pictureFetch';
import { pictureKey } from './pictureKeys';
import { readPictureStatus, recordPictureAssignment, resetPictureStateForTests } from './pictureState';
import { buildSymbolDeckLayer } from './symbolDeckLayer';

beforeEach(() => {
  resetPictureStateForTests();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const props = { picture: true, keplerLayerId: 'l1', id: 'l1-p0-symbol', data: [], billboard: true };

describe('the picture branch of buildSymbolDeckLayer', () => {
  it('builds an icon layer that packs its own atlas and loads through the picture fetch', () => {
    const layer = buildSymbolDeckLayer(props) as any;

    expect(layer).toBeInstanceOf(IconLayer);
    expect(layer.id).toBe('l1-p0-symbol');
    expect(layer.props.iconAtlas).toBeFalsy();
    expect(layer.props.loadOptions).toEqual({ core: { fetch: pictureFetchFor('l1') } });
    expect(layer.props.sizeUnits).toBe('pixels');
    expect(layer.props.billboard).toBe(true);
  });

  it('passes none of the glyph atlas’s own props on to deck', () => {
    const layer = buildSymbolDeckLayer({
      ...props,
      symbols: ['arrow'],
      shadow: true,
      outline: 3,
      gradient: 0.5,
    }) as any;

    for (const key of ['picture', 'keplerLayerId', 'symbols', 'shadow', 'outline', 'gradient']) {
      expect(layer.props[key]).toBeUndefined();
    }
    expect(layer.props.sizeScale).toBe(1);
  });

  it('records a picture deck could not decode against its layer', () => {
    recordPictureAssignment('l1', { urls: ['https://a/pin.png'], failures: [], overflow: 0 });
    const layer = buildSymbolDeckLayer(props) as any;

    layer.props.onIconError({ url: pictureKey('https://a/pin.png', 'center'), error: new Error('bad bytes') });

    expect(readPictureStatus('l1')!.loads.get('https://a/pin.png')).toBe('decode');
  });

  it('keeps the fetch’s own reason when the failure came from the fetch', () => {
    recordPictureAssignment('l1', { urls: ['https://a/pin.png'], failures: [], overflow: 0 });
    const layer = buildSymbolDeckLayer(props) as any;

    layer.props.onIconError({ url: pictureKey('https://a/pin.png', 'center'), error: new PictureError('timeout') });

    expect(readPictureStatus('l1')!.loads.get('https://a/pin.png')).toBe('timeout');
  });
});
