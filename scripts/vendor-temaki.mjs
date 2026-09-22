/**
 * Extracts Temaki's icons into a JSON this plugin ships.
 *
 * Temaki is CC0-1.0, like Maki, whose grid it extends; the entry in
 * THIRD-PARTY-LICENSES.md records where the shapes came from. Only the JSON
 * this writes reaches the bundle.
 *
 * `@rapideditor/temaki` is not a dependency of this repository. Fetch the
 * package somewhere outside it and point the script at the unpacked directory,
 * from the repository root:
 *
 *   mkdir -p /tmp/temaki
 *   npm pack @rapideditor/temaki@5.13.0 --pack-destination /tmp/temaki
 *   tar -xzf /tmp/temaki/rapideditor-temaki-5.13.0.tgz -C /tmp/temaki
 *   npm run vendor:temaki -- /tmp/temaki/package
 *
 * Each icon keeps Temaki's own groups (`data/icons.json`), which
 * `src/icons/symbol-categories.json` turns into the picker's categories.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readTemakiSvg } from './svg-paths.mjs';

const packageDir = process.argv[2];
const OUT = join('src', 'icons', 'temaki-paths.json');

/**
 * Icons `readTemakiSvg` refuses on purpose, named explicitly rather than
 * caught by a blanket try/catch: an icon that fails for an unforeseen reason
 * must still stop the run.
 *
 * `crossing_markings-zebra_bicolour`'s seven stripes alternate solid and 30%
 * opacity (`fill-opacity`), which `PathGlyph`'s flat fill cannot carry;
 * dropping the opacity would draw the stripes touching, as a solid block.
 * `crossing_markings-zebra` draws the same crossing without the translucency,
 * so this one icon is left out rather than drawn wrong.
 */
const SKIPPED = new Set(['crossing_markings-zebra_bicolour']);

if (!packageDir || !existsSync(join(packageDir, 'icons')) || !existsSync(join(packageDir, 'data', 'icons.json'))) {
  console.error(`Error: no Temaki package at ${packageDir ?? '(no argument)'}`);
  console.error('Pass the unpacked npm package: the directory that holds icons/ and data/icons.json.');
  process.exit(1);
}

const { version } = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
const metadata = JSON.parse(await readFile(join(packageDir, 'data', 'icons.json'), 'utf8'));
const files = (await readdir(join(packageDir, 'icons'))).filter((name) => name.endsWith('.svg')).sort();
const icons = {};

for (const file of files) {
  const name = file.replace(/\.svg$/, '');
  if (SKIPPED.has(name)) {
    console.log(`Skipped ${file}: translucent stripes the glyph model cannot draw`);
    continue;
  }
  const groups = metadata[name]?.groups;
  if (!Array.isArray(groups)) {
    throw new Error(`${file}: data/icons.json gives "${name}" no groups`);
  }
  try {
    icons[name] = { ...readTemakiSvg(await readFile(join(packageDir, 'icons', file), 'utf8')), groups };
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
}

await writeFile(
  OUT,
  `${JSON.stringify({ source: '@rapideditor/temaki', version, license: 'CC0-1.0', icons }, null, 2)}\n`
);

console.log(`Wrote ${Object.keys(icons).length} icons to ${OUT}`);
