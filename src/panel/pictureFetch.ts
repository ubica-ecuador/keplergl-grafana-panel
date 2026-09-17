import {
  checkPictureUrl,
  fitPicture,
  parsePictureKey,
  PICTURE_CELL,
  PictureAnchor,
  PictureProblem,
} from './pictureKeys';
import { MAX_TRACKED_LAYERS, PictureLoad, recordPictureLoad } from './pictureState';

/**
 * The fetch loaders.gl calls for a symbol picture, which never fetches.
 *
 * deck's auto-packing `IconLayer` loads each icon with `load(url, loadOptions)`,
 * and loaders.gl `fetch`es every URL it is given — `data:` ones included. Under
 * Grafana's strict CSP that is `connect-src`, which has no `data:` and would
 * need every picture host listed. Handed this function as `core.fetch`,
 * loaders.gl calls it instead: the picture is loaded by an `<img>`, which only
 * `img-src * data:` governs, painted into its cell, and answered as a PNG that
 * loaders.gl decodes with `createImageBitmap` — no URL, so no CSP either.
 */

export const PICTURE_TIMEOUT_MS = 15_000;
export const PICTURE_CACHE_SIZE = 256;

export class PictureError extends Error {
  constructor(readonly problem: PictureProblem) {
    super(`symbol picture: ${problem}`);
    this.name = 'PictureError';
  }
}

export interface PictureImage {
  naturalWidth: number;
  naturalHeight: number;
}

/** What the fetch needs from a browser, injected so the decisions can be tested in jsdom. */
export interface PictureFetchDeps {
  pageHref(): string;
  loadImage(url: string): Promise<PictureImage>;
  rasterize(image: PictureImage, anchor: PictureAnchor): Promise<Blob>;
  toResponse(blob: Blob): unknown;
  timeoutMs: number;
}

type Reporter = (url: string, load: PictureLoad) => void;

export function createPictureFetch(deps: PictureFetchDeps) {
  // Promises rather than results, so two layers asking at once load once.
  const cache = new Map<string, Promise<Blob>>();

  const withTimeout = <T>(promise: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PictureError('timeout')), deps.timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };

  const blobFor = (key: string, url: string, anchor: PictureAnchor): Promise<Blob> => {
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const made = withTimeout(deps.loadImage(url)).then((image) => deps.rasterize(image, anchor));
    cache.set(key, made);
    if (cache.size > PICTURE_CACHE_SIZE) {
      cache.delete(cache.keys().next().value as string);
    }
    // A failure is not remembered: the next generation, anchor or page load tries again.
    made.catch(() => {
      if (cache.get(key) === made) {
        cache.delete(key);
      }
    });
    return made;
  };

  return async function fetchPicture(key: string, report: Reporter = () => undefined): Promise<unknown> {
    const parsed = parsePictureKey(key);
    if (!parsed) {
      throw new PictureError('scheme');
    }
    // Checked again although the layer already left such rows out: this is
    // the last thing between a string and the network.
    const problem = checkPictureUrl(parsed.url, deps.pageHref());
    if (problem) {
      report(parsed.url, problem);
      throw new PictureError(problem);
    }

    report(parsed.url, 'loading');
    try {
      const blob = await blobFor(key, parsed.url, parsed.anchor);
      report(parsed.url, 'loaded');
      return deps.toResponse(blob);
    } catch (error) {
      const failure = error instanceof PictureError ? error : new PictureError('load');
      report(parsed.url, failure.problem);
      throw failure;
    }
  };
}

function loadImageInBrowser(url: string): Promise<PictureImage> {
  const image = new Image();
  // Anonymous, so a server that allows cross-origin use gives WebGL a picture
  // it may upload, and one that does not fails here — rather than tainting the
  // canvas below, which WebGL would refuse without a word about why.
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  image.src = url;
  return image.decode().then(
    () => image,
    () => Promise.reject(new PictureError('load'))
  );
}

function rasterizeInBrowser(image: PictureImage, anchor: PictureAnchor): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = PICTURE_CELL;
  canvas.height = PICTURE_CELL;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Promise.reject(new PictureError('decode'));
  }
  const rect = fitPicture(image.naturalWidth, image.naturalHeight, anchor);
  ctx.drawImage(image as HTMLImageElement, rect.x, rect.y, rect.width, rect.height);
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new PictureError('decode'))), 'image/png');
    } catch {
      // A tainted canvas throws a SecurityError: a cross-origin picture after all.
      reject(new PictureError('load'));
    }
  });
}

const fetchInBrowser = createPictureFetch({
  pageHref: () => (typeof location === 'undefined' ? 'https://localhost/' : location.href),
  loadImage: loadImageInBrowser,
  rasterize: rasterizeInBrowser,
  toResponse: (blob) => new Response(blob, { headers: { 'Content-Type': 'image/png' } }),
  timeoutMs: PICTURE_TIMEOUT_MS,
});

const perLayer = new Map<string, (key: string) => Promise<unknown>>();

/**
 * The fetch one layer hands deck, reporting to that layer's status.
 *
 * One function per layer, kept: a stable identity for deck's props, and a
 * single argument, since loaders.gl calls `fetch(url)` and a second argument
 * would arrive as the reporter.
 */
export function pictureFetchFor(layerId: string): (key: string) => Promise<unknown> {
  const hit = perLayer.get(layerId);
  if (hit) {
    // Re-insert so eviction below drops the layer least recently asked for,
    // not the first one this panel ever rendered.
    perLayer.delete(layerId);
    perLayer.set(layerId, hit);
    return hit;
  }
  const fetchForLayer = (key: string) => fetchInBrowser(key, (url, load) => recordPictureLoad(layerId, url, load));
  perLayer.set(layerId, fetchForLayer);
  if (perLayer.size > MAX_TRACKED_LAYERS) {
    perLayer.delete(perLayer.keys().next().value as string);
  }
  return fetchForLayer;
}
