// A local app library: add .applet files, list them, run them, download or remove them. Stored in IndexedDB.
import { readZip, sha256Hex } from './zip.js';
import { validateManifest, assertAppletPackage, PERMISSIONS } from './manifest.js';
import { runApplet } from './sandbox.js';
import { downloadBlob } from './zipwrite.js';

const $ = (id) => document.getElementById(id);
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
const MAX_APPLET_BYTES = 50 * 1024 * 1024;

let apps = [];
let featured = [];
let running = null;

// ---------------------------------------------------------------- storage

const db = {
  open: null,
  conn() {
    this.open ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('appverse-library', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('apps', { keyPath: 'hash' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.open;
  },
  async tx(mode, fn) {
    const conn = await this.conn();
    return new Promise((resolve, reject) => {
      const t = conn.transaction('apps', mode);
      const result = fn(t.objectStore('apps'));
      t.oncomplete = () => resolve(result.result);
      t.onerror = t.onabort = () => reject(t.error);
    });
  },
  all() { return this.tx('readonly', (s) => s.getAll()); },
  put(app) { return this.tx('readwrite', (s) => s.put(app)); },
  remove(hash) { return this.tx('readwrite', (s) => s.delete(hash)); },
};

// ---------------------------------------------------------------- adding

function showError(msg) {
  $('lib-error').textContent = msg;
  $('lib-error').hidden = !msg;
}

async function parseApplet(file) {
  if (!/\.applet$/i.test(file.name)) throw new Error('not an .applet file');
  if (file.size > MAX_APPLET_BYTES) throw new Error(`larger than ${kb(MAX_APPLET_BYTES)}`);
  return parseBytes(await file.arrayBuffer());
}

/** A package's bytes -> the record the library keeps. Throws if they are not a valid applet. */
async function parseBytes(buf) {
  if (buf.byteLength > MAX_APPLET_BYTES) throw new Error(`larger than ${kb(MAX_APPLET_BYTES)}`);
  const files = await readZip(buf);
  const mjson = files.get('manifest.json');
  if (!mjson) throw new Error('no manifest.json');
  let raw;
  try { raw = JSON.parse(new TextDecoder().decode(mjson)); } catch { throw new Error('manifest.json is not valid JSON'); }
  const manifest = validateManifest(raw);
  assertAppletPackage(manifest, files);
  return { hash: await sha256Hex(buf), manifest, size: buf.byteLength, files: files.size, added: Date.now(), blob: new Blob([buf]) };
}

async function addFiles(list) {
  showError('');
  const problems = [];
  let added = 0, dupes = 0;
  const known = new Set(apps.map((a) => a.hash));
  for (const file of list) {
    try {
      const app = await parseApplet(file);
      if (known.has(app.hash)) { dupes++; continue; }
      await db.put(app);
      known.add(app.hash);
      added++;
    } catch (e) {
      problems.push(`${file.name}: ${e.message || e}`);
    }
  }
  const parts = [added && `Added ${added} app${added === 1 ? '' : 's'}.`, dupes && `${dupes} already in the library.`].filter(Boolean);
  $('lib-note').textContent = parts.join(' ');
  $('lib-note').hidden = !parts.length;
  showError(problems.join('\n'));
  await refresh();
}

// ---------------------------------------------------------------- listing

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

const matches = (q, ...parts) => !q || parts.join('\n').toLowerCase().includes(q);

function renderFeatured(q) {
  const shown = featured.filter((f) => matches(q, f.title, f.author, f.description));
  $('feat-count').textContent = `Featured apps (${featured.length})`;
  const inLibrary = new Set(apps.map((a) => a.manifest.id));
  $('feat-list').replaceChildren(...shown.map((f) => {
    const meta = [f.author && `by ${f.author}`, kb(f.size)].filter(Boolean).join(' · ');
    const owned = inLibrary.has(f.id);
    return el('li', {},
      el('h3', { textContent: f.title }),
      el('p', { className: 'small', textContent: meta }),
      el('p', { textContent: f.description }),
      el('p', { className: 'actions' },
        el('button', { type: 'button', textContent: 'Run', onclick: () => runFeatured(f) }),
        el('button', { type: 'button', className: 'secondary', textContent: owned ? 'In your library' : 'Add to library', disabled: owned, onclick: () => addFeatured(f) })));
  }));
  if (featured.length && !shown.length) $('feat-list').append(el('li', { className: 'small', textContent: 'No featured apps match that search.' }));
}

async function loadFeatured() {
  try {
    const res = await fetch('examples/catalog.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    featured = await res.json();
  } catch (e) {
    featured = [];
    $('feat-note').textContent = `The featured apps could not be loaded (${e.message || e}).`;
    $('feat-note').hidden = false;
  }
  render();
}

async function fetchFeatured(f) {
  const res = await fetch(f.file);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

async function runFeatured(f) {
  showError('');
  try {
    await run(await parseApplet(new File([await fetchFeatured(f)], `${f.slug}.applet`)));
  } catch (e) {
    showError(`Could not start ${f.title}: ${e.message || e}`);
  }
}

async function addFeatured(f) {
  try {
    await addFiles([new File([await fetchFeatured(f)], `${f.slug}.applet`)]);
  } catch (e) {
    showError(`Could not add ${f.title}: ${e.message || e}`);
  }
}

function render() {
  const q = $('lib-search').value.trim().toLowerCase();
  renderFeatured(q);
  const shown = apps.filter(({ manifest: m }) => matches(q, m.title, m.author, m.description, m.id));

  $('lib-count').textContent = `Your apps (${apps.length})`;
  $('lib-empty').hidden = apps.length > 0;
  $('lib-list').replaceChildren(...shown.map((a) => {
    const m = a.manifest;
    const perms = m.permissions.map((p) => PERMISSIONS[p]).join('; ');
    const meta = [m.author && `by ${m.author}`, m.version && `v${m.version}`, kb(a.size)].filter(Boolean).join(' · ');
    return el('li', {},
      el('h3', { textContent: m.title }),
      el('p', { className: 'small', textContent: meta }),
      m.description ? el('p', { textContent: m.description }) : '',
      el('p', { className: 'small', textContent: `License: ${m.license || 'not specified'}. Asks to: ${perms || 'nothing special'}.` }),
      el('p', { className: 'small' }, 'SHA-256 ', el('code', { textContent: a.hash.slice(0, 16) + '…', title: a.hash })),
      el('p', { className: 'actions' },
        el('button', { type: 'button', textContent: 'Run', onclick: () => run(a) }),
        el('button', { type: 'button', className: 'secondary', textContent: 'Download', onclick: () => downloadBlob(a.blob, `${m.id.split('.').pop() || 'app'}.applet`) }),
        el('button', { type: 'button', className: 'secondary', textContent: 'Remove', onclick: () => remove(a) })));
  }));
  if (apps.length && !shown.length) $('lib-list').append(el('li', { className: 'small', textContent: 'No apps match that search.' }));
}

async function refresh() {
  try {
    apps = (await db.all()).sort((a, b) => a.manifest.title.localeCompare(b.manifest.title));
  } catch (e) {
    apps = [];
    showError(`The library could not be opened in this browser (${e.message || e}). Private windows often block it.`);
  }
  render();
}

// ---------------------------------------------------------------- actions

function stop() {
  running?.stop();
  running = null;
  $('stage').hidden = true;
}

async function run(a) {
  stop();
  showError('');
  try {
    const files = await readZip(await a.blob.arrayBuffer());
    $('stage').hidden = false;
    $('s-title').textContent = a.manifest.title;
    running = runApplet(a.manifest, files, $('screen'), { hash: a.hash });
    $('full').hidden = !running.canFullscreen;
    $('stage').scrollIntoView({ block: 'nearest' });
  } catch (e) {
    stop();
    showError(`Could not start ${a.manifest.title}: ${e.message || e}`);
  }
}

async function remove(a) {
  if (!confirm(`Remove "${a.manifest.title}" from the library? Its file is deleted from this browser.`)) return;
  await db.remove(a.hash);
  await refresh();
}

// ---------------------------------------------------------------- wiring

const zone = $('dropzone');
zone.onclick = () => $('in-files').click();
zone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('in-files').click(); } };
$('in-files').onchange = (e) => { const list = [...e.target.files]; e.target.value = ''; addFiles(list); };
for (const ev of ['dragenter', 'dragover']) addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); });
addEventListener('drop', (e) => { const list = [...(e.dataTransfer?.files ?? [])]; if (list.length) addFiles(list); });
$('lib-search').oninput = render;
$('stop').onclick = stop;
$('full').onclick = () => running?.fullscreen();

loadFeatured();
refresh();
