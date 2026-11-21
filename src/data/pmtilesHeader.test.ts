import { fetchPmtilesHeader, parsePmtilesHeader, PMTILES_HEADER_LENGTH } from './pmtilesHeader';

/** The first 127 bytes of 3D BAG's archive on Source Cooperative (portolan-nl): vector tiles, levels 0–15. */
const BAG_HEADER =
  '504d54696c6573037f000000000000007700000000000000f600000000000000d20e000000000000c80f000000000000ba9b0200' +
  '0000000082ab02000000000044e73749000000007f2c0100000000007f2c0100000000007f2c01000000000001020201000fcc4b' +
  'ff01e9e33f1ef70e4f04629fe31f0f46f38c02d42f0a1f';

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));

describe('parsePmtilesHeader', () => {
  it('reads what an archive holds, its levels and its box', () => {
    const header = parsePmtilesHeader(bytes(BAG_HEADER));

    expect(header).toEqual({
      kind: 'vector',
      minZoom: 0,
      maxZoom: 15,
      bbox: [
        expect.closeTo(3.35083, 5),
        expect.closeTo(50.7503593, 5),
        expect.closeTo(7.229, 3),
        expect.closeTo(53.5011, 3),
      ],
    });
  });

  it('tells pictures from vector tiles by the tile type', () => {
    for (const [type, kind] of [
      [0, 'vector'],
      [1, 'vector'],
      [2, 'raster'],
      [3, 'raster'],
      [4, 'raster'],
      [5, 'raster'],
    ] as const) {
      const header = bytes(BAG_HEADER);
      header[99] = type;
      expect(parsePmtilesHeader(header)?.kind).toBe(kind);
    }
  });

  it('gives no box for one the archive leaves empty, and takes version 2 for vector tiles', () => {
    const header = bytes(BAG_HEADER);
    header.fill(0, 102, 118);
    expect(parsePmtilesHeader(header)?.bbox).toBeNull();

    expect(parsePmtilesHeader(Uint8Array.from([0x50, 0x4d, 2, 0]))).toEqual({ kind: 'vector', bbox: null });
  });

  it('is nothing for bytes that are no archive, or too few of them', () => {
    expect(parsePmtilesHeader(new TextEncoder().encode('<html>Not found</html>'))).toBeNull();
    expect(parsePmtilesHeader(bytes(BAG_HEADER).subarray(0, 60))).toBeNull();
    const v4 = bytes(BAG_HEADER);
    v4[7] = 4;
    expect(parsePmtilesHeader(v4)).toBeNull();
  });
});

describe('fetchPmtilesHeader', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('asks for the header alone and reads it', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 206,
      body: null,
      arrayBuffer: async () => bytes(BAG_HEADER).buffer,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchPmtilesHeader('https://data.test/a.pmtiles')).resolves.toMatchObject({
      kind: 'vector',
      maxZoom: 15,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://data.test/a.pmtiles',
      expect.objectContaining({ headers: { Range: `bytes=0-${PMTILES_HEADER_LENGTH - 1}` } })
    );
  });

  it('reads no further than the header of an answer that ignores the range', async () => {
    const whole = new Uint8Array(4096);
    whole.set(bytes(BAG_HEADER));
    const cancel = jest.fn().mockResolvedValue(undefined);
    const chunks = [whole.subarray(0, 100), whole.subarray(100, 4096)];
    const reader = {
      read: jest.fn(async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true })),
      cancel,
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, body: { getReader: () => reader } }) as never;

    await expect(fetchPmtilesHeader('https://data.test/a.pmtiles')).resolves.toMatchObject({ kind: 'vector' });
    expect(reader.read).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalled();
  });

  it('says why when the archive answers an error, or is none', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' }) as never;
    await expect(fetchPmtilesHeader('https://data.test/a.pmtiles')).rejects.toThrow(
      'the archive answered 403 Forbidden'
    );

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      arrayBuffer: async () => new TextEncoder().encode('<html></html>').buffer,
    }) as never;
    await expect(fetchPmtilesHeader('https://data.test/a.pmtiles')).rejects.toThrow('it is no PMTiles archive');
  });
});
