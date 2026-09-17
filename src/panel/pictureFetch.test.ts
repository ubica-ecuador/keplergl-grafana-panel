import { createPictureFetch, PictureError, PictureFetchDeps, pictureFetch } from './pictureFetch';
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
