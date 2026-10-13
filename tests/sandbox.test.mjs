import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, assertAppletPackage } from '../js/manifest.js';
import { buildDocument, createBridge, CSP, MAX_STORAGE_BYTES } from '../js/sandbox.js';
import { readZip } from '../js/zip.js';
import { buildZip, buildZipCompressed } from '../js/zipwrite.js';

const enc = new TextEncoder();
const pkg = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' ? enc.encode(v) : v]));
const manifest = (extra = {}) => validateManifest({ applet: 1, id: 'com.example.notes', title: 'Notes', ...extra });

test('manifest: defaults, and what it refuses', () => {
  const m = manifest();
  assert.equal(m.entry, 'index.html');
  assert.deepEqual(m.permissions, []);
  assert.throws(() => validateManifest({ id: 'com.example.x', title: 'x' }), /applet must be 1/);
  assert.throws(() => manifest({ id: 'A' }), /manifest.id/);
  assert.throws(() => manifest({ permissions: ['network'] }), /permissions may only contain/);
  assert.throws(() => manifest({ permissions: ['__proto__'] }), /permissions may only contain/);
  assert.throws(() => manifest({ entry: 'main.cs' }), /entry must be an HTML/);
  assert.deepEqual(manifest({ permissions: ['storage', 'storage'] }).permissions, ['storage']);
});

test('package: only web files, an HTML entry, and no CSP of its own', () => {
  const m = manifest();
  assertAppletPackage(m, pkg({ 'index.html': '<p>hi</p>', 'a.js': '1', 'img/x.png': new Uint8Array(3) }));
  assert.throws(() => assertAppletPackage(m, pkg({ 'a.js': '1' })), /not found/);
  assert.throws(() => assertAppletPackage(m, pkg({ 'index.html': '', 'x.wasm': '' })), /Not allowed: x\.wasm/);
  assert.throws(() => assertAppletPackage(m, pkg({ 'index.html': '', 'run.exe': '' })), /Not allowed/);
  assert.throws(() => assertAppletPackage(m, pkg({ 'index.html': '<meta http-equiv="Content-Security-Policy" content="x">' })), /sets its own Content-Security-Policy/);
  assert.throws(() => assertAppletPackage(m, pkg({ 'index.html': '', 'other.html': "<META HTTP-EQUIV='content-security-policy'>" })), /other\.html sets its own/);
});

test('document: the CSP meta and the bridge come before any of the app', () => {
  const doc = buildDocument(manifest(), pkg({ 'index.html': '<!doctype html><html><head><title>t</title></head><body><script>boot()</script></body></html>' }));
  assert.ok(doc.startsWith('<!doctype html><html><head><meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy"'));
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('window.appverse'));
  assert.ok(doc.indexOf('window.appverse') < doc.indexOf('boot()'));
  for (const need of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "frame-src 'none'", "base-uri 'none'"]) assert.ok(CSP.includes(need), need);
  assert.ok(!/unsafe-eval|http:|https:/.test(CSP));
});

test('document: the manifest is embedded safely', () => {
  const doc = buildDocument(manifest({ title: '</script><script>alert(1)</script>' }), pkg({ 'index.html': '<p>x</p>' }));
  assert.ok(!doc.includes('</script><script>alert(1)'));
});

