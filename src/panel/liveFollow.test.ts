import { LiveFollower, type LiveClocks } from './liveFollow';

const clocks = (over: Partial<LiveClocks>): LiveClocks => ({
  playhead: null,
  animationDomain: null,
  animating: false,
  window: null,
  domain: null,
  windowPlaying: false,
  dataChanged: false,
  ...over,
});

describe('LiveFollower, the trip playhead', () => {
  it('goes to the end of the data on the first rows, where kepler opens on the start', () => {
    const follower = new LiveFollower();
    expect(follower.step(clocks({ playhead: 0, animationDomain: [0, 30_000], dataChanged: true }), false)).toEqual({
      playhead: 30_000,
    });
  });

  it('follows each refresh to the new end, even though the refresh reset it to the start', () => {
    const follower = new LiveFollower();
    follower.step(clocks({ playhead: 0, animationDomain: [0, 30_000], dataChanged: true }), false);
    follower.settled(30_000, null);
    expect(
      follower.step(clocks({ playhead: 1_000, animationDomain: [1_000, 31_000], dataChanged: true }), false)
    ).toEqual({ playhead: 31_000 });
  });

  it('stays where the user drags it, and follows again once it is back at the end', () => {
    const follower = new LiveFollower();
    follower.step(clocks({ playhead: 0, animationDomain: [0, 30_000], dataChanged: true }), false);
    follower.settled(30_000, null);
    // The user drags back to 10 s: same rows, same domain.
    expect(follower.step(clocks({ playhead: 10_000, animationDomain: [0, 30_000] }), false)).toEqual({});
    expect(follower.step(clocks({ playhead: 0, animationDomain: [1_000, 31_000], dataChanged: true }), false)).toEqual(
      {}
    );
    // Back to the end.
    expect(follower.step(clocks({ playhead: 31_000, animationDomain: [1_000, 31_000] }), false)).toEqual({});
    expect(
      follower.step(clocks({ playhead: 1_000, animationDomain: [2_000, 32_000], dataChanged: true }), false)
    ).toEqual({ playhead: 32_000 });
  });

  it('leaves a playing animation alone', () => {
    const follower = new LiveFollower();
    expect(
      follower.step(
        clocks({ playhead: 5_000, animationDomain: [0, 30_000], animating: true, dataChanged: true }),
        false
      )
    ).toEqual({});
  });

  it('waits out the moment of a refresh with no domain', () => {
    const follower = new LiveFollower();
    expect(follower.step(clocks({ playhead: 0, dataChanged: true }), false)).toEqual({});
  });
});

describe('LiveFollower, the time filter window', () => {
  const start = (follower: LiveFollower, window: { from: number; to: number }) =>
    follower.step(clocks({ window, domain: { from: 0, to: 60_000 }, dataChanged: true }), true);

  it('slides a window that ended at the end of the data, keeping its width', () => {
    const follower = new LiveFollower();
    start(follower, { from: 50_000, to: 60_000 });
    expect(
      follower.step(
        clocks({ window: { from: 50_000, to: 60_000 }, domain: { from: 0, to: 65_000 }, dataChanged: true }),
        true
      )
    ).toEqual({ window: { from: 55_000, to: 65_000 } });
  });

  it('keeps a window that covered everything covering everything', () => {
    const follower = new LiveFollower();
    start(follower, { from: 0, to: 60_000 });
    expect(
      follower.step(
        clocks({ window: { from: 0, to: 60_000 }, domain: { from: 2_000, to: 65_000 }, dataChanged: true }),
        true
      )
    ).toEqual({ window: { from: 2_000, to: 65_000 } });
  });

  it('leaves a window the user moved into the past', () => {
    const follower = new LiveFollower();
    start(follower, { from: 50_000, to: 60_000 });
    follower.step(clocks({ window: { from: 10_000, to: 20_000 }, domain: { from: 0, to: 60_000 } }), true);
    expect(
      follower.step(
        clocks({ window: { from: 10_000, to: 20_000 }, domain: { from: 0, to: 65_000 }, dataChanged: true }),
        true
      )
    ).toEqual({});
  });

  it('does not touch the window when the dashboard range drives it', () => {
    const follower = new LiveFollower();
    follower.step(
      clocks({ window: { from: 50_000, to: 60_000 }, domain: { from: 0, to: 60_000 }, dataChanged: true }),
      false
    );
    expect(
      follower.step(
        clocks({ window: { from: 50_000, to: 60_000 }, domain: { from: 0, to: 65_000 }, dataChanged: true }),
        false
      )
    ).toEqual({});
  });
});
