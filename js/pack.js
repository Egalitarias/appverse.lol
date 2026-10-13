// The in-browser packer: load an app folder (or .zip / .applet), fill in the manifest, check it, test it, download it.
import { readZip } from './zip.js';
import { runApplet } from './sandbox.js';
import { downloadBlob } from './zipwrite.js';
import { normalizeFiles, guessManifest, readManifest, manifestFromFields, lintApplet, buildApplet } from './packer.js';

const $ = (id) => document.getElementById(id);
const FIELD_IDS = { title: 'f-title', id: 'f-id', author: 'f-author', version: 'f-version', license: 'f-license', description: 'f-desc', entry: 'f-entry', width: 'f-width', height: 'f-height' };
const PERMISSION_BOXES = { storage: 'f-storage', clipboard: 'f-clipboard', fullscreen: 'f-fullscreen' };
const MAX_FILES_TO_READ = 5000;
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
const isHtml = (n) => /\.html?$/i.test(n);

let files = new Map();
let sourceName = '';
let running = null;
let current = { manifest: null, errors: 1 };

// ---------------------------------------------------------------- loading

function showLoadError(msg) {
  $('load-error').textContent = msg;
  $('load-error').hidden = !msg;
}

async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ path: prefix + entry.name, file });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walkEntry(e, prefix + entry.name + '/', out);
      if (out.length > MAX_FILES_TO_READ) return;
    }
  }
}

