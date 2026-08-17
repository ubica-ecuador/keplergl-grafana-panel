// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const baseConfig = require('./.config/jest.config');
const { grafanaESModules, nodeModulesToTransform } = require('./.config/jest/utils');

// ESM-only packages in kepler.gl's dependency graph that jest must transform.
const keplerESModules = [
  '@mapbox/tiny-sdf',
  '@flowmap.gl',
  'd3-[^/]+',
  'internmap',
  'kdbush',
  'supercluster',
  'preact',
  'maplibregl-mapbox-request-transformer',
];

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...baseConfig,
  transformIgnorePatterns: [nodeModulesToTransform([...grafanaESModules, ...keplerESModules])],
  moduleNameMapper: {
    ...baseConfig.moduleNameMapper,
    // ESM-only wasm binding pulled in by kepler's @loaders.gl/parquet at import
    // time; jest cannot parse it and no test reads parquet files.
    '^parquet-wasm$': '<rootDir>/tests/mocks/parquet-wasm.js',
  },
};
