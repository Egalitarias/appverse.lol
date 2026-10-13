import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLES, buildBundle } from '../js/downloads.js';
import { readZip } from '../js/zip.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundleFiles = (key) => BUNDLES[key].files.filter((f) => f.from);

/** Serves the repo's files to buildBundle, which fetches them from the site in a browser. */
async function build(key) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const file = join(root, String(url));
    return existsSync(file) ? { ok: true, status: 200, arrayBuffer: async () => readFileSync(file) } : { ok: false, status: 404 };
  };
  try { return await buildBundle(key); } finally { globalThis.fetch = realFetch; }
}

test('every file a download names exists in the repo, and is one the deploy serves', () => {
  const deploy = readFileSync(join(root, 'tools/deploy.sh'), 'utf8');
  const excluded = new RegExp(deploy.match(/grep -vE '([^']+)'/)[1]);
  for (const key of Object.keys(BUNDLES)) {
    for (const { from } of bundleFiles(key)) {
      assert.ok(existsSync(join(root, from)), `${key}: ${from} is missing`);
      assert.ok(!excluded.test(from), `${key}: ${from} is left out of the deploy, so the site could not serve it`);
    }
  }
});

test('the tools download holds every file the tools import', () => {
  const have = new Set(bundleFiles('tools').map((f) => f.from));
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    assert.ok(have.has(file), `${file} is imported but not in the tools download`);
    for (const m of readFileSync(join(root, file), 'utf8').matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) visit(posix.normalize(posix.join(posix.dirname(file), m[1])));
  };
  visit('tools/applet.mjs');
  // the starter template is read at run time
  for (const f of ['manifest.json', 'index.html', 'app.js', 'style.css']) assert.ok(have.has(`templates/starter/${f}`), f);
});

test('the starter download is a folder you can pack as it is', async () => {
  const { filename, blob } = await build('starter');
  assert.equal(filename, 'appverse-starter.zip');
  const files = await readZip(await blob.arrayBuffer());
  assert.deepEqual([...files.keys()].sort(), ['my-app/AGENTS.md', 'my-app/README.md', 'my-app/app.js', 'my-app/index.html', 'my-app/manifest.json', 'my-app/style.css']);
});

test('the tools download works on its own: unpacked in a clean folder it makes, checks and packs an app', async () => {
  const { blob } = await build('tools');
  const files = await readZip(await blob.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), 'appverse-tools-'));
  for (const [name, data] of files) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), data);
  }
  const tools = join(dir, 'appverse-tools');
  assert.match(readFileSync(join(tools, 'README.txt'), 'utf8'), /node tools\/applet\.mjs new my-app/);
  assert.equal(JSON.parse(readFileSync(join(tools, 'package.json'), 'utf8')).bin.applet, 'tools/applet.mjs');
  const run = (...args) => {
    const r = spawnSync(process.execPath, [join(tools, 'tools/applet.mjs'), ...args], { cwd: tools, encoding: 'utf8' });
    return { code: r.status, all: r.stdout + r.stderr };
  };
  assert.equal(run('new', 'my-app').code, 0);
  const checked = run('check', 'my-app', '--strict');
  assert.equal(checked.code, 0, checked.all);
  const packed = run('pack', 'my-app');
  assert.equal(packed.code, 0, packed.all);
  assert.equal(run('inspect', 'my-app.applet').code, 0);
  assert.ok(existsSync(join(tools, 'my-app.applet')));
});

test('make.html has a button for each download, and loads the script that handles them', () => {
  const html = readFileSync(join(root, 'make.html'), 'utf8');
  for (const key of Object.keys(BUNDLES)) assert.ok(html.includes(`data-bundle="${key}"`), key);
  assert.ok(html.includes('src="js/make.js"'));
  assert.ok(html.includes('id="dl-note"'));
});
