import { decideLayerOrderRestore } from './layerOrderGuard';

describe('decideLayerOrderRestore', () => {
  it('restores the order a refresh reversed once every layer is merged back', () => {
    expect(
      decideLayerOrderRestore({ expected: ['points', 'heat'], layerOrder: ['heat', 'points'], pending: 0 })
    ).toEqual({ kind: 'restore', order: ['points', 'heat'] });
  });

  it('waits while kepler still holds layers pending a merge', () => {
    expect(decideLayerOrderRestore({ expected: ['points', 'heat'], layerOrder: [], pending: 2 })).toEqual({
      kind: 'wait',
    });
  });

  it('is done when the refresh kept the order', () => {
    expect(
      decideLayerOrderRestore({ expected: ['points', 'heat'], layerOrder: ['points', 'heat'], pending: 0 })
    ).toEqual({ kind: 'done' });
  });

  it('gives up when the set of layers changed in the meantime', () => {
    // Someone added or deleted a layer while the refresh was in flight; the old
    // order no longer describes this map, and forcing it would undo their edit.
    expect(
      decideLayerOrderRestore({ expected: ['points', 'heat'], layerOrder: ['rings', 'heat', 'points'], pending: 0 })
    ).toEqual({ kind: 'done' });
  });

  it('leaves an order with layer groups alone', () => {
    expect(
      decideLayerOrderRestore({
        expected: ['points', { id: 'g1', layerOrder: ['heat'] }],
        layerOrder: [{ id: 'g1', layerOrder: ['heat'] }, 'points'],
        pending: 0,
      })
    ).toEqual({ kind: 'done' });
  });
});
