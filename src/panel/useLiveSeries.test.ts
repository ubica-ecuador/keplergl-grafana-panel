import { FieldType, type DataFrame } from '@grafana/data';

import { snapshotFrames } from './useLiveSeries';

const frame = (length: number, time: number[], lat: number[]): DataFrame => ({
  length,
  fields: [
    { name: 'Time', type: FieldType.time, config: {}, values: time },
    { name: 'lat', type: FieldType.number, config: {}, values: lat },
  ],
});

describe('snapshotFrames', () => {
  it('copies each column, cut at the frame length the stream has since grown past', () => {
    // The time column is the stream's buffer: two more instants already landed in it.
    const time = [1, 2, 3, 4, 5];
    const lat = [60.1, 60.2, 60.3];
    const [copy] = snapshotFrames([frame(3, time, lat)]) as DataFrame[];
    expect(copy.fields.map((field) => field.values)).toEqual([
      [1, 2, 3],
      [60.1, 60.2, 60.3],
    ]);
    time.push(6);
    lat.length = 0;
    expect(copy.fields[1].values).toEqual([60.1, 60.2, 60.3]);
  });

  it('is null for frames whose transformed columns Grafana has already emptied', () => {
    expect(snapshotFrames([frame(3, [1, 2, 3], [])])).toBeNull();
  });
});
