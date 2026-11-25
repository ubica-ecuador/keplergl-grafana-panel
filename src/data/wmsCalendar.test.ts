import { findTimeExtent, parseTimeExtent } from './wmsCalendar';

const ms = (iso: string) => Date.parse(iso);

describe('parseTimeExtent', () => {
  it('reads a comma-separated list, which is what GeoServer publishes', () => {
    const extent = '2026-08-23T00:00:00.000Z,2026-08-24T00:00:00.000Z,2026-08-25T00:00:00.000Z';

    expect(parseTimeExtent(extent)).toEqual([
      ms('2026-08-23T00:00:00.000Z'),
      ms('2026-08-24T00:00:00.000Z'),
      ms('2026-08-25T00:00:00.000Z'),
    ]);
  });

  it('expands a start/end/period interval, which is what MapServer publishes', () => {
    expect(parseTimeExtent('2026-08-23T00:00:00Z/2026-08-25T00:00:00Z/P1D')).toEqual([
      ms('2026-08-23T00:00:00Z'),
      ms('2026-08-24T00:00:00Z'),
      ms('2026-08-25T00:00:00Z'),
    ]);
  });

  it('understands an hourly period', () => {
    expect(parseTimeExtent('2026-08-25T00:00:00Z/2026-08-25T03:00:00Z/PT1H')).toHaveLength(4);
  });

  it('steps months by the calendar rather than by thirty days', () => {
    const months = parseTimeExtent('2026-01-31T00:00:00Z/2026-03-31T00:00:00Z/P1M');

    // Adding a month to 31 January cannot land on 31 February. Walking from the
    // start each time — rather than adding to the previous result — keeps the
    // series from drifting into March and staying there.
    expect(months).toEqual([ms('2026-01-31T00:00:00Z'), ms('2026-02-28T00:00:00Z'), ms('2026-03-31T00:00:00Z')]);
  });

  it('mixes the two forms, which the standard allows', () => {
    const extent = '2026-01-01T00:00:00Z,2026-08-23T00:00:00Z/2026-08-25T00:00:00Z/P1D';

    expect(parseTimeExtent(extent)).toHaveLength(4);
  });

  it('sorts and removes repeats', () => {
    expect(parseTimeExtent('2026-08-25T00:00:00Z,2026-08-23T00:00:00Z,2026-08-25T00:00:00Z')).toEqual([
      ms('2026-08-23T00:00:00Z'),
      ms('2026-08-25T00:00:00Z'),
    ]);
  });

  it('caps a runaway interval rather than filling memory', () => {
    // A decade at one-second resolution is a legal extent and an unusable one:
    // it would be three hundred million timestamps in a redux store. The cap
    // keeps the newest end, because that is where a map opens.
    const capped = parseTimeExtent('2016-01-01T00:00:00Z/2026-01-01T00:00:00Z/PT1S', 500);

    expect(capped).toHaveLength(500);
    expect(capped[capped.length - 1]).toBe(ms('2026-01-01T00:00:00Z'));
  });

  it('answers nothing for an extent it cannot read, rather than guessing', () => {
    expect(parseTimeExtent('')).toEqual([]);
    expect(parseTimeExtent('current')).toEqual([]);
    expect(parseTimeExtent('2026-08-23T00:00:00Z/2026-08-25T00:00:00Z/P')).toEqual([]);
  });
});

describe('findTimeExtent', () => {
  const caps = {
    layers: [
      {
        name: 'root',
        layers: [
          { name: 'plain' },
          {
            name: 'rain',
            dimensions: [
              { name: 'elevation', extent: '0' },
              { name: 'time', extent: '2026-08-25T00:00:00Z' },
            ],
          },
        ],
      },
    ],
  };

  it('finds a nested layer by name', () => {
    expect(findTimeExtent(caps, 'rain')).toBe('2026-08-25T00:00:00Z');
  });

  it('answers null for a layer with no time dimension, or no layer at all', () => {
    expect(findTimeExtent(caps, 'plain')).toBeNull();
    expect(findTimeExtent(caps, 'absent')).toBeNull();
    expect(findTimeExtent(null, 'rain')).toBeNull();
  });
});

describe('parseTimeExtent within a window', () => {
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`);

  it('reads the instants of a long interval in the window, not the newest of the service', () => {
    // GIBS IMERG: half-hourly since 1998, far beyond the limit.
    const times = parseTimeExtent('1998-01-01T00:00:00Z/2026-11-24T19:30:00Z/PT30M', 2000, {
      from: Date.parse('2025-01-10T00:00:00Z'),
      to: Date.parse('2025-01-10T06:00:00Z'),
    });
    expect(times).toHaveLength(13);
    expect(times[0]).toBe(Date.parse('2025-01-10T00:00:00Z'));
    expect(times[12]).toBe(Date.parse('2025-01-10T06:00:00Z'));
  });

  it('keeps the dates of a list in the window', () => {
    expect(
      parseTimeExtent('2025-01-01,2025-02-01,2025-03-01', 2000, { from: day('2025-01-15'), to: day('2025-03-01') })
    ).toEqual([day('2025-02-01'), day('2025-03-01')]);
  });

  it('reads nothing of a window the extent does not reach', () => {
    expect(
      parseTimeExtent('2025-01-01/2025-01-31/P1D', 2000, { from: day('2024-01-01'), to: day('2024-02-01') })
    ).toEqual([]);
  });
});
