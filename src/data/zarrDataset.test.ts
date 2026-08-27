import { FieldType, toDataFrame } from '@grafana/data';

import {
  defaultTimeLabel,
  framesToZarr,
  isPanelZarrId,
  labelForTime,
  zarrCalendarDatasetId,
  zarrDatasetId,
} from './zarrDataset';

const SERVER = 'http://localhost:8088';
const STORE = 'https://ncsa.osn.xsede.org/Pangeo/pangeo-forge/gpcp-feedstock/gpcp.zarr';
const DAY_ONE = Date.UTC(1996, 9, 1);
const DAY_TWO = Date.UTC(1996, 9, 2);

function zarrFrame(
  {
    store = STORE,
    variable = 'precip',
    times,
    labels,
  }: { store?: string; variable?: string; times?: number[]; labels?: string[] } = {},
  refId = 'A'
) {
  const rows = times?.length ?? 1;
  return toDataFrame({
    refId,
    fields: [
      { name: 'zarr_url', type: FieldType.string, values: Array(rows).fill(store) },
      { name: 'zarr_variable', type: FieldType.string, values: Array(rows).fill(variable) },
      ...(times ? [{ name: 'time', type: FieldType.time, values: times }] : []),
      ...(labels ? [{ name: 'zarr_time_label', type: FieldType.string, values: labels }] : []),
    ],
  });
}

