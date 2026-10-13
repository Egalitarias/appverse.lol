import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from '../js/zip.js';
import { startDev, snapshot } from '../tools/applet-dev.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPLET = join(root, 'tools', 'applet.mjs');
const work = () => mkdtempSync(join(tmpdir(), 'applet-cli-'));
const applet = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [APPLET, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
};
const get = (port, path, headers = {}) => new Promise((resolveReq, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => resolveReq({ status: res.statusCode, headers: res.headers, body }));
  }).on('error', reject);
});

// ---------------------------------------------------------------- the commands

test('help, per-command help and unknown commands', () => {
  const dir = work();
  const h = applet(dir);
  assert.equal(h.code, 0);
  for (const c of ['applet new', 'applet dev', 'applet check', 'applet pack', 'applet inspect', 'applet unpack']) assert.ok(h.out.includes(c), `${c} missing from help`);
  assert.match(applet(dir, 'help', 'pack').out, /manifest\.json/);
  const bad = applet(dir, 'frobnicate');
  assert.equal(bad.code, 2);
  assert.match(bad.err, /Unknown command "frobnicate"/);
});

test('the whole workflow: new, check, pack, inspect, unpack', async () => {
  const dir = work();
  const made = applet(dir, 'new', 'star-notes');
  assert.equal(made.code, 0, made.all);
  assert.deepEqual(readdirSync(join(dir, 'star-notes')).sort(), ['AGENTS.md', 'README.md', 'app.js', 'index.html', 'manifest.json', 'style.css']);
  const manifest = JSON.parse(readFileSync(join(dir, 'star-notes/manifest.json'), 'utf8'));
  assert.equal(manifest.id, 'local.star-notes');
  assert.equal(manifest.title, 'Star Notes');
  assert.match(readFileSync(join(dir, 'star-notes/index.html'), 'utf8'), /<title>Star Notes<\/title>/);
  assert.match(applet(dir, 'new', 'star-notes').err, /already has files/); // never overwrites
  assert.equal(applet(dir, 'new', '../evil').code, 1);

  const app = join(dir, 'star-notes');
  const checked = applet(app, 'check', '--strict'); // the starter must be clean
  assert.equal(checked.code, 0, checked.all);
  assert.match(checked.out, /OK: Star Notes \(5 files\) passes all checks/);

  const packed = applet(app, 'pack');
  assert.equal(packed.code, 0, packed.all);
  assert.ok(existsSync(join(app, 'star-notes.applet')));
  const again = applet(app, 'pack'); // the package from the first run must not be packed into the second
  assert.equal(again.code, 0, again.all);
  assert.match(again.out, /Packed 5 files/);
  const files = await readZip(new Uint8Array(readFileSync(join(app, 'star-notes.applet'))));
  assert.deepEqual([...files.keys()], ['manifest.json', 'README.md', 'app.js', 'index.html', 'style.css']);
  assert.ok(!files.has('AGENTS.md'), 'the notes for AI agents stay out of the package');

  assert.equal(applet(app, 'pack', 'small.applet').code, 0);
  assert.ok(existsSync(join(app, 'small.applet')));
  assert.equal(applet(dir, 'check', 'star-notes/star-notes.applet').code, 0);

  const inspected = applet(dir, 'inspect', 'star-notes/star-notes.applet');
  assert.equal(inspected.code, 0, inspected.all);
  assert.match(inspected.out, /id: 'local\.star-notes'/);
  assert.match(inspected.out, /index\.html/);

  const out = join(dir, 'unpacked');
  assert.equal(applet(dir, 'unpack', 'star-notes/star-notes.applet', out).code, 0);
  assert.equal(readFileSync(join(out, 'app.js'), 'utf8'), readFileSync(join(app, 'app.js'), 'utf8'));
  assert.match(applet(dir, 'unpack', 'star-notes/star-notes.applet', out).err, /already has files/);
  assert.equal(applet(dir, 'unpack', 'star-notes/star-notes.applet', out, '--force').code, 0);
});

test('check: errors fail, warnings fail only with --strict, a missing manifest is guessed', () => {
  const dir = work();
  applet(dir, 'new', 'app');
  const app = join(dir, 'app');
  writeFileSync(join(app, 'app.js'), 'fetch("/data.json");');
  const warned = applet(app, 'check');
  assert.equal(warned.code, 0, warned.all);
  assert.match(warned.err, /warning: .*network/);
  assert.equal(applet(app, 'check', '--strict').code, 1);

  writeFileSync(join(app, 'index.html'), '<script src="https://cdn.example/x.js"></script>');
  const bad = applet(app, 'check');
  assert.equal(bad.code, 1);
  assert.match(bad.err, /error: .*from the network/);

  const bare = work();
  writeFileSync(join(bare, 'index.html'), '<p>hi</p>');
  const guessed = applet(bare, 'check');
  assert.equal(guessed.code, 0, guessed.all);
  assert.match(guessed.out, /details were guessed/);
  const pack = applet(bare, 'pack');
  assert.equal(pack.code, 1);
  assert.match(pack.err, /No manifest\.json/);
  assert.equal(applet(work(), 'check').code, 1); // an empty folder
  assert.equal(applet(dir, 'check', 'nope').code, 1);
});

