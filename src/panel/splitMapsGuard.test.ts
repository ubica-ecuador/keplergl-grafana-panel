import { decideSplitMapRepairs, savedSplitAssignment, type SavedSplitAssignment } from './splitMapsGuard';

const FIRE_CONFIG = {
  version: 'v1',
  config: {
    visState: {
      splitMaps: [
        { layers: { boxoutline: true, footprints: true, 's2scene-before': true, s2scene: false } },
        { layers: { boxoutline: true, footprints: true, 's2scene-before': false, s2scene: true } },
      ],
      layers: [
        { id: 'boxoutline', config: { dataId: 'grafana-A' } },
        { id: 'footprints', config: { dataId: 'grafana-B' } },
        { id: 's2scene-before', config: { dataId: 'grafana-D-raster' } },
        { id: 's2scene', config: { dataId: 'grafana-B-raster' } },
      ],
    },
  },
};

const FIRE_DESIRED = savedSplitAssignment(FIRE_CONFIG) as SavedSplitAssignment;

describe('savedSplitAssignment', () => {
  it('reads the authored panes and what each layer was drawn from', () => {
    expect(FIRE_DESIRED.panes).toEqual([
      { boxoutline: true, footprints: true, 's2scene-before': true, s2scene: false },
      { boxoutline: true, footprints: true, 's2scene-before': false, s2scene: true },
    ]);
    expect(FIRE_DESIRED.dataIdOf['s2scene']).toBe('grafana-B-raster');
  });

  it('asks for nothing when there is no split, or only one pane', () => {
    expect(savedSplitAssignment(null)).toBeNull();
    expect(savedSplitAssignment({ version: 'v1', config: { visState: { splitMaps: [] } } })).toBeNull();
    expect(
      savedSplitAssignment({ version: 'v1', config: { visState: { splitMaps: [{ layers: { a: true } }] } } })
    ).toBeNull();
  });

  it('asks for nothing when both panes agree — kepler produces that by itself', () => {
    expect(
      savedSplitAssignment({
        version: 'v1',
        config: { visState: { splitMaps: [{ layers: { a: true, b: true } }, { layers: { a: true, b: true } }] } },
      })
    ).toBeNull();
  });
});

describe('decideSplitMapRepairs', () => {
  it('waits while the map is not split yet', () => {
    expect(decideSplitMapRepairs({ desired: FIRE_DESIRED, splitMaps: [], layers: [] })).toEqual({ kind: 'wait' });
  });

  it('waits, without touching anything, while the raster layers are still parked', () => {
    expect(
      decideSplitMapRepairs({
        desired: FIRE_DESIRED,
        splitMaps: [
          { layers: { boxoutline: true, footprints: true } },
          { layers: { boxoutline: true, footprints: true } },
        ],
        layers: [
          { id: 'boxoutline', dataId: 'grafana-A' },
          { id: 'footprints', dataId: 'grafana-B' },
        ],
      })
    ).toEqual({ kind: 'wait' });
  });

  // The measured failure: both rasters added to both halves as visible.
  it('puts each raster back on its own half', () => {
    const allTrue = { boxoutline: true, footprints: true, 's2scene-before': true, s2scene: true };
    const action = decideSplitMapRepairs({
      desired: FIRE_DESIRED,
      splitMaps: [{ layers: { ...allTrue } }, { layers: { ...allTrue } }],
      layers: [
        { id: 'boxoutline', dataId: 'grafana-A' },
        { id: 'footprints', dataId: 'grafana-B' },
        { id: 's2scene-before', dataId: 'grafana-D-raster' },
        { id: 's2scene', dataId: 'grafana-B-raster' },
      ],
    });
    expect(action).toEqual({
      kind: 'toggle',
      settled: true,
      toggles: [
        { mapIndex: 0, layerId: 's2scene' },
        { mapIndex: 1, layerId: 's2scene-before' },
      ],
    });
  });

  it('repairs the first two panes even when the merge left four', () => {
    const allTrue = { boxoutline: true, footprints: true, 's2scene-before': true, s2scene: true };
    const action = decideSplitMapRepairs({
      desired: FIRE_DESIRED,
      splitMaps: [
        { layers: { ...allTrue } },
        { layers: { ...allTrue } },
        { layers: { ...allTrue } },
        { layers: { ...allTrue } },
      ],
      layers: [
        { id: 'boxoutline', dataId: 'grafana-A' },
        { id: 'footprints', dataId: 'grafana-B' },
        { id: 's2scene-before', dataId: 'grafana-D-raster' },
        { id: 's2scene', dataId: 'grafana-B-raster' },
      ],
    });
    expect(action).toMatchObject({ kind: 'toggle', settled: true });
  });

  it('is done when the authored assignment already holds', () => {
    expect(
      decideSplitMapRepairs({
        desired: FIRE_DESIRED,
        splitMaps: [
          { layers: { boxoutline: true, footprints: true, 's2scene-before': true, s2scene: false } },
          { layers: { boxoutline: true, footprints: true, 's2scene-before': false, s2scene: true } },
        ],
        layers: [
          { id: 'boxoutline', dataId: 'grafana-A' },
          { id: 'footprints', dataId: 'grafana-B' },
          { id: 's2scene-before', dataId: 'grafana-D-raster' },
          { id: 's2scene', dataId: 'grafana-B-raster' },
        ],
      })
    ).toEqual({ kind: 'done' });
  });

  // A change of band combination retypes the raster layers, and kepler mints a
  // new id for each; the assignment has to follow the dataset, not the id.
  it('follows a layer whose id kepler reminted, by its dataset', () => {
    const allTrue = { boxoutline: true, footprints: true, jnqjkv9: true, '77poy2u': true };
    const action = decideSplitMapRepairs({
      desired: FIRE_DESIRED,
      splitMaps: [{ layers: { ...allTrue } }, { layers: { ...allTrue } }],
      layers: [
        { id: 'boxoutline', dataId: 'grafana-A' },
        { id: 'footprints', dataId: 'grafana-B' },
        { id: '77poy2u', dataId: 'grafana-D-raster' },
        { id: 'jnqjkv9', dataId: 'grafana-B-raster' },
      ],
    });
    expect(action).toEqual({
      kind: 'toggle',
      settled: true,
      toggles: [
        { mapIndex: 0, layerId: 'jnqjkv9' },
        { mapIndex: 1, layerId: '77poy2u' },
      ],
    });
  });

  it('leaves an ambiguous dataset alone rather than guessing', () => {
    const desired = savedSplitAssignment({
      version: 'v1',
      config: {
        visState: {
          splitMaps: [{ layers: { points: true, heat: false } }, { layers: { points: false, heat: true } }],
          layers: [
            { id: 'points', config: { dataId: 'grafana-A' } },
            { id: 'heat', config: { dataId: 'grafana-A' } },
          ],
        },
      },
    }) as SavedSplitAssignment;
    // Both were reminted onto the same dataset: nothing tells them apart.
    const action = decideSplitMapRepairs({
      desired,
      splitMaps: [{ layers: { aaa: true, bbb: true } }, { layers: { aaa: true, bbb: true } }],
      layers: [
        { id: 'aaa', dataId: 'grafana-A' },
        { id: 'bbb', dataId: 'grafana-A' },
      ],
    });
    expect(action).toEqual({ kind: 'wait' });
  });
});