describe('framesToZarr', () => {
  it('describes the store and variable a query points at', () => {
    const [zarr] = framesToZarr([zarrFrame()], {}, { serverUrl: SERVER });

    expect(zarr).toMatchObject({
      id: 'grafana-A-zarr',
      serverUrl: SERVER,
      storeUrl: STORE,
      variable: 'precip',
      times: [],
    });
  });

  it('ignores a frame with no zarr columns', () => {
    const plain = toDataFrame({ refId: 'A', fields: [{ name: 'value', type: FieldType.number, values: [1] }] });

    expect(framesToZarr([plain], {}, { serverUrl: SERVER })).toEqual([]);
  });

  it('needs the variable as well as the store', () => {
    // A store is a bag of named arrays. Guessing one would draw something
    // nobody asked for, and TiTiler cannot guess either.
    const noVariable = toDataFrame({
      refId: 'A',
      fields: [{ name: 'zarr_url', type: FieldType.string, values: [STORE] }],
    });

    expect(framesToZarr([noVariable], {}, { serverUrl: SERVER })).toEqual([]);
  });

  it('collects every moment the query offered, oldest first and without repeats', () => {
    const [zarr] = framesToZarr(
      [zarrFrame({ times: [DAY_TWO, DAY_ONE, DAY_TWO] })],
      {},
      { serverUrl: SERVER }
    );

    expect(zarr.times).toEqual([DAY_ONE, DAY_TWO]);
  });

  it('remembers each moment’s exact index label', () => {
    // The label is the store's own, not a rendering of the timestamp: TiTiler
    // hands it to xarray's `.sel`, which matches exactly or answers 500.
    const [zarr] = framesToZarr(
      [
        zarrFrame({
          times: [DAY_ONE, DAY_TWO],
          labels: ['1996-10-01T00:00:00.000000000', '1996-10-02T00:00:00.000000000'],
        }),
      ],
      {},
      { serverUrl: SERVER }
    );

    expect(labelForTime(zarr, DAY_TWO)).toBe('1996-10-02T00:00:00.000000000');
  });

  it('falls back to the timestamp itself when the query names no label', () => {
    const [zarr] = framesToZarr([zarrFrame({ times: [DAY_ONE] })], {}, { serverUrl: SERVER });

    expect(labelForTime(zarr, DAY_ONE)).toBe('1996-10-01T00:00:00.000000000');
  });

  it('has no label for a moment it was never given', () => {
    const [zarr] = framesToZarr([zarrFrame({ times: [DAY_ONE] })], {}, { serverUrl: SERVER });

    expect(labelForTime(zarr, DAY_TWO)).toBeUndefined();
  });

  it('carries the ramp and range the panel options chose', () => {
    const [zarr] = framesToZarr([zarrFrame()], {}, { serverUrl: SERVER, colormap: 'blues', rescale: '0,30' });

    expect(zarr).toMatchObject({ colormap: 'blues', rescale: '0,30' });
  });

  it('lets an override point the role at another column', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'store', type: FieldType.string, values: [STORE] },
        { name: 'zarr_variable', type: FieldType.string, values: ['precip'] },
      ],
    });

    expect(framesToZarr([frame], { A: { zarrUrl: 'store' } }, { serverUrl: SERVER })[0]).toMatchObject({
      storeUrl: STORE,
    });
  });

  it('is switched off by an override of null', () => {
    expect(framesToZarr([zarrFrame()], { A: { zarrUrl: null } }, { serverUrl: SERVER })).toEqual([]);
  });

  it('reads a pyramid’s depth from the query', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'zarr_url', type: FieldType.string, values: [STORE] },
        { name: 'zarr_variable', type: FieldType.string, values: ['precip'] },
        { name: 'zarr_levels', type: FieldType.number, values: [6] },
      ],
    });

    expect(framesToZarr([frame], {}, { serverUrl: SERVER })[0].levels).toBe(6);
  });

  it('is a flat store when the query says nothing about levels', () => {
    expect(framesToZarr([zarrFrame()], {}, { serverUrl: SERVER })[0].levels).toBeUndefined();
  });

  it('splits extra dimension selectors on commas', () => {
    // A store can pin more than one axis — CarbonPlan's demo has a band and a
    // month — and one column holding them all keeps the query readable.
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'zarr_url', type: FieldType.string, values: [STORE] },
        { name: 'zarr_variable', type: FieldType.string, values: ['climate'] },
        { name: 'zarr_sel', type: FieldType.string, values: ['band=tavg, month=1'] },
      ],
    });

    expect(framesToZarr([frame], {}, { serverUrl: SERVER })[0].selectors).toEqual(['band=tavg', 'month=1']);
  });

  it('walks the axis the query names, not necessarily one called time', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'zarr_url', type: FieldType.string, values: [STORE] },
        { name: 'zarr_variable', type: FieldType.string, values: ['climate'] },
        { name: 'zarr_time_dim', type: FieldType.string, values: ['month'] },
        { name: 'time', type: FieldType.time, values: [DAY_ONE] },
        { name: 'zarr_time_label', type: FieldType.string, values: ['7'] },
      ],
    });

    const [zarr] = framesToZarr([frame], {}, { serverUrl: SERVER });
    expect(zarr.dimension).toBe('month');
    expect(labelForTime(zarr, DAY_ONE)).toBe('7');
  });

  it('does not invent a timestamp label for an axis that is not time', () => {
    // A store holding months as 1..12 answers to `7`, never to
    // `1996-10-01T00:00:00.000000000`. Guessing there would send a label the
    // store cannot match and every tile would come back 500.
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'zarr_url', type: FieldType.string, values: [STORE] },
        { name: 'zarr_variable', type: FieldType.string, values: ['climate'] },
        { name: 'zarr_time_dim', type: FieldType.string, values: ['month'] },
        { name: 'time', type: FieldType.time, values: [DAY_ONE] },
      ],
    });

    expect(labelForTime(framesToZarr([frame], {}, { serverUrl: SERVER })[0], DAY_ONE)).toBeUndefined();
  });

  it('draws nothing when no tile server is configured', () => {
    // A Zarr store is a bag of compressed chunks, not tiles. With no TiTiler to
    // ask, the honest answer is no layer — the same call `framesToRasters`
    // makes for a COG without a server.
    expect(framesToZarr([zarrFrame()], {}, { serverUrl: '  ' })).toEqual([]);
  });
});

describe('defaultTimeLabel', () => {
  it('writes a timestamp the way numpy stamps a datetime64', () => {
    // xarray prints its index labels with nanosecond precision, and that is the
    // spelling `.sel` matches.
    expect(defaultTimeLabel(DAY_ONE)).toBe('1996-10-01T00:00:00.000000000');
  });

  it('keeps the time of day, which is what a date-only label loses', () => {
    // MUR SST is stamped at 09:00; asking it for `2015-01-05` answers 500.
    expect(defaultTimeLabel(Date.UTC(2015, 0, 5, 9))).toBe('2015-01-05T09:00:00.000000000');
  });
});

describe('ids', () => {
  it('names each query’s dataset apart from its table and its calendar', () => {
    expect(zarrDatasetId('B')).toBe('grafana-B-zarr');
    expect(zarrCalendarDatasetId('grafana-B-zarr')).toBe('grafana-B-zarr-times');
    expect(isPanelZarrId('grafana-B-zarr')).toBe(true);
    expect(isPanelZarrId('grafana-B-zarr-times')).toBe(true);
    expect(isPanelZarrId('grafana-B-wms')).toBe(false);
    expect(isPanelZarrId('a-tileset-someone-added-zarr')).toBe(false);
  });
});