test('pack refuses an app with errors, and tools/pack.mjs still works', () => {
  const dir = work();
  applet(dir, 'new', 'app');
  const app = join(dir, 'app');
  writeFileSync(join(app, 'index.html'), '<img src="gone.png">');
  const r = applet(app, 'pack');
  assert.equal(r.code, 1);
  assert.match(r.err, /not in the package/);
  assert.ok(!existsSync(join(app, 'app.applet')));
  const old = spawnSync(process.execPath, [join(root, 'tools', 'pack.mjs'), join(root, 'examples', 'notes'), join(dir, 'n.applet')], { encoding: 'utf8' });
  assert.equal(old.status, 0, old.stderr);
  assert.ok(existsSync(join(dir, 'n.applet')));
});

// ---------------------------------------------------------------- the dev server

test('dev: snapshot of a folder, with checks and every file', () => {
  const dir = work();
  applet(dir, 'new', 'app');
  const snap = snapshot(join(dir, 'app'));
  assert.equal(snap.manifest.title, 'App');
  assert.equal(snap.findings.filter((f) => f.level === 'error').length, 0);
  assert.deepEqual(Object.keys(snap.files).sort(), ['README.md', 'app.js', 'index.html', 'manifest.json', 'style.css']);
  assert.equal(Buffer.from(snap.files['app.js'], 'base64').toString(), readFileSync(join(dir, 'app/app.js'), 'utf8'));
  assert.match(snapshot(join(dir, 'missing')).error, /not a folder/);
  writeFileSync(join(dir, 'app/manifest.json'), '{');
  assert.match(snapshot(join(dir, 'app')).error, /not valid JSON/);
});

test('dev: serves the page, the app and the runtime files, only to this computer', async () => {
  const dir = work();
  applet(dir, 'new', 'app');
  const changes = [];
  const dev = await startDev({ dir: join(dir, 'app'), port: 0, onChange: () => changes.push(1) });
  try {
    const page = await get(dev.port, '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /import \{ runApplet \} from '\/js\/sandbox\.js'/);
    const game = JSON.parse((await get(dev.port, '/__app')).body);
    assert.equal(game.manifest.id, 'local.app');
    const sandbox = await get(dev.port, '/js/sandbox.js');
    assert.equal(sandbox.status, 200);
    assert.match(sandbox.body, /sandbox/);
    assert.equal((await get(dev.port, '/js/manifest.js')).status, 200);
    // nothing outside js/, no traversal, no other hosts, no other methods
    for (const path of ['/js/..%2fpackage.json', '/js/%2e%2e/package.json', '/js/nope.js', '/package.json', '/js/..\\x.js']) assert.ok([400, 404].includes((await get(dev.port, path)).status), path);
    assert.equal((await get(dev.port, '/', { Host: 'evil.example' })).status, 403);
    const post = await new Promise((r) => { const q = http.request({ host: '127.0.0.1', port: dev.port, method: 'POST', path: '/' }, r); q.end(); });
    assert.equal(post.statusCode, 405);
    assert.equal(dev.server.address().address, '127.0.0.1');

    // saving a file is noticed
    await new Promise((r) => setTimeout(r, 500));
    writeFileSync(join(dir, 'app/app.js'), '// changed\n');
    for (let i = 0; i < 30 && !changes.length; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(changes.length, 'a change event fired');
  } finally {
    await dev.close();
  }
});

test('new shows the command that works: `applet` when installed, `npx appverse` when run through npx', () => {
  const run = (env) => spawnSync(process.execPath, [APPLET, 'new', 'demo'], { cwd: work(), encoding: 'utf8', env: { ...process.env, ...env } });
  const plain = run({ npm_command: '' });
  assert.match(plain.stdout, /\n {4}applet dev /);
  assert.ok(!plain.stdout.includes('npx appverse'));
  const viaNpx = run({ npm_command: 'exec' });
  assert.match(viaNpx.stdout, /\n {4}npx appverse dev /);
  assert.match(viaNpx.stdout, /npx appverse pack +build demo\.applet/);
});
