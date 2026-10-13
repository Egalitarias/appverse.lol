// The logic behind the applet packer (tools/pack.mjs now, an in-browser packer later): tidy up a set of files, guess a
// manifest, check a package for common mistakes, and build the .applet. No DOM in here, so it runs in Node too.
import { LIMITS, safePath } from './zip.js';
import { validateManifest, appletManifestText, disallowedFiles, assertAppletPackage } from './manifest.js';
import { buildDocument } from './sandbox.js';
import { buildZipCompressed } from './zipwrite.js';

const dec = new TextDecoder();
const kb = (n) => (n / 1024 >= 100 ? `${Math.round(n / 1024)} KB` : `${(n / 1024).toFixed(1)} KB`);
const isHtml = (n) => /\.html?$/i.test(n);

// ---------------------------------------------------------------- tidy a set of files

/** list: [{ path, data }] -> { files: Map(path -> Uint8Array), folder, skipped, errors }.
 *  Drops dotfiles and OS junk, and strips the one top-level folder you get when dropping a folder. */
export function normalizeFiles(list) {
  const errors = [];
  let skipped = 0;
  let items = [];
  for (const { path, data } of list) {
    const p = String(path).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
    const segs = p.split('/');
    if (segs.includes('..')) { errors.push(`Unsafe path in the files: ${p}`); continue; }
    if (!p || segs.some((s) => s.startsWith('.') || s === '__MACOSX' || s === 'node_modules' || /^(thumbs\.db|desktop\.ini)$/i.test(s))) { skipped++; continue; }
    items.push({ path: p, data: data instanceof Uint8Array ? data : new Uint8Array(data) });
  }
  let folder = '';
  if (items.length && items.every((i) => i.path.includes('/')) && new Set(items.map((i) => i.path.split('/')[0])).size === 1) {
    folder = items[0].path.split('/')[0];
    items = items.map((i) => ({ ...i, path: i.path.slice(folder.length + 1) }));
  }
  // AGENTS.md is a note for the AI agent helping write the app, not part of the app
  const before = items.length;
  items = items.filter((i) => i.path !== 'AGENTS.md');
  skipped += before - items.length;
  const files = new Map();
  let total = 0;
  for (const { path, data } of items) {
    try { safePath(path); } catch (e) { errors.push(e.message); continue; }
    if (files.has(path)) { errors.push(`Two files have the same path: ${path}`); continue; }
    if (data.length > LIMITS.maxFileBytes) { errors.push(`${path} is ${kb(data.length)}; a single file may be at most ${kb(LIMITS.maxFileBytes)}`); continue; }
    total += data.length;
    files.set(path, data);
  }
  if (files.size > LIMITS.maxEntries) errors.push(`${files.size} files is too many (the limit is ${LIMITS.maxEntries})`);
  if (total > LIMITS.maxTotalBytes) errors.push(`The files add up to ${kb(total)}; the limit is ${kb(LIMITS.maxTotalBytes)}`);
  return { files, folder, skipped, errors };
}

// ---------------------------------------------------------------- manifest

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Reads manifest.json if there is one: { raw } or { error }. */
export function readManifest(files) {
  const bytes = files.get('manifest.json');
  if (!bytes) return {};
  try {
    const raw = JSON.parse(dec.decode(bytes));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'manifest.json must contain a JSON object' };
    return { raw };
  } catch (e) {
    return { error: `manifest.json is not valid JSON (${e.message})` };
  }
}

/** The text of the app's own code (its scripts and pages), for the checks below. */
function sourceText(files) {
  return [...files].filter(([n]) => /\.(?:js|html?)$/i.test(n)).map(([, d]) => dec.decode(d)).join('\n');
}

/** Sensible form values for a set of files (and the folder name they came from). */
export function guessManifest(files, folder = '') {
  const pages = [...files.keys()].filter(isHtml);
  const byDepth = (a, b) => a.split('/').length - b.split('/').length || a.length - b.length;
  const entry = files.has('index.html') ? 'index.html' : ([...pages].sort(byDepth)[0] ?? 'index.html');
  const src = sourceText(files);
  const title = (folder.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'My App').slice(0, 80);
  const permissions = [];
  if (/\bappverse\.storage\b/.test(src)) permissions.push('storage');
  if (/\bappverse\.copyText\b/.test(src)) permissions.push('clipboard');
  if (/\bappverse\.requestFullscreen\b/.test(src)) permissions.push('fullscreen');
  return {
    id: `local.${slug(title) || 'app'}`.slice(0, 64), title, author: '', version: '1.0.0', description: '', license: '',
    entry, width: 480, height: 640, permissions,
  };
}

