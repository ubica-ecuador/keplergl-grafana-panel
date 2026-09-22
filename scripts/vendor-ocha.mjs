/**
 * Extracts the OCHA Humanitarian Icons this plugin offers into a JSON it ships.
 *
 * The icons are CC0-1.0. OCHA asks to be credited where feasible, which the
 * entry in THIRD-PARTY-LICENSES.md does. Only the JSON this writes reaches the
 * bundle.
 *
 * Not every icon: only those `src/icons/symbol-categories.json` files under
 * `ocha`. That leaves out the ones meant for an office document rather than a
 * map (`CSV-file`, `Print`, `Settings`…). A name there with no file behind it
 * fails the script, so a renamed icon is noticed rather than lost.
 *
 * The icons are not on npm. Clone the repository somewhere outside this one,
 * at the commit last vendored, and point the script at it, from the
 * repository root:
 *
 *   git clone https://github.com/UN-OCHA/humanitarian-icons /tmp/ocha-icons
 *   git -C /tmp/ocha-icons checkout f7613d5a6911fdbafa9706254cb42e2875b78069
 *   npm run vendor:ocha -- /tmp/ocha-icons
 *
 * The commit goes into the JSON as its `version`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { centredBox, ochaSlug, readOchaSvg } from './svg-paths.mjs';

const repoDir = process.argv[2];
const OUT = join('src', 'icons', 'ocha-paths.json');
const CATEGORIES = join('src', 'icons', 'symbol-categories.json');

if (!repoDir || !existsSync(join(repoDir, 'SVG', 'black'))) {
  console.error(`Error: no OCHA checkout at ${repoDir ?? '(no argument)'}`);
  console.error('Pass a clone of https://github.com/UN-OCHA/humanitarian-icons: the directory that holds SVG/black/.');
  process.exit(1);
}

const version = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const wanted = Object.keys(JSON.parse(await readFile(CATEGORIES, 'utf8')).ocha).sort();
const icons = {};
const slugs = new Map();

for (const name of wanted) {
  // Two files that differ only in case or spacing would share a catalogue name.
  const slug = ochaSlug(name);
  if (slugs.has(slug)) {
    throw new Error(`"${name}" and "${slugs.get(slug)}" would both be ocha:${slug}`);
  }
  slugs.set(slug, name);

  const file = join(repoDir, 'SVG', 'black', `${name}.svg`);
  if (!existsSync(file)) {
    throw new Error(`symbol-categories.json names "${name}", but ${file} does not exist`);
  }
  try {
    const { viewBox, paths } = readOchaSvg(await readFile(file, 'utf8'));
    icons[name] = { ...centredBox(viewBox), paths };
  } catch (error) {
    throw new Error(`${name}.svg: ${error.message}`);
  }
}

await writeFile(
  OUT,
  `${JSON.stringify({ source: 'UN-OCHA/humanitarian-icons', version, license: 'CC0-1.0', icons }, null, 2)}\n`
);

console.log(`Wrote ${Object.keys(icons).length} icons to ${OUT}`);
