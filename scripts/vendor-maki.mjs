/**
 * Extracts Maki's icon paths into a JSON this plugin ships.
 *
 * Maki is CC0-1.0, so the file needs no attribution to be legal — the note is
 * there so the next reader knows where the shapes came from without digging
 * through git. The icons directory is supplied by the caller (as a CLI argument);
 * nothing of the original package reaches the bundle, only the JSON this writes.
 *
 * `@mapbox/maki` is not a dependency of this repository, so the default path
 * below does not exist in a normal checkout. Fetch the package somewhere outside
 * the repository and point the script at its icons, from the repository root:
 *
 *   mkdir -p /tmp/maki
 *   npm pack @mapbox/maki@8.2.0 --pack-destination /tmp/maki
 *   tar -xzf /tmp/maki/mapbox-maki-8.2.0.tgz -C /tmp/maki
 *   npm run vendor:maki -- /tmp/maki/package/icons
 *
 * An npm tarball unpacks into `package/`, whose `package.json` sits beside
 * `icons/` — where this script reads the version from. With 8.2.0 these steps
 * rewrite `src/icons/maki-paths.json` byte for byte. `npm pack` will not create
 * its destination, hence the `mkdir`.
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
  const pathMatches = svg.match(/<path[^>]*\sd="([^"]+)"/g);
  if (!pathMatches || pathMatches.length !== 1) {
    throw new Error(`Expected exactly one <path> in ${file}, found ${pathMatches?.length || 0}`);
  }
  let d = pathMatches[0].match(/<path[^>]*\sd="([^"]+)"/)[1];
  // Decode XML numeric character references (both hex &#x...; and decimal &#...;)
  d = d.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  d = d.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)));
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
