// scripts/package-edge.sh on a stand-in plugin folder: the zip it writes is
// what installs running the `edge` channel download.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/package-edge.sh');
const SHA = '0123456789abcdef0123456789abcdef01234567';

test('stamps the commit into the version, drops the signature, and writes a checkable sha256', () => {
  const dir = mkdtempSync(join(tmpdir(), 'package-edge-'));
  mkdirSync(join(dir, 'ubica-keplergl-panel'));
  writeFileSync(join(dir, 'ubica-keplergl-panel/plugin.json'), JSON.stringify({ id: 'ubica-keplergl-panel', info: { version: '1.0.1' } }));
  writeFileSync(join(dir, 'ubica-keplergl-panel/MANIFEST.txt'), 'signed');
  writeFileSync(join(dir, 'ubica-keplergl-panel/module.js'), '// built');

  const env = { ...process.env, PLUGIN_ID: 'ubica-keplergl-panel', VERSION: '1.0.1', GITHUB_SHA: SHA };
  const printed = execFileSync(SCRIPT, { cwd: dir, env, encoding: 'utf8' }).trim();
  assert.equal(printed, '1.0.1-edge.0123456');

  const zip = join(dir, 'ubica-keplergl-panel-edge.zip');
  const pluginJson = JSON.parse(execFileSync('unzip', ['-p', zip, 'ubica-keplergl-panel/plugin.json'], { encoding: 'utf8' }));
  assert.equal(pluginJson.info.version, '1.0.1-edge.0123456');
  const listing = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n');
  assert.ok(listing.includes('ubica-keplergl-panel/module.js'));
  assert.ok(!listing.some((name) => name.endsWith('MANIFEST.txt')));

  assert.match(readFileSync(`${zip}.sha256`, 'utf8'), /^[0-9a-f]{64}  ubica-keplergl-panel-edge\.zip\n$/);
  execFileSync('sha256sum', ['-c', 'ubica-keplergl-panel-edge.zip.sha256'], { cwd: dir });
});
