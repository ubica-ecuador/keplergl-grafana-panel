import {
  checkPictureUrl,
  fitPicture,
  parsePictureKey,
  PICTURE_CELL,
  pictureAnchorOf,
  pictureIcon,
  pictureKey,
} from './pictureKeys';

// loaders.gl's own patterns, copied from `@loaders.gl/images/dist/lib/parsers/svg-utils.js` because the
// module does not export them. A key matching either is decoded as an SVG through a `blob:` URL, which
// Grafana's `img-src * data:` does not allow.
const SVG_URL_PATTERN = /\.svg((\?|#).*)?$/;
const SVG_DATA_URL_PATTERN = /^data:image\/svg\+xml/;

describe('pictureKey', () => {
  const urls = [
    'https://example.org/pin.png',
    'https://example.org/logo.svg',
    'https://example.org/logo.svg?v=2#top',
    '/public/plugins/ubica-keplergl-panel/img/logo-small.svg',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png;base64,iVBORw0KGgo=',
  ];

  it.each(urls)('round-trips %s with either anchor', (url) => {
    expect(parsePictureKey(pictureKey(url, 'center'))).toEqual({ url, anchor: 'center' });
    expect(parsePictureKey(pictureKey(url, 'bottom'))).toEqual({ url, anchor: 'bottom' });
  });

  it.each(urls)('never looks like an SVG to loaders.gl: %s', (url) => {
    const key = pictureKey(url, 'center');
    expect(SVG_URL_PATTERN.test(key)).toBe(false);
    expect(SVG_DATA_URL_PATTERN.test(key)).toBe(false);
  });

  it('keeps the two anchors apart, since they rasterise differently', () => {
    expect(pictureKey('https://a/b.png', 'center')).not.toBe(pictureKey('https://a/b.png', 'bottom'));
  });

  it.each(['', 'picture:center:x', 'picture:left:x:end', 'other:center:x:end', 'picture:center:%E0%A4%A:end'])(
    'refuses %p as a key',
    (key) => {
      expect(parsePictureKey(key)).toBeNull();
    }
  );
});

describe('checkPictureUrl', () => {
  const httpPage = 'http://localhost:3000/';
  const httpsPage = 'https://grafana.example.org/';

  it.each([
    ['https://example.org/pin.png', httpsPage],
    ['http://example.org/pin.png', httpPage],
    ['/public/plugins/ubica-keplergl-panel/img/logo-small.svg', httpsPage],
    ['data:image/png;base64,iVBORw0KGgo=', httpsPage],
    ['DATA:IMAGE/SVG+XML;base64,PHN2Zz48L3N2Zz4=', httpsPage],
  ])('accepts %s on %s', (url, page) => {
    expect(checkPictureUrl(url, page)).toBeNull();
  });

  it('refuses http on an https page: the browser would block it as mixed content', () => {
    expect(checkPictureUrl('http://example.org/pin.png', httpsPage)).toBe('mixed-content');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://example.org/pin.png', '', '   '])(
    'refuses %p',
    (url) => {
      expect(checkPictureUrl(url, httpsPage)).toBe('scheme');
    }
  );
});

describe('fitPicture', () => {
  it('fills the cell with a square picture', () => {
    expect(fitPicture(24, 24, 'center')).toEqual({ x: 0, y: 0, width: 128, height: 128 });
  });

  it('centres a wide picture vertically, or rests it on the bottom', () => {
    expect(fitPicture(200, 100, 'center')).toEqual({ x: 0, y: 32, width: 128, height: 64 });
    expect(fitPicture(200, 100, 'bottom')).toEqual({ x: 0, y: 64, width: 128, height: 64 });
  });

  it('centres a tall picture horizontally, whichever the anchor', () => {
    expect(fitPicture(50, 100, 'center')).toEqual({ x: 32, y: 0, width: 64, height: 128 });
    expect(fitPicture(50, 100, 'bottom')).toEqual({ x: 32, y: 0, width: 64, height: 128 });
  });

  it('treats a picture with no size of its own as square', () => {
    expect(fitPicture(0, 0, 'bottom')).toEqual({ x: 0, y: 0, width: 128, height: 128 });
  });
});

describe('pictureIcon', () => {
  it('declares exactly the cell the fetch paints, anchored where the picture rests', () => {
    const key = pictureKey('https://a/b.png', 'bottom');
    expect(pictureIcon('https://a/b.png', 'bottom')).toEqual({
      id: key,
      url: key,
      width: PICTURE_CELL,
      height: PICTURE_CELL,
      anchorX: 64,
      anchorY: 128,
      mask: false,
    });
    expect(pictureIcon('https://a/b.png', 'center').anchorY).toBe(64);
  });
});

describe('pictureAnchorOf', () => {
  it('reads anything but bottom as center', () => {
    expect(pictureAnchorOf('bottom')).toBe('bottom');
    expect(pictureAnchorOf('left')).toBe('center');
    expect(pictureAnchorOf(undefined)).toBe('center');
  });
});
