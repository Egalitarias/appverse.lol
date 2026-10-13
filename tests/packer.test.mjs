import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFiles, readManifest, guessManifest, manifestFromFields, lintApplet, buildApplet } from '../js/packer.js';
import { validateManifest } from '../js/manifest.js';
import { readZip } from '../js/zip.js';

const enc = new TextEncoder();
const f = (path, text = 'x') => ({ path, data: enc.encode(text) });
const levels = (issues, level) => issues.filter((i) => i.level === level).map((i) => i.message);
const lint = (files, extra = {}) => lintApplet(validateManifest({ applet: 1, id: 'com.mine.app', title: 'App', license: 'MIT', ...extra }), new Map(Object.entries(files).map(([k, v]) => [k, enc.encode(v)])));

test('normalizeFiles: strips the dropped folder, junk and dotfiles', () => {
  const r = normalizeFiles([f('my-app/index.html'), f('my-app/app.js'), f('my-app/.git/config'), f('my-app/Thumbs.db'), f('my-app/AGENTS.md'), f('__MACOSX/x')]);
  assert.equal(r.folder, 'my-app');
  assert.deepEqual([...r.files.keys()], ['index.html', 'app.js']);
  assert.equal(r.skipped, 4);
  assert.deepEqual(r.errors, []);
});

test('normalizeFiles: refuses unsafe paths and duplicates', () => {
  assert.match(normalizeFiles([f('../evil.html')]).errors[0], /Unsafe path/);
  assert.match(normalizeFiles([f('a.html'), f('a.html')]).errors[0], /same path/);
});

test('readManifest and manifestFromFields', () => {
  assert.deepEqual(readManifest(new Map()), {});
  assert.match(readManifest(new Map([['manifest.json', enc.encode('{')]])).error, /not valid JSON/);
  assert.match(readManifest(new Map([['manifest.json', enc.encode('[]')]])).error, /must contain a JSON object/);
  const m = manifestFromFields({ id: 'com.mine.app', title: 'App', entry: 'index.html', width: '300', height: '200', permissions: ['storage'] });
  assert.equal(m.width, 300);
  assert.throws(() => manifestFromFields({ id: 'x', title: 'App' }), /manifest.id/);
});

test('guessManifest: entry, title and the permissions the code uses', () => {
  const files = new Map([['index.html', enc.encode('<p>')], ['app.js', enc.encode('appverse.storage.get("a"); appverse.copyText("x")')]]);
  const g = guessManifest(files, 'cool-notes');
  assert.equal(g.title, 'Cool Notes');
  assert.equal(g.id, 'local.cool-notes');
  assert.equal(g.entry, 'index.html');
  assert.deepEqual(g.permissions, ['storage', 'clipboard']);
  assert.equal(guessManifest(new Map([['pages/start.html', enc.encode('')]])).entry, 'pages/start.html');
  assert.doesNotThrow(() => manifestFromFields(g));
});

test('lint: a clean app has no errors or warnings', () => {
  const issues = lint({ 'index.html': '<script src="a.js"></script>', 'a.js': 'appverse.storage.get("k")' }, { permissions: ['storage'] });
  assert.deepEqual(levels(issues, 'error').concat(levels(issues, 'warn')), []);
});

test('lint: errors for the network, missing files, a CSP of its own and wrong file kinds', () => {
  assert.match(levels(lint({ 'index.html': '<script src="https://cdn.example/x.js"></script>' }), 'error')[0], /from the network/);
  assert.match(levels(lint({ 'index.html': '<img src="gone.png">' }), 'error')[0], /not in the package/);
  assert.match(levels(lint({ 'index.html': '<meta http-equiv="Content-Security-Policy" content="x">' }), 'error')[0], /own Content-Security-Policy/);
  assert.match(levels(lint({ 'index.html': '', 'x.wasm': '' }), 'error')[0], /Not allowed: x\.wasm/);
  assert.match(levels(lint({ 'main.html': '' }), 'error')[0], /not found/);
});

test('lint: warnings for permissions, browser storage, network calls and modules', () => {
  const w = (files, extra) => levels(lint(files, extra), 'warn').join('\n');
  assert.match(w({ 'index.html': '<script>appverse.copyText("x")</script>' }), /"clipboard" bridge/);
  assert.match(w({ 'index.html': '<script>localStorage.setItem("a", 1)</script>' }), /appverse\.storage/);
  assert.match(w({ 'index.html': '<script>fetch("/api")</script>' }), /network/);
  assert.match(w({ 'index.html': '<script src="a.js"></script>', 'a.js': 'import { x } from "./b.js";' }), /ES module/);
  assert.match(w({ 'index.html': '' }, { id: 'com.example.app' }), /placeholder/);
  assert.match(levels(lint({ 'index.html': '' }, { permissions: ['fullscreen'] }), 'info').join('\n'), /never uses it/);
});

test('buildApplet: manifest first, sorted files, about/playAt, and it reads back', async () => {
  const m = validateManifest({ applet: 1, id: 'com.mine.app', title: 'App', permissions: ['storage'] });
  const files = new Map([['b.js', enc.encode('1')], ['index.html', enc.encode('<script src="b.js"></script>')], ['a.css', enc.encode('p{}')]]);
  const back = await readZip(await (await buildApplet(m, files)).arrayBuffer());
  assert.deepEqual([...back.keys()], ['manifest.json', 'a.css', 'b.js', 'index.html']);
  const written = JSON.parse(new TextDecoder().decode(back.get('manifest.json')));
  assert.deepEqual(Object.keys(written).slice(0, 3), ['applet', 'about', 'playAt']);
  assert.deepEqual(validateManifest(written).permissions, ['storage']);
  assert.ok(!('author' in written), 'empty optional fields are left out');
  await assert.rejects(() => buildApplet(m, new Map([['index.html', enc.encode('')], ['x.exe', enc.encode('')]])), /Not allowed/);
});
