import { pickLatestWithin } from './timeWindow';

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
