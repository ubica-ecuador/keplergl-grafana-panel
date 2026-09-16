/**
 * Extracts Maki's icon paths into a JSON this plugin ships.
 *
 * Maki is CC0-1.0, so the file needs no attribution to be legal — the note is
 * there so the next reader knows where the shapes came from without digging
 * through git. The package itself is a dev dependency: nothing of it reaches
 * the bundle, only the JSON this writes.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Accept icons directory as first CLI argument, default to node_modules/@mapbox/maki/icons
const iconsDir = process.argv[2] ?? join('node_modules', '@mapbox', 'maki', 'icons');
const OUT = join('src', 'icons', 'maki-paths.json');

// Verify the icons directory exists
if (!existsSync(iconsDir)) {
  console.error(`Error: Icons directory does not exist: ${iconsDir}`);
  console.error(`Please pass the icons directory as the first argument, or ensure @mapbox/maki is installed.`);
  process.exit(1);
}

// Read version from the package.json adjacent to the icons directory
const packageJsonPath = join(iconsDir, '..', 'package.json');
let version = 'unknown';
try {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  version = packageJson.version;
} catch (error) {
  console.warn(`Warning: Could not read version from ${packageJsonPath}, using 'unknown'`);
}

const files = (await readdir(iconsDir)).filter((name) => name.endsWith('.svg')).sort();
const paths = {};

for (const file of files) {
  const svg = await readFile(join(iconsDir, file), 'utf8');
  // Every Maki icon is a single <path d="…"> in a 15x15 box. Anything else is
  // a shape this reader would drop silently, so it fails loudly instead.
  const d = svg.match(/<path[^>]*\sd="([^"]+)"/)?.[1];
  if (!d) {
    throw new Error(`No path found in ${file}`);
  }
  paths[file.replace(/\.svg$/, '')] = d.replace(/\s+/g, ' ').trim();
}

await writeFile(
  OUT,
  `${JSON.stringify(
    {
      source: '@mapbox/maki',
      version,
      license: 'CC0-1.0',
      box: 15,
      paths,
    },
    null,
    2
  )}\n`
);

console.log(`Wrote ${Object.keys(paths).length} icons to ${OUT}`);
