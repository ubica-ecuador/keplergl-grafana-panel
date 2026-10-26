import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const { patchPolygonFilter } = require('./kepler-polygon-filter-loader.cjs');

// The package exports no package.json; its main entry is dist/cjs/index.js.
const dist = path.resolve(path.dirname(require.resolve('@kepler.gl/utils')), '..');
const build = (kind) => path.join(dist, kind, 'filter-utils.js');

/** The installed cjs filter-utils, patched, loaded as a module of its own. */
function patchedModule() {
  const file = build('cjs');
  const module = new Module(file);
  module.filename = file;
  module.paths = Module._nodeModulePaths(path.dirname(file));
  module._compile(patchPolygonFilter(fs.readFileSync(file, 'utf8')), file);
  return module.exports;
}

const square = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  },
};

/** A layer of a type kepler does not know, placing row i at `positions[i]`. */
const layerOf = (positions, byPosition) => ({
  type: 'symbol',
  polygonFilterByPosition: byPosition,
  getPositionAccessor: () => (row) => positions[row.index],
});

describe('patchPolygonFilter', () => {
  for (const kind of ['esm', 'cjs']) {
    test(`finds its place in the installed ${kind} build, once`, () => {
      const patched = patchPolygonFilter(fs.readFileSync(build(kind), 'utf8'));
      assert.equal(patched.match(/layer\.polygonFilterByPosition/g)?.length, 1);
    });
  }

  test('cuts a layer that asks for it by the position it reads', () => {
    const { getPolygonFilterFunctor } = patchedModule();
    const inside = getPolygonFilterFunctor(
      layerOf(
        [
          [5, 5],
          [20, 5],
          [NaN, 5],
        ],
        true
      ),
      { value: square },
      null
    );
    assert.deepEqual(
      [0, 1, 2].map((index) => inside({ index })),
      [true, false, false]
    );
  });

  test('keeps every row of a layer that does not, as kepler did', () => {
    const { getPolygonFilterFunctor } = patchedModule();
    const inside = getPolygonFilterFunctor(layerOf([[20, 5]], false), { value: square }, null);
    assert.equal(inside({ index: 0 }), true);
  });

  test('fails loudly on a filter-utils it does not recognise', () => {
    assert.throws(() => patchPolygonFilter('export var x = 1;'), /not found/);
    assert.throws(
      () =>
        patchPolygonFilter(
          'var getPolygonFilterFunctor = function getPolygonFilterFunctor(layer, filter, dataContainer) {};'
        ),
      /default branch/
    );
  });
});