async function listFromDrop(dt) {
  // webkitGetAsEntry must be called during the drop event, before any await
  const entries = [...(dt.items ?? [])].map((i) => (i.kind === 'file' && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  if (entries.some(Boolean)) {
    const out = [];
    for (const e of entries) if (e) await walkEntry(e, '', out);
    return out;
  }
  return [...dt.files].map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}

async function loadList(list) {
  showLoadError('');
  stopTest();
  try {
    if (!list.length) throw new Error('No files found. Drop a folder, or choose one with the button.');
    if (list.length > MAX_FILES_TO_READ) throw new Error(`That is more than ${MAX_FILES_TO_READ} files. Packages hold at most 2000: remove what the app does not use.`);
    let items, name = '';
    if (list.length === 1 && /\.(zip|applet)$/i.test(list[0].file.name)) {
      name = list[0].file.name.replace(/\.(zip|applet)$/i, '');
      const entries = await readZip(await list[0].file.arrayBuffer());
      items = [...entries].map(([path, data]) => ({ path, data }));
    } else {
      items = await Promise.all(list.map(async ({ path, file }) => ({ path, data: new Uint8Array(await file.arrayBuffer()) })));
    }
    const result = normalizeFiles(items);
    if (result.errors.length) throw new Error(result.errors.join('\n'));
    if (!result.files.size) throw new Error('There are no usable files in that selection (hidden files and OS junk are ignored).');
    files = result.files;
    sourceName = result.folder || name;
    fillForm();
    $('step-edit').hidden = false;
    $('step-load').hidden = true;
    $('summary').textContent = `${files.size} file${files.size === 1 ? '' : 's'}, ${kb([...files.values()].reduce((s, d) => s + d.length, 0))}${result.skipped ? ` (${result.skipped} hidden or junk file${result.skipped === 1 ? '' : 's'} ignored)` : ''}.`;
  } catch (e) {
    showLoadError(e.message || String(e));
  }
}

// ---------------------------------------------------------------- the form

function setEntryOptions(current) {
  let names = [...files.keys()].filter(isHtml);
  if (!names.length) names = [...files.keys()];
  if (current && !names.includes(current)) names.unshift(current);
  names.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const sel = $('f-entry');
  sel.replaceChildren(...names.map((n) => Object.assign(document.createElement('option'), { value: n, textContent: n })));
  if (current) sel.value = current;
}

function fillForm() {
  const found = readManifest(files);
  const guess = guessManifest(files, sourceName);
  const raw = found.raw ?? {};
  const note = found.error ? `${found.error}. Starting from your files instead.` : (found.raw ? 'Found a manifest.json: its values are filled in below. You can change them.' : 'No manifest.json found: these values are guesses. Check them.');
  const pick = (k, type = 'string') => (type === 'int' ? (Number.isInteger(raw[k]) ? raw[k] : guess[k]) : (typeof raw[k] === 'string' ? raw[k] : guess[k]));
  const v = {
    title: pick('title'), id: pick('id'), author: pick('author'), version: pick('version'), license: pick('license'),
    description: pick('description'), entry: pick('entry'), width: pick('width', 'int'), height: pick('height', 'int'),
    permissions: Array.isArray(raw.permissions) ? raw.permissions : guess.permissions,
  };
  for (const [k, id] of Object.entries(FIELD_IDS)) if (k !== 'entry') $(id).value = v[k];
  setEntryOptions(v.entry);
  for (const [p, id] of Object.entries(PERMISSION_BOXES)) $(id).checked = v.permissions.includes(p);
  $('files').replaceChildren(...[...files].sort((a, b) => a[0].localeCompare(b[0])).map(([name, data]) => {
    const li = document.createElement('li');
    li.append(Object.assign(document.createElement('span'), { textContent: name }), Object.assign(document.createElement('span'), { className: 'size', textContent: kb(data.length) }));
    return li;
  }));
  $('load-note').textContent = note;
  $('action-note').hidden = true;
  refresh();
}

function readFields() {
  const f = {};
  for (const [k, id] of Object.entries(FIELD_IDS)) f[k] = $(id).value;
  f.permissions = Object.entries(PERMISSION_BOXES).filter(([, id]) => $(id).checked).map(([p]) => p);
  return f;
}

function refresh() {
  let findings;
  let manifest = null;
  try {
    manifest = manifestFromFields(readFields());
    findings = lintApplet(manifest, files);
  } catch (e) {
    findings = [{ level: 'error', message: e.message }];
  }
  const count = (lvl) => findings.filter((f) => f.level === lvl).length;
  const errors = count('error'), warns = count('warn');
  current = { manifest, errors };
  $('check-summary').textContent = errors ? `${errors} problem${errors === 1 ? '' : 's'} to fix before this can be packed.`
    : warns ? `No blocking problems. ${warns} warning${warns === 1 ? '' : 's'}: the app may not work as intended.`
      : 'All checks passed.';
  $('check-summary').className = errors ? 'bad' : warns ? 'warn' : 'good';
  const order = { error: 0, warn: 1, info: 2 };
  $('checks').replaceChildren(...findings.slice().sort((a, b) => order[a.level] - order[b.level]).map((f) => {
    const li = document.createElement('li');
    li.className = `lvl-${f.level}`;
    li.append(Object.assign(document.createElement('b'), { textContent: f.level === 'warn' ? 'warning' : f.level }));
    if (f.file) li.append(Object.assign(document.createElement('code'), { textContent: f.file }));
    li.append(Object.assign(document.createElement('span'), { textContent: f.message }));
    return li;
  }));
  $('btn-test').disabled = $('btn-download').disabled = errors > 0;
}

let timer;
const refreshSoon = () => { clearTimeout(timer); timer = setTimeout(refresh, 150); }; // the check builds the whole page, so not on every keystroke

// ---------------------------------------------------------------- actions

function stopTest() {
  running?.stop();
  running = null;
  $('stage').hidden = true;
}

function testIt() {
  if (current.errors || !current.manifest) return;
  stopTest();
  try {
    $('stage').hidden = false;
    running = runApplet(current.manifest, files, $('screen'), { saves: tempStorage() });
    $('stage').scrollIntoView({ block: 'nearest' });
  } catch (e) {
    $('stage').hidden = true;
    $('action-note').textContent = `Could not start the app: ${e.message || e}`;
    $('action-note').hidden = false;
  }
}

/** A test run keeps its saved data in memory only, so testing never writes to your library's storage. */
function tempStorage() {
  const mem = new Map();
  return { load: (id) => mem.get(id) ?? null, save: (id, data) => { mem.set(id, data); } };
}

async function download() {
  if (current.errors || !current.manifest) return;
  const note = $('action-note');
  try {
    const blob = await buildApplet(current.manifest, files);
    const check = await readZip(await blob.arrayBuffer()); // read it back the way the site will
    if (!check.has('manifest.json') || !check.has(current.manifest.entry)) throw new Error('The built package failed its self-check. Please report this.');
    const name = (current.manifest.id.split('.').pop() || 'app') + '.applet';
    downloadBlob(blob, name);
    note.textContent = `Built ${name}: ${check.size} files, ${kb(blob.size)}. It reads back correctly. Drop it on the home page to run it.`;
  } catch (e) {
    note.textContent = `Could not build the package: ${e.message || e}`;
  }
  note.hidden = false;
}

function reset() {
  stopTest();
  files = new Map();
  $('step-edit').hidden = true;
  $('step-load').hidden = false;
  showLoadError('');
}

// ---------------------------------------------------------------- wiring

const zone = $('dropzone');
$('btn-folder').onclick = (e) => { e.stopPropagation(); $('in-folder').click(); };
$('btn-zip').onclick = (e) => { e.stopPropagation(); $('in-zip').click(); };
zone.onclick = () => $('in-folder').click();
zone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('in-folder').click(); } };
$('in-folder').onchange = (e) => {
  const list = [...e.target.files].map((file) => ({ path: file.webkitRelativePath || file.name, file }));
  e.target.value = '';
  loadList(list);
};
$('in-zip').onchange = (e) => {
  const list = [...e.target.files].map((file) => ({ path: file.name, file }));
  e.target.value = '';
  loadList(list);
};
for (const ev of ['dragenter', 'dragover']) addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); });
addEventListener('drop', (e) => {
  if ($('step-load').hidden) return;
  const pending = listFromDrop(e.dataTransfer);
  pending.then(loadList).catch((err) => showLoadError(err.message || String(err)));
});

for (const id of [...Object.values(FIELD_IDS), ...Object.values(PERMISSION_BOXES)]) {
  $(id).addEventListener('input', refreshSoon);
  $(id).addEventListener('change', refresh);
}
$('btn-test').onclick = testIt;
$('btn-stop').onclick = stopTest;
$('btn-download').onclick = download;
$('btn-reset').onclick = reset;
