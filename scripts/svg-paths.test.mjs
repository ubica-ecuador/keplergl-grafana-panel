import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  attributes,
  centredBox,
  circlePath,
  ochaSlug,
  polygonPath,
  readOchaSvg,
  readTemakiSvg,
  rectPath,
  roundNumbers,
} from './svg-paths.mjs';

describe('roundNumbers', () => {
  test('rounds to two places and keeps the commands', () => {
    assert.equal(roundNumbers('M1.01658,1.01658,0,0,0-1.38,0'), 'M1.02,1.02,0,0,0 -1.38,0');
  });

  test('keeps two numbers apart when rounding gives the second a leading zero', () => {
    // `-.43.98` is two numbers in SVG; `-0.430.98` would be one.
    assert.equal(roundNumbers('M-.43.98L.5.5'), 'M-0.43 0.98L0.5 0.5');
  });

  test('never writes -0', () => {
    assert.equal(roundNumbers('M-0.001 5'), 'M0 5');
  });

  test('reads exponents', () => {
    assert.equal(roundNumbers('M1e-7 2.5e1'), 'M0 25');
  });

  test('rounds an arc whose flags stand apart', () => {
    assert.equal(roundNumbers('M0 0A5.123 5 0 0 1 10 10'), 'M0 0A5.12 5 0 0 1 10 10');
  });

  test('refuses an arc whose flags run into the next number, which rounding would corrupt', () => {
    assert.throws(() => roundNumbers('M0 0A5 5 0 0110 10'), /Arc flags/);
  });
});

describe('primitives as paths', () => {
  test('a circle is two half-circle arcs', () => {
    assert.equal(circlePath(10, 20, 5), 'M5 20A5 5 0 1 0 15 20A5 5 0 1 0 5 20Z');
  });

  test('a rectangle without rounded corners is four sides', () => {
    assert.equal(rectPath(1, 2, 10, 4), 'M1 2H11V6H1Z');
  });

  test('a rectangle with rounded corners is four sides and four arcs', () => {
    assert.equal(rectPath(0, 0, 10, 4, 1), 'M1 0H9A1 1 0 0 1 10 1V3A1 1 0 0 1 9 4H1A1 1 0 0 1 0 3V1A1 1 0 0 1 1 0Z');
  });

  test('a corner radius larger than half the side is clamped, as SVG does', () => {
    assert.equal(rectPath(0, 0, 4, 4, 9), 'M2 0H2A2 2 0 0 1 4 2V2A2 2 0 0 1 2 4H2A2 2 0 0 1 0 2V2A2 2 0 0 1 2 0Z');
  });

  test('a polygon is a closed path through its points', () => {
    assert.equal(polygonPath('1,2 3,4 5,6'), 'M1 2L3 4L5 6Z');
  });

  test('a polygon of fewer than three points is refused', () => {
    assert.throws(() => polygonPath('1,2 3,4'), /three/);
  });
});

describe('centredBox', () => {
  test('adds a margin of the longer side all round and centres the shorter one', () => {
    assert.deepEqual(centredBox([0, 0, 40, 48]), { box: 54.72, offset: [7.36, 3.36] });
  });

  test('moves a view box that does not start at the origin', () => {
    assert.deepEqual(centredBox([10, -5, 48, 30]), { box: 54.72, offset: [-6.64, 17.36] });
  });

  test('with no margin, centres a narrow icon in the square of its height', () => {
    assert.deepEqual(centredBox([0, 0, 22, 48], 0), { box: 48, offset: [13, 0] });
  });
});

describe('attributes', () => {
  test('reads the attributes of one start tag', () => {
    assert.deepEqual(attributes('<rect x="1" y="2" fill-rule="evenodd"/>'), { x: '1', y: '2', 'fill-rule': 'evenodd' });
  });
});

describe('readTemakiSvg', () => {
  test('keeps every path of a square icon, flush with its box', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15 15"><path d="M7.5 1L14 14H1Z"/><path d="M7 6h1v4H7z"/></svg>';
    assert.deepEqual(readTemakiSvg(svg), {
      box: 15,
      offset: [0, 0],
      paths: [{ d: 'M7.5 1L14 14H1Z' }, { d: 'M7 6h1v4H7z' }],
    });
  });

  test('centres an icon narrower than it is tall', () => {
    const svg = '<svg viewBox="0 0 22 48"><path d="M0 0H22V48H0Z"/></svg>';
    assert.deepEqual(readTemakiSvg(svg), { box: 48, offset: [13, 0], paths: [{ d: 'M0 0H22V48H0Z' }] });
  });

  test('refuses what it cannot draw', () => {
    assert.throws(() => readTemakiSvg('<svg viewBox="0 0 15 15"><circle cx="7" cy="7" r="3"/></svg>'), /path/);
    assert.throws(() => readTemakiSvg('<svg viewBox="0 0 15 15"><path transform="rotate(9)" d="M0 0Z"/></svg>'));
    assert.throws(() => readTemakiSvg('<svg viewBox="0 0 15 15"><path fill="#ff0000" d="M0 0Z"/></svg>'), /fill/);
    assert.throws(() => readTemakiSvg('<svg><path d="M0 0Z"/></svg>'), /viewBox/);
  });
});

describe('readOchaSvg', () => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 48">
  <defs><style>.cls-1{fill:#000000;}.cls-2{fill-rule:evenodd;fill:#000000;}</style></defs>
  <title>Test</title>
  <g>
    <path class="cls-1" d="M1.23456 2L3 4Z"/>
    <circle class="cls-2" cx="10" cy="20" r="5"/>
    <rect class="cls-1" x="1" y="2" width="10" height="4"/>
    <rect class="cls-1" x="0" y="0" width="10" height="4" rx="1"/>
    <polygon class="cls-1" points="1,2 3,4 5,6"/>
  </g>
</svg>`;

  test('turns every shape into a path, in document order, rounded, with its fill rule', () => {
    assert.deepEqual(readOchaSvg(svg), {
      viewBox: [0, 0, 40, 48],
      paths: [
        { d: 'M1.23 2L3 4Z' },
        { d: 'M5 20A5 5 0 1 0 15 20A5 5 0 1 0 5 20Z', evenOdd: true },
        { d: 'M1 2H11V6H1Z' },
        { d: 'M1 0H9A1 1 0 0 1 10 1V3A1 1 0 0 1 9 4H1A1 1 0 0 1 0 3V1A1 1 0 0 1 1 0Z' },
        { d: 'M1 2L3 4L5 6Z' },
      ],
    });
  });

  test('refuses a colour other than black, a stroke, a picture or a transform', () => {
    assert.throws(() => readOchaSvg(svg.replace('.cls-1{fill:#000000;}', '.cls-1{fill:#ffffff;}')), /fill/);
    assert.throws(() => readOchaSvg(svg.replace('.cls-1{fill:#000000;}', '.cls-1{stroke:#000000;}')), /stroke/);
    assert.throws(() => readOchaSvg(svg.replace('<g>', '<g><image href="x.png"/>')), /Unsupported/);
    assert.throws(() => readOchaSvg(svg.replace('<g>', '<g transform="translate(1 1)">')), /Unsupported/);
  });
});

describe('ochaSlug', () => {
  test('lower-cases a file name and turns its spaces into hyphens', () => {
    assert.equal(ochaSlug('Indigenous people'), 'indigenous-people');
    assert.equal(ochaSlug('Sexual-and-reproductive health'), 'sexual-and-reproductive-health');
    assert.equal(ochaSlug('Bridge-destroyed'), 'bridge-destroyed');
  });
});
