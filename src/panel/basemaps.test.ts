import { DEFAULT_LAYER_GROUPS } from '@kepler.gl/constants';

import satelliteStyle from '../basemaps/satellite.json';
import satelliteTerrainStyle from '../basemaps/satellite-terrain.json';
import topographicTerrainStyle from '../basemaps/topographic-terrain.json';

import { registeredMapStyles, REPLACES_DEFAULT_MAP_STYLES } from './basemaps';
import {
  CUSTOM_BASEMAP_ID,
  SATELLITE_BASEMAP_ID,
  SATELLITE_TERRAIN_BASEMAP_ID,
  TOPOGRAPHIC_TERRAIN_BASEMAP_ID,
} from './constants';

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
    // Not metadata only: as of kepler 3.3.0-alpha.7 the attribution bar reads
    // each source's `attribution`, which is what puts the credit Esri's terms
    // require on screen. The panel used to render that credit itself; doing
    // both showed it twice.
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
  it('offers the token-free base maps, and the self-hosted one only once configured', () => {
    expect(registeredMapStyles().map((s) => s.id)).toEqual([
      // "No Basemap" is re-registered deliberately: replacing kepler's list
      // would otherwise drop it along with the Mapbox entries, and it is how a
      // dashboard shows data with no tiles fetched at all.
      'no_map',
      'dark-matter',
      'positron',
      'voyager',
      SATELLITE_BASEMAP_ID,
      SATELLITE_TERRAIN_BASEMAP_ID,
      TOPOGRAPHIC_TERRAIN_BASEMAP_ID,
    ]);
    expect(registeredMapStyles('https://tiles.internal/style.json').map((s) => s.id)).toContain(CUSTOM_BASEMAP_ID);
  });

  it("replaces kepler's list rather than adding to it, so no mapbox:// entry survives", () => {
    // Five of kepler's nine defaults are Mapbox styles that blank the map when
    // clicked without an account. Replacing the list is what removes them, and
    // re-registering Carto's three from kepler's own definitions is what keeps
    // the working ones.
    expect(REPLACES_DEFAULT_MAP_STYLES).toBe(true);
    for (const style of registeredMapStyles()) {
      expect(style.url).not.toMatch(/^mapbox:\/\//);
    }
  });

  it('keeps the self-hosted style pointing at the URL it was given', () => {
    const styles = registeredMapStyles('https://tiles.internal/style.json');
    const custom = styles[styles.length - 1];

    expect(custom.url).toBe('https://tiles.internal/style.json');
  });

  it("does not claim the id of kepler's own satellite entry", () => {
    // _loadMapStyle merges [...custom, ...defaults] into an object keyed by id
    // and the defaults are written last, so taking `satellite` would hand the
    // slot straight back to the mapbox:// style that needs a token.
    expect(SATELLITE_BASEMAP_ID).not.toBe('satellite');
    expect(registeredMapStyles().map((s) => s.id)).toContain(SATELLITE_BASEMAP_ID);
  });

  it("serves the plugin's own styles from the plugin, not from a third party", () => {
    // Air-gapped installs and Grafana's strict CSP both depend on the style
    // document itself being same-origin; only the tiles reach outside.
    const own = registeredMapStyles().filter((s) => s.id.startsWith('grafana-'));

    expect(own).toHaveLength(3);
    for (const style of own) {
      expect(style.url).toMatch(/\/basemaps\/[a-z-]+\.json$/);
      expect(style.url).not.toMatch(/^https?:\/\//);
    }
  });

  it('carries exactly the two layer groups the satellite overlays answer to', () => {
    const satellite = registeredMapStyles().find((s) => s.id === SATELLITE_BASEMAP_ID);

    expect(satellite?.layerGroups?.map((g) => g.slug)).toEqual(['label', 'road']);
  });
});

describe('the two relief styles', () => {
  const reliefStyles = [
    ['satellite + relief', satelliteTerrainStyle],
    ['topographic + relief', topographicTerrainStyle],
  ] as const;

  it.each(reliefStyles)('%s declares terrain against a DEM source it owns', (_label, style) => {
    // MapLibre reads `terrain` off the style document; kepler has no notion of
    // it and passes it through, which is the whole mechanism. A terrain that
    // names a source the style does not declare renders nothing at all.
    expect(style.terrain).toBeDefined();
    expect(Object.keys(style.sources)).toContain(style.terrain.source);
    expect(style.sources[style.terrain.source as keyof typeof style.sources].type).toBe('raster-dem');
  });

  it.each(reliefStyles)('%s asks for terrarium-encoded tiles, which is what the DEM serves', (_label, style) => {
    // Mapterhorn encodes elevation the terrarium way. Left at MapLibre's
    // default (mapbox), every height is decoded from the wrong channels and
    // the ground comes out as noise rather than as relief.
    const dem = style.sources[style.terrain.source as keyof typeof style.sources];

    expect(dem.encoding).toBe('terrarium');
    expect(dem.tileSize).toBe(512);
    expect(dem.attribution).toMatch(/Mapterhorn/);
  });

  it.each(reliefStyles)('%s exaggerates the relief enough to read, but not into a caricature', (_label, style) => {
    expect(style.terrain.exaggeration).toBeGreaterThan(1);
    expect(style.terrain.exaggeration).toBeLessThanOrEqual(2);
  });

  it.each(reliefStyles)('%s names a source on every layer it draws', (_label, style) => {
    for (const layer of style.layers) {
      if ('source' in layer) {
        expect(Object.keys(style.sources)).toContain(layer.source);
      }
    }
  });

  it('asks Esri for the topographic tiles in {z}/{y}/{x} order — level, row, column', () => {
    // Same trap as the satellite style: {z}/{x}/{y} returns real tiles from
    // the wrong place, so the map comes out transposed rather than blank.
    expect(topographicTerrainStyle.sources['esri-topographic'].tiles[0]).toMatch(/\/tile\/\{z\}\/\{y\}\/\{x\}$/);
  });
});

describe('the style picker thumbnails', () => {
  it('never asks this plugin for a thumbnail it does not ship', () => {
    // kepler names its own thumbnails as paths under the app's `cdnUrl`, which
    // this plugin points at its own assets so the vendored effect thumbnails
    // resolve. That made every base map ask for a `geodude/*.png` the plugin
    // has never shipped, and the picker showed broken images.
    for (const style of registeredMapStyles()) {
      expect(style.icon).not.toMatch(/geodude/);
    }
  });

  it('gives every offered style something to show', () => {
    for (const style of registeredMapStyles('https://tiles.internal/style.json')) {
      // The self-hosted entry is the one exception: the panel cannot know what
      // a URL someone typed looks like.
      if (style.id === CUSTOM_BASEMAP_ID) {
        continue;
      }
      expect(style.icon).toMatch(/^(https:\/\/|data:image\/)/);
    }
  });
});
