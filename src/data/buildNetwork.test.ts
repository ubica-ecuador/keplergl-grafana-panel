import { FieldType, toDataFrame } from '@grafana/data';

import { isEdgeFrame } from './buildNetwork';
import { framesToDatasets } from './framesToDatasets';

const nodes = toDataFrame({
  refId: 'A',
  fields: [
    { name: 'id', type: FieldType.string, values: ['uio', 'gye', 'cue'] },
    { name: 'lat', type: FieldType.number, values: [-0.18, -2.19, -2.9] },
    { name: 'lon', type: FieldType.number, values: [-78.47, -79.89, -79] },
  ],
});

const edges = toDataFrame({
  refId: 'B',
  fields: [
    { name: 'id', type: FieldType.string, values: ['e1', 'e2', 'e3'] },
    { name: 'source', type: FieldType.string, values: ['uio', 'gye', 'uio'] },
    { name: 'target', type: FieldType.string, values: ['gye', 'cue', 'nowhere'] },
    { name: 'traffic', type: FieldType.number, values: [10, 20, 30] },
  ],
});

describe('a network of nodes and edges', () => {
  it('recognises an edges frame by its name or its source and target columns', () => {
    expect(isEdgeFrame(edges)).toBe(true);
    expect(isEdgeFrame(nodes)).toBe(false);
    expect(isEdgeFrame(toDataFrame({ name: 'edges', fields: [] }))).toBe(true);
  });

  it('gives each edge the positions of its two nodes, and leaves out one whose node is missing', () => {
    const [, edgeDataset] = framesToDatasets([nodes, edges]);

    expect(edgeDataset.rows).toEqual([
      { id: 'e1', source: 'uio', target: 'gye', traffic: 10, lat0: -0.18, lng0: -78.47, lat1: -2.19, lng1: -79.89 },
      { id: 'e2', source: 'gye', target: 'cue', traffic: 20, lat0: -2.19, lng0: -79.89, lat1: -2.9, lng1: -79 },
    ]);
    expect(edgeDataset.lineLayer).toMatchObject({ type: 'line', config: { dataId: 'grafana-B' } });
  });

  it('leaves edges alone when no frame places the nodes', () => {
    const [edgeDataset] = framesToDatasets([edges]);
    expect(edgeDataset.lineLayer).toBeUndefined();
    expect(edgeDataset.rows).toHaveLength(3);
  });
});
