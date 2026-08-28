import { makeSettler } from './settle';

/** Lets the queued microtask run while fake timers hold the clock still. */
const flush = () => Promise.resolve().then(() => undefined);

describe('makeSettler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('never runs the job synchronously', async () => {
    // `schedule` is called from inside kepler's store subscription, and
    // dispatching from there re-enters its reducer. Running the job on the spot
    // looked like an obvious simplification and stopped the clock from moving
    // the map at all.
    const run = jest.fn();
    const settler = makeSettler(200, run);

    settler.schedule();
    expect(run).not.toHaveBeenCalled();

    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst into the run that starts it and one at the end', async () => {
    // The whole point. Dragging the time slider walks the window across every
    // bin between where the drag started and where it ends, and each of those
    // is a scene the map would otherwise fetch a full screen of tiles for.
    // Measured on the Image Service timeline before this existed: one drag
    // across seven years asked for 126 tiles spread over all seven.
    const run = jest.fn();
    const settler = makeSettler(200, run);

    settler.schedule();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i += 1) {
      settler.schedule();
      jest.advanceTimersByTime(20);
    }
    // Still one: everything in the middle of the drag is passed through.
    expect(run).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(200);
    // One more, for wherever the drag ended.
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('acts on the newest state when it makes the trailing run', async () => {
    const seen: number[] = [];
    let value = 0;
    const settler = makeSettler(50, () => seen.push(value));

    value = 1;
    settler.schedule();
    await flush();

    value = 2;
    settler.schedule();
    value = 3;
    settler.schedule();
    jest.advanceTimersByTime(50);

    expect(seen).toEqual([1, 3]);
  });

  it('leads again once it has been quiet for the whole wait', async () => {
    const run = jest.fn();
    const settler = makeSettler(200, run);

    settler.schedule();
    await flush();
    jest.advanceTimersByTime(500);

    settler.schedule();
    await flush();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('drops the run it still owed when it is cancelled', async () => {
    // The hooks cancel on unmount: a panel torn down mid-drag would otherwise
    // dispatch into a kepler store that is no longer there.
    const run = jest.fn();
    const settler = makeSettler(200, run);

    settler.schedule();
    await flush();
    settler.schedule();

    settler.cancel();
    jest.advanceTimersByTime(1000);

    expect(run).toHaveBeenCalledTimes(1);
  });
});
