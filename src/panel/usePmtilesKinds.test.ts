import { act, renderHook, waitFor } from '@testing-library/react';

import { fetchPmtilesHeader as fetchHeader } from '../data/pmtilesHeader';
import type { XyzDataset } from '../data/xyzDataset';
import { archivesOf, forgetPmtilesHeaders, resolvePmtiles, usePmtilesKinds } from './usePmtilesKinds';

jest.mock('../data/pmtilesHeader', () => ({ fetchPmtilesHeader: jest.fn() }));
const fetchPmtilesHeader = jest.mocked(fetchHeader);

const ARCHIVE = 'https://data.test/3dbag.pmtiles';
const archive: XyzDataset = { id: 'grafana-A-tiles', label: 'services', url: ARCHIVE, format: 'pmtiles', bbox: null };
const pictures: XyzDataset = {
  id: 'grafana-B-tiles',
  label: 'Query B',
  url: 'https://t.test/{z}/{x}/{y}.png',
  bbox: null,
};
const NL: [number, number, number, number] = [3.35, 50.75, 7.23, 53.5];

describe('resolvePmtiles', () => {
  it('keeps what is no archive, and an archive once its header is read, with its box', () => {
    const { layers, unread } = resolvePmtiles([archive, pictures], {
      [ARCHIVE]: { header: { kind: 'vector', bbox: NL } },
    });

    expect(layers).toEqual([{ ...archive, pmtilesKind: 'vector', bbox: NL }, pictures]);
    expect(unread).toEqual([]);
  });

  it('keeps the box the query gave over the header’s', () => {
    const boxed = { ...archive, bbox: [4, 52, 5, 53] as [number, number, number, number] };
    const { layers } = resolvePmtiles([boxed], { [ARCHIVE]: { header: { kind: 'raster', bbox: NL } } });
    expect(layers).toEqual([{ ...boxed, pmtilesKind: 'raster' }]);
  });

  it('leaves an archive off until its header is read, and says when it could not be', () => {
    expect(resolvePmtiles([archive, pictures], {})).toEqual({ layers: [pictures], unread: [] });
    expect(resolvePmtiles([archive], { [ARCHIVE]: { error: 'the archive answered 403 Forbidden' } })).toEqual({
      layers: [],
      unread: [
        'services (query A) gives a PMTiles archive this map could not read: the archive answered 403 Forbidden.',
      ],
    });
  });

  it('names each archive once', () => {
    expect(archivesOf([archive, { ...archive, id: 'grafana-C-tiles' }, pictures])).toEqual([ARCHIVE]);
  });
});

describe('usePmtilesKinds', () => {
  beforeEach(() => {
    forgetPmtilesHeaders();
    fetchPmtilesHeader.mockReset();
  });

  it('reads each archive once, and hands the layers on once it has', async () => {
    fetchPmtilesHeader.mockResolvedValue({ kind: 'raster', bbox: NL });
    const { result, rerender } = renderHook(({ layers }) => usePmtilesKinds(layers), {
      initialProps: { layers: [archive, pictures] },
    });
    expect(result.current.layers).toEqual([pictures]);

    await waitFor(() => expect(result.current.layers).toHaveLength(2));
    expect(result.current.layers[0]).toMatchObject({ pmtilesKind: 'raster', bbox: NL });

    rerender({ layers: [{ ...archive }, pictures] });
    await act(async () => undefined);
    expect(fetchPmtilesHeader).toHaveBeenCalledTimes(1);
  });

  it('says an archive it could not read, and asks again when the query answers anew', async () => {
    fetchPmtilesHeader.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result, rerender } = renderHook(({ layers }) => usePmtilesKinds(layers), {
      initialProps: { layers: [archive] },
    });

    await waitFor(() =>
      expect(result.current.unread).toEqual([
        'services (query A) gives a PMTiles archive this map could not read: the request failed (offline, or refused by CORS).',
      ])
    );

    fetchPmtilesHeader.mockResolvedValueOnce({ kind: 'vector', bbox: null });
    rerender({ layers: [{ ...archive }] });
    await waitFor(() => expect(result.current.layers).toHaveLength(1));
    expect(result.current.unread).toEqual([]);
    expect(fetchPmtilesHeader).toHaveBeenCalledTimes(2);
  });
});
