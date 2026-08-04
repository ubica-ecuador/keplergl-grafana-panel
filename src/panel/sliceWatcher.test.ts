import { SliceWatcher } from './sliceWatcher';

describe('SliceWatcher', () => {
  const filters = [{ id: 'a' }];
  const datasets = { one: {} };

  it('reports the first observation as a change', () => {
    expect(new SliceWatcher().changed([filters, datasets])).toBe(true);
  });

  it('reports nothing when every slice is the same object', () => {
    const watcher = new SliceWatcher();
    watcher.changed([filters, datasets]);
    expect(watcher.changed([filters, datasets])).toBe(false);
  });

  it('reports a change when one slice is replaced', () => {
    const watcher = new SliceWatcher();
    watcher.changed([filters, datasets]);
    expect(watcher.changed([[{ id: 'a' }], datasets])).toBe(true);
  });

  it('compares by identity, not by contents — a redux reducer only rebuilds what changed', () => {
    const watcher = new SliceWatcher();
    watcher.changed([filters]);
    // Structurally identical but a different array: the reducer rebuilt it, so
    // something in it moved.
    expect(watcher.changed([[{ id: 'a' }]])).toBe(true);
  });

  it('adopts each observation, so an unchanged repeat after a change is quiet', () => {
    const watcher = new SliceWatcher();
    const next = [{ id: 'b' }];
    watcher.changed([filters]);
    watcher.changed([next]);
    expect(watcher.changed([next])).toBe(false);
  });

  it('reports a change when the number of slices differs', () => {
    const watcher = new SliceWatcher();
    watcher.changed([filters, datasets]);
    expect(watcher.changed([filters])).toBe(true);
  });

  it('stays quiet on repeated empty observations, as before kepler registers', () => {
    const watcher = new SliceWatcher();
    expect(watcher.changed([])).toBe(true);
    expect(watcher.changed([])).toBe(false);
  });
});