/** Form values -> a validated manifest (throws a readable message if something is wrong). */
export function manifestFromFields(f) {
  return validateManifest({
    applet: 1, id: f.id, title: f.title, author: f.author, version: f.version, description: f.description,
    license: f.license, entry: f.entry, width: Number(f.width), height: Number(f.height), permissions: f.permissions,
  });
}

// ---------------------------------------------------------------- checks

/** Looks for mistakes that would stop an app from working. -> [{ level: 'error' | 'warn' | 'info', file?, message }] */
export function lintApplet(manifest, files) {
  const out = [];
  const add = (level, message, file) => out.push({ level, message, ...(file ? { file } : {}) });
  const perms = manifest.permissions ?? [];

  // the same gate the player applies: entry, allowed files, no CSP of its own
  try {
    assertAppletPackage(manifest, files);
  } catch (e) {
    add('error', e.message);
    return out;
  }
  // and the same build: it fails on a missing file or anything loaded from the network
  try { buildDocument(manifest, files); } catch (e) { add('error', e.message, manifest.entry); }

  const notAllowed = disallowedFiles(files);
  if (notAllowed.length) add('error', `Remove: ${notAllowed.slice(0, 8).join(', ')}${notAllowed.length > 8 ? `, and ${notAllowed.length - 8} more` : ''}.`);
  if (/^com\.example\./.test(manifest.id)) add('warn', `The id "${manifest.id}" is a placeholder. Use your own, such as the reverse of a domain you own (com.mystudio.myapp).`);
  if (!manifest.license) add('info', 'No license is set. People will see "License: not specified".');

  let total = 0;
  for (const data of files.values()) total += data.length;
  if (total > 20 * 1024 * 1024) add('warn', `The package is large (${kb(total)} before compression). Smaller apps load faster.`);

  const src = sourceText(files);
  const uses = { storage: /\bappverse\.storage\b/.test(src), clipboard: /\bappverse\.copyText\b/.test(src), fullscreen: /\bappverse\.requestFullscreen\b/.test(src) };
  for (const p of Object.keys(uses)) {
    if (uses[p] && !perms.includes(p)) add('warn', `The app uses the "${p}" bridge but the manifest does not ask for the "${p}" permission, so those calls will fail.`);
    if (!uses[p] && perms.includes(p)) add('info', `The manifest asks for "${p}" but the app never uses it. People are shown every permission, so remove what you do not need.`);
  }
  if (/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|document\.cookie/.test(src)) add('warn', 'The app uses localStorage, sessionStorage, IndexedDB or cookies, which do not work in the sandbox. Use appverse.storage (with the "storage" permission) instead.');
  if (/document\.write(?:ln)?\s*\(|\.srcdoc\b|\bsrcdoc\s*=/.test(src)) add('warn', 'The app uses document.write or an iframe srcdoc. Apps cannot make frames or use document.write (they are refused), so build the page with the DOM instead.');
  if (/\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b|\bEventSource\b|sendBeacon/.test(src)) add('warn', 'The app seems to use the network (fetch, XMLHttpRequest, WebSocket or similar). Apps have no network access, so these calls will fail. Put data in the package instead.');
  for (const [name, data] of files) {
    if (/\.js$/i.test(name) && /^\s*import\s[^;]*\sfrom\s+["']/m.test(dec.decode(data))) add('warn', 'This file uses ES module imports, which do not work here. Bundle your JavaScript into plain scripts.', name);
  }
  const extra = [...files.keys()].filter((n) => isHtml(n) && n !== manifest.entry);
  if (extra.length) add('info', `Only the entry page runs; these other HTML pages cannot be opened by the app: ${extra.join(', ')}.`);
  return out;
}

// ---------------------------------------------------------------- build

/** manifest (validated) + files -> an .applet Blob, manifest first, everything else sorted by path. */
export async function buildApplet(manifest, files) {
  assertAppletPackage(manifest, files);
  const enc = new TextEncoder();
  const clean = Object.fromEntries(Object.entries(manifest).filter(([k, v]) => !(['author', 'version', 'description', 'license'].includes(k) && v === '')));
  const entries = [['manifest.json', enc.encode(appletManifestText(clean))]];
  for (const name of [...files.keys()].sort()) if (name !== 'manifest.json') entries.push([name, files.get(name)]);
  return buildZipCompressed(entries);
}