test('inlining: scripts, stylesheets, images, fonts and nested CSS', () => {
  const files = pkg({
    'index.html': '<link rel="stylesheet" href="css/a.css"><link rel="icon" href="x.ico"><img src="img/p.png" srcset="img/p2.png 2x"><script src="app.js"></script>',
    'css/a.css': '@import "b.css"; body { background: url(../img/p.png); } @font-face { src: url("f.woff2") }',
    'css/b.css': 'h1 { color: red }',
    'css/f.woff2': new Uint8Array([1, 2, 3]),
    'img/p.png': new Uint8Array([137, 80, 78, 71]),
    'app.js': 'const s = "</script>"; // <!-- tricky',
  });
  const doc = buildDocument(manifest(), files);
  assert.ok(doc.includes('h1 { color: red }'), 'imported css');
  assert.ok(doc.includes('url("data:image/png;base64,iVBORw==")'), 'css url');
  assert.ok(doc.includes('url("data:font/woff2;base64,AQID")'), 'font');
  assert.ok(doc.includes('<img src="data:image/png;base64,iVBORw=="'), 'img');
  assert.ok(!doc.includes('srcset') && !doc.includes('x.ico') && !/<link/.test(doc));
  assert.ok(doc.includes('const s = "<\\/script>"; // <\\!-- tricky'), 'script text escaped');
  assert.ok(!/\ssrc="(?!data:)/.test(doc), 'nothing left pointing at a file');
});

test('inlining: markup inside a script string and comments are left alone or dropped', () => {
  const doc = buildDocument(manifest(), pkg({ 'index.html': '<!-- <img src="https://evil/x.png"> --><script>const t = \'<img src="https://evil/y.png">\';</script>' }));
  assert.ok(!doc.includes('x.png'), 'comment dropped');
  assert.ok(doc.includes('<img src="https://evil/y.png">'), 'script text unchanged (the CSP, not the rewriter, blocks it)');
});

test('inlining: network references and missing files are errors', () => {
  const build = (html, extra = {}) => buildDocument(manifest(), pkg({ 'index.html': html, ...extra }));
  assert.throws(() => build('<script src="https://cdn.example/x.js"></script>'), /from the network/);
  assert.throws(() => build('<script src="//cdn.example/x.js"></script>'), /from the network/);
  assert.throws(() => build('<link rel="stylesheet" href="http://x/y.css">'), /from the network/);
  assert.throws(() => build('<img src="https://x/y.png">'), /from the network/);
  assert.throws(() => build('<style>a{background:url(https://x/y.png)}</style>'), /from the network/);
  assert.throws(() => build('<style>@import url("https://x/y.css");</style>'), /from the network/);
  assert.throws(() => build('<img src="nope.png">'), /not in the package/);
  assert.throws(() => build('<img src="../../etc/passwd">'), /outside the package/);
  assert.ok(build('<img src="data:image/gif;base64,R0lG"><a href="#top">x</a>').includes('data:image/gif;base64,R0lG'));
});

test('bridge: every call needs its permission', async () => {
  const saved = new Map();
  const store = { load: (id) => saved.get(id) ?? null, save: (id, d) => saved.set(id, d) };
  const calls = [];
  const opts = { store, copy: async (t) => calls.push(['copy', t]), fullscreen: async () => calls.push(['full']) };
  const none = createBridge(manifest(), opts);
  for (const [fn, arg] of [['storageGet', { key: 'a' }], ['storageSet', { key: 'a', value: 'b' }], ['storageRemove', { key: 'a' }], ['fullscreen', {}], ['copy', { text: 'x' }]])
    await assert.rejects(() => none[fn](arg), /not granted/, fn);
  assert.equal(saved.size + calls.length, 0);

  const all = createBridge(manifest({ permissions: ['storage', 'fullscreen', 'clipboard'] }), opts);
  assert.equal(await all.storageGet({ key: 'a' }), null);
  await all.storageSet({ key: 'a', value: '1' });
  await all.storageSet({ key: '__proto__', value: '2' });
  assert.equal(await all.storageGet({ key: 'a' }), '1');
  assert.equal(await all.storageGet({ key: '__proto__' }), '2');
  await all.storageRemove({ key: 'a' });
  assert.equal(await all.storageGet({ key: 'a' }), null);
  await all.fullscreen({});
  await all.copy({ text: 'hello' });
  assert.deepEqual(calls, [['full'], ['copy', 'hello']]);
});

test('bridge: bad keys, values and a full store are refused', async () => {
  const saved = new Map();
  const b = createBridge(manifest({ permissions: ['storage', 'clipboard'] }), { store: { load: (id) => saved.get(id) ?? null, save: (id, d) => saved.set(id, d) } });
  await assert.rejects(() => b.storageSet({ key: '', value: 'x' }), /storage key/);
  await assert.rejects(() => b.storageSet({ key: 'k'.repeat(101), value: 'x' }), /storage key/);
  await assert.rejects(() => b.storageSet({ key: 'k', value: 5 }), /must be a string/);
  await assert.rejects(() => b.storageSet({ key: 'big', value: 'x'.repeat(MAX_STORAGE_BYTES) }), /full/);
  await assert.rejects(() => b.copy({ text: 5 }), /Nothing to copy/);
  saved.set('com.example.notes', 'not json');
  assert.equal(await b.storageGet({ key: 'k' }), null, 'a damaged save reads as empty');
});

test('zip: a package round-trips, stored and compressed', async () => {
  const entries = [['manifest.json', enc.encode('{}')], ['index.html', enc.encode('<p>hello</p>'.repeat(50))]];
  for (const blob of [buildZip(entries), await buildZipCompressed(entries)]) {
    const files = await readZip(await blob.arrayBuffer());
    assert.deepEqual([...files.keys()], ['manifest.json', 'index.html']);
    assert.equal(new TextDecoder().decode(files.get('index.html')), '<p>hello</p>'.repeat(50));
  }
  await assert.rejects(() => buildZip([['../evil.html', enc.encode('x')]]).arrayBuffer().then(readZip), /Unsafe path/);
  await assert.rejects(() => readZip(enc.encode('not a zip at all, just text')), /Not a valid/);
});

test('the example app packs, and runs as a document', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const out = `${mkdtempSync(`${tmpdir()}/applet-`)}/notes.applet`;
  execFileSync('node', ['tools/pack.mjs', 'examples/notes', out], { cwd: new URL('../', import.meta.url) });
  const files = await readZip(new Uint8Array(readFileSync(out)));
  const m = validateManifest(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))));
  const doc = buildDocument(m, files);
  assert.ok(doc.includes('appverse.storage.get') && doc.includes('textarea { flex: 1'));
  assert.ok(!/\s(?:src|href)="(?!data:|#)/.test(doc.slice(doc.indexOf('<title>Notes'))));
});

test('saved data is kept under the hash of the package, so an app cannot claim another app\'s by id', async () => {
  const { localStore } = await import('../js/sandbox.js');
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const hashA = 'a'.repeat(64), hashB = 'b'.repeat(64);

  localStore(hashA, storage).save('lol.appverse.notes', 'secret');
  assert.equal(localStore(hashA, storage).load('whatever.id'), 'secret', 'the same package gets its data back, whatever id it asks with');
  assert.equal(localStore(hashB, storage).load('lol.appverse.notes'), null, 'a different package starts empty, even with the same id');

  // data an older version kept under the declared id is never handed out
  mem.set('appverse:storage:lol.appverse.notes', 'legacy');
  assert.equal(localStore(hashB, storage).load('lol.appverse.notes'), null);
  assert.deepEqual([...mem.keys()].filter((k) => k.includes('hash')), []);
  assert.ok([...mem.keys()].every((k) => !k.includes('lol.appverse.notes') || k === 'appverse:storage:lol.appverse.notes'));

  assert.throws(() => localStore('', storage), /slot/);
  assert.throws(() => localStore(undefined, storage), /slot/);
});
