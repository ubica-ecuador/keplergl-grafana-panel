import { pictureKey } from './pictureKeys';
import {
  MAX_PICTURE_OUTCOMES,
  PictureAssignmentStatus,
  readPictureAssignment,
  readPictureOutcomes,
  readPictureVersion,
  recordPictureAssignment,
  recordPictureOutcome,
  resetPictureStateForTests,
  subscribePictures,
  summarisePictures,
} from './pictureState';

const flush = () => Promise.resolve();

/** An assignment as `assignPictures` makes one, for these URLs drawn with a centre anchor. */
function assignment(urls: string[], extra: Partial<PictureAssignmentStatus> = {}): PictureAssignmentStatus {
  return { keys: urls.map((url) => pictureKey(url, 'center')), urls, failures: [], overflow: 0, ...extra };
}

const key = (url: string) => pictureKey(url, 'center');

beforeEach(() => {
  resetPictureStateForTests();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('pictureState', () => {
  it('reports each picture of an assignment as loading until it has an outcome, and each failure with its problem', () => {
    const layer = {};
    recordPictureAssignment(
      layer,
      assignment(['https://a/1.png', 'https://a/2.png'], {
        failures: [{ url: 'javascript:x', problem: 'scheme' }],
        overflow: 2,
      })
    );
    recordPictureOutcome(key('https://a/2.png'), 'https://a/2.png', 'loaded');

    expect(summarisePictures(readPictureAssignment(layer), readPictureOutcomes())).toEqual({
      total: 3,
      loading: 1,
      failed: [{ url: 'javascript:x', problem: 'scheme' }],
      overflow: 2,
    });
  });

  it('keeps apart two layer objects that share a kepler id', () => {
    // A repeated Grafana panel carries the same map config, and so the same layer ids.
    const panelA = { id: 'stations' };
    const panelB = { id: 'stations' };
    recordPictureAssignment(panelA, assignment(['https://a/cat.png']));
    recordPictureAssignment(panelB, assignment(['https://a/dog.png']));
    recordPictureOutcome(key('https://a/dog.png'), 'https://a/dog.png', 'load');

    expect(summarisePictures(readPictureAssignment(panelA), readPictureOutcomes()).failed).toEqual([]);
    expect(summarisePictures(readPictureAssignment(panelB), readPictureOutcomes()).failed).toEqual([
      { url: 'https://a/dog.png', problem: 'load' },
    ]);
  });

  it('still reports a failure when its URL leaves the assignment and comes back', () => {
    const layer = {};
    recordPictureAssignment(layer, assignment(['https://a/broken.png']));
    recordPictureOutcome(key('https://a/broken.png'), 'https://a/broken.png', 'timeout');

    recordPictureAssignment(layer, assignment(['https://a/other.png']));
    // Back again: deck already holds the cell and asks for nothing, so no new outcome arrives.
    recordPictureAssignment(layer, assignment(['https://a/broken.png']));

    expect(summarisePictures(readPictureAssignment(layer), readPictureOutcomes()).failed).toEqual([
      { url: 'https://a/broken.png', problem: 'timeout' },
    ]);
  });

  it('summarises a layer that has not rendered yet as nothing', () => {
    expect(summarisePictures(readPictureAssignment({}), readPictureOutcomes())).toEqual({
      total: 0,
      loading: 0,
      failed: [],
      overflow: 0,
    });
  });

  it('notifies once, after the writes, never inside them', async () => {
    const listener = jest.fn();
    subscribePictures(listener);

    recordPictureAssignment({}, assignment(['https://a/1.png']));
    recordPictureOutcome(key('https://a/1.png'), 'https://a/1.png', 'loaded');
    expect(listener).not.toHaveBeenCalled();

    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('neither notifies nor moves the version when nothing changed', async () => {
    const layer = {};
    const same = assignment(['https://a/1.png']);
    recordPictureAssignment(layer, same);
    recordPictureOutcome(key('https://a/1.png'), 'https://a/1.png', 'loading');
    await flush();
    const listener = jest.fn();
    subscribePictures(listener);
    const version = readPictureVersion();

    recordPictureAssignment(layer, same);
    recordPictureOutcome(key('https://a/1.png'), 'https://a/1.png', 'loading');
    await flush();

    expect(listener).not.toHaveBeenCalled();
    expect(readPictureVersion()).toBe(version);
  });

  it('moves the version on every change', () => {
    const before = readPictureVersion();

    recordPictureAssignment({}, assignment(['https://a/1.png']));

    expect(readPictureVersion()).toBeGreaterThan(before);
  });

  it('stops notifying a listener that unsubscribed', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribePictures(listener);
    unsubscribe();

    recordPictureAssignment({}, assignment(['https://a/1.png']));
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it('warns once per failing picture', () => {
    const layer = {};
    recordPictureAssignment(
      layer,
      assignment(['https://a/1.png'], { failures: [{ url: 'ftp://x', problem: 'scheme' }] })
    );
    recordPictureOutcome(key('https://a/1.png'), 'https://a/1.png', 'load');
    recordPictureAssignment(
      layer,
      assignment(['https://a/1.png'], { failures: [{ url: 'ftp://x', problem: 'scheme' }] })
    );
    recordPictureOutcome(key('https://a/1.png'), 'https://a/1.png', 'loading');
    recordPictureOutcome(key('https://a/1.png'), 'https://a/1.png', 'load');

    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('keeps at most MAX_PICTURE_OUTCOMES outcomes, dropping the least recently written', () => {
    recordPictureOutcome(key('https://a/kept.png'), 'https://a/kept.png', 'loaded');
    recordPictureOutcome(key('https://a/old.png'), 'https://a/old.png', 'loaded');
    for (let i = 0; i < MAX_PICTURE_OUTCOMES - 1; i++) {
      recordPictureOutcome(key(`https://a/${i}.png`), `https://a/${i}.png`, 'loaded');
      // Still being asked for: written again, unchanged.
      recordPictureOutcome(key('https://a/kept.png'), 'https://a/kept.png', 'loaded');
    }

    expect(readPictureOutcomes().size).toBe(MAX_PICTURE_OUTCOMES);
    expect(readPictureOutcomes().has(key('https://a/old.png'))).toBe(false);
    expect(readPictureOutcomes().get(key('https://a/kept.png'))).toBe('loaded');
  });
});
