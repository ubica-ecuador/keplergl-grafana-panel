import { cellToParent as h3Parent, latLngToCell } from 'h3-js';

import {
  CELL_SYSTEMS,
  cellAreaKm2,
  fineCellOf,
  geohashOf,
  metresPerPixel,
  parentOf,
  resolutionFor,
  s2TokenOf,
} from './cellsGrid';

// Quito.
const QUITO = { lat: -0.1807, lng: -78.4678 };

describe('cellsGrid', () => {
  it('gives a fine cell whose parent is the cell at that level', () => {
    const fine = fineCellOf('h3', QUITO.lat, QUITO.lng);
    expect(parentOf('h3', fine, 7)).toBe(latLngToCell(QUITO.lat, QUITO.lng, 7));
    expect(parentOf('h3', fine, 7)).toBe(h3Parent(fine as string, 7));
    expect(parentOf('geohash', geohashOf(QUITO.lat, QUITO.lng, 10), 5)).toBe(geohashOf(QUITO.lat, QUITO.lng, 5));
  });

  it('encodes geohash as the usual base 32', () => {
    // The textbook example: 57.64911, 10.40744 is u4pruydqqvj.
    expect(geohashOf(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
  });

  it('turns an S2 key into its token', () => {
    const key = fineCellOf('s2', QUITO.lat, QUITO.lng) as string;
    const token = s2TokenOf(parentOf('s2', key, 10) as string);
    expect(token).toMatch(/^[0-9a-f]+$/);
    expect(token.length).toBeLessThan(16);
  });

  it('picks a finer level at each zoom in, one per zoom for the systems that split in four', () => {
    for (const system of CELL_SYSTEMS) {
      const levels = [2, 6, 10, 14].map((zoom) => resolutionFor(system, 36, zoom, 0));
      expect([...levels].sort((a, b) => a - b)).toEqual(levels);
      expect(levels[3]).toBeGreaterThan(levels[0]);
    }
    expect(resolutionFor('a5', 36, 9, 0) - resolutionFor('a5', 36, 8, 0)).toBe(1);
    expect(resolutionFor('s2', 36, 9, 0) - resolutionFor('s2', 36, 8, 0)).toBe(1);
  });

  it('chooses cells close to the size asked for', () => {
    const zoom = 8;
    const target = 36 * metresPerPixel(zoom, 0);
    for (const system of CELL_SYSTEMS) {
      const res = resolutionFor(system, 36, zoom, 0);
      const cell = parentOf(system, fineCellOf(system, 0.5, -78), res);
      const side = Math.sqrt(cellAreaKm2(system, cell, res) * 1e6);
      // H3 levels are 2.6 times apart and geohash 5.7, so within a factor of 2.5 either way.
      expect(side / target).toBeGreaterThan(0.4);
      expect(side / target).toBeLessThan(2.5);
    }
  });
});
