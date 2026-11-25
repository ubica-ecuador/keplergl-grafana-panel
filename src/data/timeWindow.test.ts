import { pickAsOf, pickLatestWithin } from './timeWindow';

const at = (time: number | null) => ({ time });
const timeOf = (item: { time: number | null }) => item.time;

describe('pickLatestWithin', () => {
  it('takes the most recent item inside the window', () => {
    const items = [at(100), at(200), at(300)];

    expect(pickLatestWithin(items, timeOf, { from: 0, to: 250 })).toEqual(at(200));
  });

  it('takes the newest of all when there is no window yet', () => {
    // What a map should open on: the freshest thing there is.
    expect(pickLatestWithin([at(100), at(300), at(200)], timeOf, null)).toEqual(at(300));
  });

  it('answers null for a window that contains nothing', () => {
    // A real state rather than an error: the satellite did not pass, the
    // service has no picture of that hour. The caller decides what to do.
    expect(pickLatestWithin([at(100), at(300)], timeOf, { from: 150, to: 250 })).toBeNull();
  });

  it('includes both ends of the window', () => {
    expect(pickLatestWithin([at(100)], timeOf, { from: 100, to: 100 })).toEqual(at(100));
  });

  it('skips undated items rather than treating them as ancient', () => {
    expect(pickLatestWithin([at(null), at(100)], timeOf, { from: 0, to: 200 })).toEqual(at(100));
    expect(pickLatestWithin([at(null)], timeOf, null)).toBeNull();
  });

  it('does not need the list sorted', () => {
    expect(pickLatestWithin([at(300), at(100), at(200)], timeOf, { from: 0, to: 250 })).toEqual(at(200));
  });

  it('takes an item that lasts when its span touches the window', () => {
    const years = [
      { time: 100, end: 199 },
      { time: 200, end: 299 },
      { time: 300, end: 399 },
    ];
    const endOf = (item: { end: number }) => item.end;
    expect(pickLatestWithin(years, timeOf, { from: 230, to: 260 }, endOf)).toEqual(years[1]);
    expect(pickLatestWithin(years, timeOf, { from: 150, to: 260 }, endOf)).toEqual(years[1]);
    expect(pickLatestWithin(years, timeOf, { from: 400, to: 500 }, endOf)).toBeNull();
    // Without the end the same window holds no start, and nothing is drawn.
    expect(pickLatestWithin(years, timeOf, { from: 230, to: 260 })).toBeNull();
  });
});

describe('pickAsOf', () => {
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const monthly = ['2025-05-15', '2025-06-15', '2025-07-15'].map((d) => ({ at: day(d) }));
  const at = (item: { at: number } | null) => (item ? new Date(item.at).toISOString().slice(0, 10) : null);

  it('takes the most recent inside the window', () => {
    expect(at(pickAsOf(monthly, (m) => m.at, { from: day('2025-05-01'), to: day('2025-07-01') }))).toBe('2025-06-15');
  });

  it('takes the most recent before a window that holds none', () => {
    expect(at(pickAsOf(monthly, (m) => m.at, { from: day('2025-06-20'), to: day('2025-07-10') }))).toBe('2025-06-15');
    expect(at(pickAsOf(monthly, (m) => m.at, { from: day('2026-01-01'), to: day('2026-02-01') }))).toBe('2025-07-15');
  });

  it('takes nothing for a window before every item, and the newest with no window', () => {
    expect(pickAsOf(monthly, (m) => m.at, { from: day('2024-01-01'), to: day('2024-02-01') })).toBeNull();
    expect(at(pickAsOf(monthly, (m) => m.at, null))).toBe('2025-07-15');
  });

  it('keeps an item that lasts into the window over a later one already over', () => {
    const items = [
      { at: day('2025-01-01'), end: day('2025-12-31') },
      { at: day('2025-03-01'), end: day('2025-03-02') },
    ];
    const picked = pickAsOf(
      items,
      (m) => m.at,
      { from: day('2025-06-01'), to: day('2025-06-10') },
      (m) => m.end
    );
    expect(picked).toBe(items[0]);
  });
});
