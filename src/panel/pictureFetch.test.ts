import {
  createPictureFetch,
  loadPictureImage,
  PictureError,
  PictureFetchDeps,
  pictureFetch,
  PictureImageDeps,
} from './pictureFetch';
import { pictureKey } from './pictureKeys';
import { readPictureOutcomes, resetPictureStateForTests } from './pictureState';

function fakeDeps(overrides: Partial<PictureFetchDeps> = {}) {
  const deps: PictureFetchDeps = {
    pageHref: () => 'http://localhost:3000/',
    loadImage: jest.fn(async () => ({ naturalWidth: 24, naturalHeight: 24 })),
    rasterize: jest.fn(async () => new Blob(['png'])),
    toResponse: jest.fn((blob: Blob) => ({ blob })),
    timeoutMs: 1000,
    ...overrides,
  };
  return deps;
}

describe('createPictureFetch', () => {
  it('loads, rasterises at the anchor the key names, and answers with a response', async () => {
    const deps = fakeDeps();
    const report = jest.fn();

    const response = await createPictureFetch(deps)(pictureKey('https://a/pin.png', 'bottom'), report);

    expect(deps.loadImage).toHaveBeenCalledWith('https://a/pin.png');
    expect(deps.rasterize).toHaveBeenCalledWith({ naturalWidth: 24, naturalHeight: 24 }, 'bottom');
    expect(response).toEqual({ blob: expect.any(Blob) });
    expect(report.mock.calls).toEqual([
      ['https://a/pin.png', 'loading'],
      ['https://a/pin.png', 'loaded'],
    ]);
  });

  it('loads a picture once, however often its key is asked for', async () => {
    const deps = fakeDeps();
    const fetchPicture = createPictureFetch(deps);
    const key = pictureKey('https://a/pin.png', 'center');

    await Promise.all([fetchPicture(key), fetchPicture(key)]);
    await fetchPicture(key);

    expect(deps.loadImage).toHaveBeenCalledTimes(1);
  });

  it('refuses a key it did not make, without loading anything', async () => {
    const deps = fakeDeps();

    await expect(createPictureFetch(deps)('https://a/pin.png')).rejects.toMatchObject({ problem: 'scheme' });
    expect(deps.loadImage).not.toHaveBeenCalled();
  });

  it('refuses an http picture on an https page, and says why', async () => {
    const deps = fakeDeps({ pageHref: () => 'https://grafana.example.org/' });
    const report = jest.fn();

    await expect(createPictureFetch(deps)(pictureKey('http://a/pin.png', 'center'), report)).rejects.toMatchObject({
      problem: 'mixed-content',
    });
    expect(report).toHaveBeenCalledWith('http://a/pin.png', 'mixed-content');
    expect(deps.loadImage).not.toHaveBeenCalled();
  });

  it('reports a picture that does not load, and tries it again next time', async () => {
    const loadImage = jest
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ naturalWidth: 1, naturalHeight: 1 });
    const fetchPicture = createPictureFetch(fakeDeps({ loadImage }));
    const key = pictureKey('https://a/pin.png', 'center');
    const report = jest.fn();

    await expect(fetchPicture(key, report)).rejects.toBeInstanceOf(PictureError);
    expect(report).toHaveBeenLastCalledWith('https://a/pin.png', 'load');

    await expect(fetchPicture(key)).resolves.toBeDefined();
    expect(loadImage).toHaveBeenCalledTimes(2);
  });

  it('gives up on a picture that takes too long', async () => {
    jest.useFakeTimers();
    try {
      const fetchPicture = createPictureFetch(
        fakeDeps({ loadImage: jest.fn(() => new Promise<never>(() => undefined)), timeoutMs: 15_000 })
      );
      const pending = fetchPicture(pictureKey('https://a/slow.png', 'center'));
      const assertion = expect(pending).rejects.toMatchObject({ problem: 'timeout' });

      await jest.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('pictureFetch', () => {
  beforeEach(() => {
    resetPictureStateForTests();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is one function of one argument, as loaders.gl calls it', () => {
    expect(pictureFetch.length).toBe(1);
  });

  it('records how a key loaded against the key, for every panel to read', async () => {
    const key = pictureKey('javascript:alert(1)', 'bottom');

    await expect(pictureFetch(key)).rejects.toMatchObject({ problem: 'scheme' });

    expect(readPictureOutcomes().get(key)).toBe('scheme');
  });
});

describe('loadPictureImage', () => {
  function imageDeps(overrides: Partial<PictureImageDeps> = {}) {
    const deps: PictureImageDeps = {
      pageHref: 'https://grafana.example/d/abc/map',
      appSubUrl: '',
      fetchImpl: jest.fn(async () => ({
        ok: true,
        blob: async () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }),
      })),
      loadElement: jest.fn(async () => ({ naturalWidth: 10, naturalHeight: 10 })),
      ...overrides,
    };
    return deps;
  }

  it('hands a picture on another origin to the image element as it is', async () => {
    const deps = imageDeps();

    await loadPictureImage('https://images.example/a.png', deps);

    expect(deps.fetchImpl).not.toHaveBeenCalled();
    expect(deps.loadElement).toHaveBeenCalledWith('https://images.example/a.png');
  });

  it('hands one of Grafana’s static files to the image element as it is', async () => {
    const deps = imageDeps();

    await loadPictureImage('/public/img/grafana_icon.svg', deps);

    expect(deps.fetchImpl).not.toHaveBeenCalled();
    expect(deps.loadElement).toHaveBeenCalledWith('/public/img/grafana_icon.svg');
  });

  it('fetches any other picture on Grafana’s origin without cookies, and hands it over as a data: URL of its type', async () => {
    const deps = imageDeps();

    const image = await loadPictureImage('/datasets/sites/logo.svg', deps);

    expect(deps.fetchImpl).toHaveBeenCalledWith('/datasets/sites/logo.svg', { credentials: 'omit' });
    const [handed] = (deps.loadElement as jest.Mock).mock.calls[0];
    expect(handed).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(image).toEqual({ naturalWidth: 10, naturalHeight: 10 });
  });

  it('fails as a load when Grafana answers with an error or the request fails', async () => {
    const refused = imageDeps({ fetchImpl: jest.fn(async () => ({ ok: false, blob: async () => new Blob() })) });
    await expect(loadPictureImage('/api/user', refused)).rejects.toEqual(new PictureError('load'));
    expect(refused.loadElement).not.toHaveBeenCalled();

    const offline = imageDeps({
      fetchImpl: jest.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    await expect(loadPictureImage('/api/user', offline)).rejects.toEqual(new PictureError('load'));
  });
});
