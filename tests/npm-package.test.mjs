import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildNpmPackage } from '../tools/build-npm.mjs';
import { BUNDLES } from '../js/downloads.js';

const walkNames = (dir, prefix = '') => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walkNames(join(dir, n), `${prefix}${n}/`) : [`${prefix}${n}`]));
const build = () => {
  const out = join(mkdtempSync(join(tmpdir(), 'appverse-npm-')), 'pkg');
  return { out, ...buildNpmPackage(out) };
};

test('the npm package is built from the same files as the tools download', () => {
  const { out, files } = build();
  const onDisk = walkNames(out).sort();
  assert.deepEqual(onDisk, [...files].sort());
  // everything in the download (except its own package.json and README.txt) is in the package
  const wanted = BUNDLES.tools.files.map((f) => f.as.replace('appverse-tools/', '')).filter((p) => p !== 'package.json' && p !== 'README.txt');
  for (const p of wanted) assert.ok(onDisk.includes(p), `${p} is missing from the npm package`);
  // nothing that should not ship
  for (const p of onDisk) assert.ok(!/^(tests|dist|examples|docs|node_modules)\//.test(p) && !p.startsWith('.'), `${p} should not be published`);
});

test('package.json is publishable: public, MIT, a real bin, a Node version, existing files', () => {
  const { out } = build();
  const pkg = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'appverse');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=20');
  assert.deepEqual(Object.keys(pkg.bin).sort(), ['applet', 'appverse']);
  for (const target of Object.values(pkg.bin)) {
    assert.ok(existsSync(join(out, target)), `bin target ${target} is missing`);
    assert.ok(readFileSync(join(out, target), 'utf8').startsWith('#!/usr/bin/env node'), `${target} has no shebang`);
  }
  for (const f of pkg.files) assert.ok(existsSync(join(out, f)), `files entry ${f} does not exist`);
  assert.ok(readFileSync(join(out, 'LICENSE'), 'utf8').startsWith('MIT License'));
  assert.ok(readFileSync(join(out, 'README.md'), 'utf8').includes('npx appverse new my-app'));
});

test('the built package works from a clean folder: new, check, pack', () => {
  const { out } = build();
  const work = mkdtempSync(join(tmpdir(), 'appverse-npm-work-'));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [join(out, 'tools/applet.mjs'), ...args], { cwd: work, encoding: 'utf8' });
    return { code: r.status, all: r.stdout + r.stderr };
  };
  assert.equal(run('new', 'demo').code, 0);
  const checked = run('check', 'demo', '--strict');
  assert.equal(checked.code, 0, checked.all);
  assert.equal(run('pack', 'demo').code, 0);
  assert.ok(existsSync(join(work, 'demo.applet')));
});
