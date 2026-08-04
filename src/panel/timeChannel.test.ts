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
