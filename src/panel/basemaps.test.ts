import { DEFAULT_LAYER_GROUPS } from '@kepler.gl/constants';

import satelliteStyle from '../basemaps/satellite.json';

import { registeredMapStyles } from './basemaps';
import { CUSTOM_BASEMAP_ID, SATELLITE_BASEMAP_ID } from './constants';

type LayerGroup = { slug: string; filter: (layer: { id: string; type?: string }) => unknown };

/** The kepler layer groups a style layer with this id and type falls into. */
const groupsMatching = (id: string, type: string) =>
  (DEFAULT_LAYER_GROUPS as LayerGroup[]).filter((group) => Boolean(group.filter({ id, type }))).map((g) => g.slug);

const rasterSources = () => Object.values(satelliteStyle.sources);

describe('the satellite style document', () => {
  it('is a version 8 style whose every layer names a source it declares', () => {
    expect(satelliteStyle.version).toBe(8);

    // `'source' in layer` rather than a check on layer.type: a JSON import
    // widens `type` to plain string, so it cannot discriminate the union and
    // reading layer.source off the background layer fails the typecheck.
    for (const layer of satelliteStyle.layers) {
      if ('source' in layer) {
        expect(Object.keys(satelliteStyle.sources)).toContain(layer.source);
      }
    }
  });

  it('asks Esri for tiles in {z}/{y}/{x} order — level, row, column', () => {
    // Esri's REST endpoint takes the row before the column. Writing the usual
    // {z}/{x}/{y} returns real tiles from the wrong place, so the map comes out
    // transposed rather than blank, which is far harder to spot.
    for (const source of rasterSources()) {
      expect(source.tiles[0]).toMatch(/\/tile\/\{z\}\/\{y\}\/\{x\}$/);
    }
  });

  it('declares 256-pixel tiles, which is what Esri serves', () => {
    // MapLibre assumes 512 for a raster source. Left at the default, every
    // label renders half-size and the zoom levels sit one step off.
    for (const source of rasterSources()) {
      expect(source.tileSize).toBe(256);
    }
  });

  it('credits Esri on every source', () => {
    // This is metadata only — kepler's own `Attribution` component
    // (@kepler.gl/components/map-container.js) replaces MapLibre's
    // attribution control with a hardcoded bar of its own and never reads a
    // raster source's `attribution` field, so this passing is not proof the
    // user sees a credit anywhere. `BasemapAttribution.tsx` is what actually
    // renders the visible Esri credit; see `BasemapAttribution.test.tsx`.
    for (const source of rasterSources()) {
      expect(source.attribution).toMatch(/Esri/);
    }
  });

  it("names the overlays so kepler's own Label and Road switches find them", () => {
    // Importing the real constant instead of copying the regexes is the point:
    // if kepler renames a group upstream this fails here, rather than leaving
    // two switches in the UI that quietly do nothing.
    expect(groupsMatching('label-places', 'raster')).toEqual(['label']);
    expect(groupsMatching('road-transportation', 'raster')).toEqual(['road']);
  });

  it('leaves the imagery layer in no group, so no switch can hide it', () => {
    // editBottomMapStyle only drops a layer that matches a group the user
    // turned off. Matching nothing is what keeps the imagery on screen
    // whatever the user flips.
    expect(groupsMatching('satellite', 'raster')).toEqual([]);
    expect(groupsMatching('background', 'background')).toEqual([]);
  });
});

describe('registeredMapStyles', () => {
  it('registers the satellite style whether or not a custom one is configured', () => {
    expect(registeredMapStyles().map((s) => s.id)).toEqual([SATELLITE_BASEMAP_ID]);
    expect(registeredMapStyles('https://tiles.internal/style.json').map((s) => s.id)).toEqual([
      SATELLITE_BASEMAP_ID,
      CUSTOM_BASEMAP_ID,
    ]);
  });

  it('keeps the self-hosted style pointing at the URL it was given', () => {
    const custom = registeredMapStyles('https://tiles.internal/style.json')[1];

    expect(custom.url).toBe('https://tiles.internal/style.json');
  });

  it('does not claim the id of kepler\'s own satellite entry', () => {
    // _loadMapStyle merges [...custom, ...defaults] into an object keyed by id
    // and the defaults are written last, so taking `satellite` would hand the
    // slot straight back to the mapbox:// style that needs a token.
    expect(SATELLITE_BASEMAP_ID).not.toBe('satellite');
    expect(registeredMapStyles()[0].id).toBe(SATELLITE_BASEMAP_ID);
  });

  it('serves the style from the plugin, not from a third party', () => {
    // Air-gapped installs and Grafana's strict CSP both depend on the style
    // document itself being same-origin; only the tiles reach outside.
    expect(registeredMapStyles()[0].url).toMatch(/\/basemaps\/satellite\.json$/);
    expect(registeredMapStyles()[0].url).not.toMatch(/^https?:\/\//);
  });

  it('carries exactly the two layer groups its overlays answer to', () => {
    expect(registeredMapStyles()[0].layerGroups?.map((g) => g.slug)).toEqual(['label', 'road']);
  });
});
