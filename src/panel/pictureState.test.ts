import { MAX_PICTURES } from './pictureRows';
import {
  generationFor,
  MAX_TRACKED_LAYERS,
  readPictureStatus,
  recordPictureAssignment,
  recordPictureLoad,
  resetPictureStateForTests,
  subscribePictureStatus,
  summarisePictureStatus,
} from './pictureState';

const flush = () => Promise.resolve();

beforeEach(() => {
  resetPictureStateForTests();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('pictureState', () => {
  it('starts each picture of an assignment as loading, and each failure with its problem', () => {
    recordPictureAssignment('l1', {
      urls: ['https://a/1.png'],
      failures: [{ url: 'javascript:x', problem: 'scheme' }],
      overflow: 2,
    });

    expect(summarisePictureStatus(readPictureStatus('l1'))).toEqual({
      total: 2,
      loading: 1,
      failed: [{ url: 'javascript:x', problem: 'scheme' }],
      overflow: 2,
    });
  });

  it('keeps the same status when the same assignment comes again', () => {
    recordPictureAssignment('l1', { urls: ['https://a/1.png'], failures: [], overflow: 0 });
    recordPictureLoad('l1', 'https://a/1.png', 'loaded');
    const before = readPictureStatus('l1');

    recordPictureAssignment('l1', { urls: ['https://a/1.png'], failures: [], overflow: 0 });

    expect(readPictureStatus('l1')).toBe(before);
    expect(before!.loads.get('https://a/1.png')).toBe('loaded');
  });

  it('forgets a picture the layer no longer draws, and ignores late news of it', () => {
    recordPictureAssignment('l1', { urls: ['https://a/old.png'], failures: [], overflow: 0 });
    recordPictureAssignment('l1', { urls: ['https://a/new.png'], failures: [], overflow: 0 });
    recordPictureLoad('l1', 'https://a/old.png', 'load');

    expect([...readPictureStatus('l1')!.loads.keys()]).toEqual(['https://a/new.png']);
  });

  it('notifies once, after the writes, never inside them', async () => {
    const listener = jest.fn();
    subscribePictureStatus(listener);

    recordPictureAssignment('l1', { urls: ['https://a/1.png'], failures: [], overflow: 0 });
    recordPictureLoad('l1', 'https://a/1.png', 'loaded');
    expect(listener).not.toHaveBeenCalled();

    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when nothing changed', async () => {
    recordPictureAssignment('l1', { urls: ['https://a/1.png'], failures: [], overflow: 0 });
    await flush();
    const listener = jest.fn();
    subscribePictureStatus(listener);

    recordPictureAssignment('l1', { urls: ['https://a/1.png'], failures: [], overflow: 0 });
    recordPictureLoad('l1', 'https://a/1.png', 'loading');
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying a listener that unsubscribed', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribePictureStatus(listener);
    unsubscribe();

    recordPictureAssignment('l1', { urls: ['https://a/1.png'], failures: [], overflow: 0 });
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it('warns once per failing picture', () => {
    recordPictureAssignment('l1', { urls: ['https://a/1.png'], failures: [], overflow: 0 });
    recordPictureLoad('l1', 'https://a/1.png', 'load');
    recordPictureAssignment('l1', { urls: ['https://a/1.png'], failures: [], overflow: 0 });
    recordPictureLoad('l1', 'https://a/1.png', 'load');

    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('tracks at most MAX_TRACKED_LAYERS layers, dropping the oldest', () => {
    for (let i = 0; i <= MAX_TRACKED_LAYERS; i++) {
      recordPictureAssignment(`l${i}`, { urls: ['https://a/1.png'], failures: [], overflow: 0 });
    }

    expect(readPictureStatus('l0')).toBeUndefined();
    expect(readPictureStatus(`l${MAX_TRACKED_LAYERS}`)).toBeDefined();
  });

  it("keeps a layer's generation until what it has drawn overflows the cap", () => {
    const first = Array.from({ length: MAX_PICTURES }, (_, i) => `k${i}`);

    expect(generationFor('l1', first)).toBe(0);
    expect(generationFor('l1', first.slice(0, 10))).toBe(0);
    expect(generationFor('l1', ['k-new'])).toBe(1);
    expect(generationFor('l2', ['k-new'])).toBe(0);
  });

  it('keeps a layer in the map while it keeps rendering unchanged', async () => {
    const assignment = { urls: ['https://a/1.png'], failures: [], overflow: 0 };
    recordPictureAssignment('kept', assignment);
    await flush();
    const keptAfterFirstWrite = readPictureStatus('kept');

    // Record 64 other layers, and re-record 'kept' with the same assignment after each.
    for (let i = 0; i < MAX_TRACKED_LAYERS; i++) {
      recordPictureAssignment(`other${i}`, { urls: ['https://b/1.png'], failures: [], overflow: 0 });
      recordPictureAssignment('kept', assignment);
    }

    // 'kept' should still be in the map and be the same object as after its first write.
    expect(readPictureStatus('kept')).toBe(keptAfterFirstWrite);

    // No-op re-records should not notify listeners.
    await flush();
    const listener = jest.fn();
    subscribePictureStatus(listener);

    recordPictureAssignment('kept', assignment);
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });
});
