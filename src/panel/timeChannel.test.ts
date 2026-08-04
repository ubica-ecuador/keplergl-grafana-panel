import { createTimeChannel } from './timeChannel';

/**
 * Panels on one dashboard cannot see each other's kepler stores, and routing a
 * playhead through the Grafana time range costs a full round of queries per
 * frame — measured at ~9 a second on a two-panel dashboard. They do, however,
 * share this module: every instance of the panel on a page loads the same
 * chunk, so a plain in-memory bus reaches all of them with no round trip.
 */
describe('createTimeChannel', () => {
  it('delivers a message to the other subscribers', () => {
    const channel = createTimeChannel();
    const received: unknown[] = [];
    channel.subscribe('b', (msg) => received.push(msg));

    channel.publish({ senderId: 'a', filter: { from: 1, to: 2 } });

    expect(received).toEqual([{ senderId: 'a', filter: { from: 1, to: 2 } }]);
  });

  it('never delivers a message back to its sender', () => {
    // The sender applying its own message is how an echo loop starts: it would
    // re-read the value it just wrote and publish it again, forever.
    const channel = createTimeChannel();
    const received: unknown[] = [];
    channel.subscribe('a', (msg) => received.push(msg));

    channel.publish({ senderId: 'a', playhead: 1000 });

    expect(received).toEqual([]);
  });

  it('reaches every other subscriber, not just the first', () => {
    const channel = createTimeChannel();
    const b: unknown[] = [];
    const c: unknown[] = [];
    channel.subscribe('b', (m) => b.push(m));
    channel.subscribe('c', (m) => c.push(m));

    channel.publish({ senderId: 'a', playhead: 7 });

    expect(b).toHaveLength(1);
    expect(c).toHaveLength(1);
  });

  it('stops delivering once a subscriber leaves', () => {
    // Panels are unmounted whenever the user edits one or switches dashboards;
    // a stale subscriber would dispatch into a dead store.
    const channel = createTimeChannel();
    const received: unknown[] = [];
    const unsubscribe = channel.subscribe('b', (m) => received.push(m));

    unsubscribe();
    channel.publish({ senderId: 'a', playhead: 7 });

    expect(received).toEqual([]);
  });

  it('hands out an id per instance', () => {
    const channel = createTimeChannel();

    expect(channel.nextId()).not.toBe(channel.nextId());
  });
});

/**
 * The publishing map is not always the map being played: with peer sync on, one
 * map's animation arrives at the others as an ordinary filter change, and their
 * own `isAnimating` stays false. So whether the shared clock is running has to
 * travel on the bus, or a follower cannot tell playback from a drag.
 */
describe('anyPlaying', () => {
  it('is false on a channel nobody has joined', () => {
    expect(createTimeChannel().anyPlaying()).toBe(false);
  });

  it('is false while the senders are only moving their clock by hand', () => {
    const channel = createTimeChannel();
    channel.subscribe('a', () => undefined);
    channel.publish({ senderId: 'a', filter: { from: 1, to: 2 } });
    expect(channel.anyPlaying()).toBe(false);
  });

  it('reports a sender that says it is playing', () => {
    const channel = createTimeChannel();
    channel.subscribe('a', () => undefined);
    channel.publish({ senderId: 'a', playing: true, filter: { from: 1, to: 2 } });
    expect(channel.anyPlaying()).toBe(true);
  });

  it('clears once that sender says it stopped', () => {
    const channel = createTimeChannel();
    channel.subscribe('a', () => undefined);
    channel.publish({ senderId: 'a', playing: true });
    channel.publish({ senderId: 'a', playing: false });
    expect(channel.anyPlaying()).toBe(false);
  });

  it('stays true while any one sender is still playing', () => {
    const channel = createTimeChannel();
    channel.subscribe('a', () => undefined);
    channel.subscribe('b', () => undefined);
    channel.publish({ senderId: 'a', playing: true });
    channel.publish({ senderId: 'b', playing: false });
    expect(channel.anyPlaying()).toBe(true);
  });

  it('forgets a sender that leaves mid-animation, so its silence cannot outlive it', () => {
    const channel = createTimeChannel();
    const leave = channel.subscribe('a', () => undefined);
    channel.publish({ senderId: 'a', playing: true });
    leave();
    expect(channel.anyPlaying()).toBe(false);
  });
});
