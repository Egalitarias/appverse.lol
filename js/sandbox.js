// Builds a self-contained document from an applet package and runs it in a locked-down iframe.
//
// Layers of defence:
//  1. iframe sandbox="allow-scripts" (no allow-same-origin => opaque origin: no access to our cookies/storage/DOM,
//     no popups, no top navigation, no forms, no downloads).
//  2. A CSP <meta> that is the first thing in the document we build: no network, no external resources, no frames.
//     The app's own HTML comes after it, so nothing in the app can run before the policy is in force.
//  3. The only channel out is the postMessage bridge below, filtered by manifest permissions.
//
// The package's files are inlined into the one document (scripts and styles as inline code, images, fonts and media as
// data: URLs), because the frame is allowed no network and no other origin. That also means the page that runs an app
// must allow 'unsafe-inline' script and style and data: images, media and fonts in its own CSP: srcdoc inherits it.
// Keep CSP below and that page policy in step.

import { assertAppletPackage } from './manifest.js';

export const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  'worker-src blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

export const MAX_STORAGE_BYTES = 256 * 1024;
const MAX_KEY = 100;
const MAX_COPY = 100 * 1024;
const text = new TextDecoder();
const encoder = new TextEncoder();

// Runs inside the app iframe. __APPLET_MANIFEST__ is replaced by the manifest as JSON.
const SHIM = `(() => {
  const pending = new Map(); let n = 0;
  const call = (type, extra) => new Promise((res, rej) => {
    const id = ++n; pending.set(id, { res, rej });
    parent.postMessage({ applet: 1, id, type, ...extra }, '*');
  });
  addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== parent || !m || m.applet !== 1) return;
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id);
    m.error ? p.rej(new Error(m.error)) : p.res(m.result);
  });
  window.appverse = Object.freeze({
    manifest: __APPLET_MANIFEST__,
    storage: Object.freeze({
      get: (key) => call('storageGet', { key: String(key) }),
      set: (key, value) => call('storageSet', { key: String(key), value: String(value) }),
      remove: (key) => call('storageRemove', { key: String(key) }),
    }),
    requestFullscreen: () => call('fullscreen'),
    copyText: (value) => call('copy', { text: String(value) }),
  });
})();`;

const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

// ---- inlining the package's files ------------------------------------------------------------------------------

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
  css: 'text/css', js: 'text/javascript', json: 'application/json', txt: 'text/plain', md: 'text/plain', html: 'text/html', htm: 'text/html',
};
const mimeOf = (path) => MIME[path.split('.').pop().toLowerCase()] ?? 'application/octet-stream';

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const dataUrl = (path, bytes) => `data:${mimeOf(path)};base64,${toBase64(bytes)}`;

/** 'data' | 'skip' (a #fragment or empty) | 'external' (has a scheme, or starts with //) | 'local' */
function refKind(ref) {
  const r = ref.trim();
  if (!r || r.startsWith('#')) return 'skip';
  if (/^data:/i.test(r)) return 'data';
  if (/^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith('//')) return 'external';
  return 'local';
}

/** The package path a reference points at, from the file that holds it (`from` is that file's path). */
function resolveRef(from, ref) {
  let r = ref.trim().replace(/[?#].*$/, '');
  try { r = decodeURIComponent(r); } catch { /* keep as is */ }
  const parts = r.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const seg of r.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) throw new Error(`"${ref}" in ${from} points outside the package`);
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

function fileFor(files, from, ref) {
  const path = resolveRef(from, ref);
  const bytes = files.get(path);
  if (!bytes) throw new Error(`${from} refers to "${ref}", which is not in the package`);
  return { path, bytes };
}

const external = (from, ref) => new Error(`${from} loads "${ref}" from the network, which apps cannot do: put the file in the package`);

/** Turns a local reference into a data: URL; leaves data: and #fragment references alone. */
function inlineRef(files, from, ref) {
  const kind = refKind(ref);
  if (kind === 'external') throw external(from, ref);
  if (kind !== 'local') return ref;
  const { path, bytes } = fileFor(files, from, ref);
  return dataUrl(path, bytes);
}

/** CSS with @import and url() resolved against the stylesheet's own path (`from`). */
function inlineCss(files, from, css, depth = 0) {
  if (depth > 5) throw new Error(`${from}: @import is nested too deeply`);
  css = css.replace(/@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?[^;]*;/gi, (all, q, ref) => {
    const kind = refKind(ref);
    if (kind === 'external') throw external(from, ref);
    if (kind !== 'local') return all;
    const { path, bytes } = fileFor(files, from, ref);
    return inlineCss(files, path, text.decode(bytes), depth + 1);
  });
  return css
    .replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, (all, q, ref) => {
      const kind = refKind(ref);
      return kind === 'local' || kind === 'external' ? `url("${inlineRef(files, from, ref)}")` : all;
    })
    .replace(/<\/style/gi, '<\\/style');
}

const attrRe = (name) => new RegExp(`(\\s${name}\\s*=\\s*)("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
const getAttr = (tag, name) => {
  const m = attrRe(name).exec(tag);
  return m ? (m[3] ?? m[4] ?? m[5]) : null;
};
const dropAttr = (tag, name) => tag.replace(attrRe(name), '');
const setAttr = (tag, name, value) => tag.replace(attrRe(name), (_, pre) => `${pre}"${value}"`);

// One pass over the HTML. Script and style blocks are matched whole, so markup that merely appears inside them (in a string
// of JavaScript, say) is never touched; comments are dropped.
const PIECES = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<link\b[^>]*>|<(?:img|source|audio|video|track|input|embed)\b[^>]*>/gi;

/** Rewrites one HTML page so that everything it needs is inside it. */
export function inlineHtml(files, path, html) {
  return html.replace(PIECES, (piece) => {
    if (piece.startsWith('<!--')) return '';
    const name = /^<([a-z]+)/i.exec(piece)[1].toLowerCase();
    if (name === 'script') {
      const open = /^<script\b[^>]*>/i.exec(piece)[0];
      const src = getAttr(open, 'src');
      if (src === null) return piece;
      const { bytes } = refKind(src) === 'external' ? (() => { throw external(path, src); })() : fileFor(files, path, src);
      const attrs = ['src', 'integrity', 'crossorigin', 'nonce'].reduce(dropAttr, open);
      return `${attrs}${text.decode(bytes).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')}</script>`;
    }
    if (name === 'style') {
      const open = /^<style\b[^>]*>/i.exec(piece)[0];
      return `${open}${inlineCss(files, path, piece.slice(open.length, piece.lastIndexOf('</')))}</style>`;
    }
    if (name === 'link') {
      if (!/stylesheet/i.test(getAttr(piece, 'rel') ?? '')) return ''; // icons, preloads and the like: nothing to load them from
      const href = getAttr(piece, 'href');
      if (href === null) return '';
      if (refKind(href) === 'external') throw external(path, href);
      const { path: sp, bytes } = fileFor(files, path, href);
      const media = getAttr(piece, 'media');
      return `<style${media ? ` media="${media.replace(/"/g, '')}"` : ''}>${inlineCss(files, sp, text.decode(bytes))}</style>`;
    }
    let tag = piece;
    for (const a of ['src', 'poster']) {
      const v = getAttr(tag, a);
      if (v !== null) tag = setAttr(tag, a, inlineRef(files, path, v));
    }
    return dropAttr(tag, 'srcset'); // srcset could name files we did not inline; src is the fallback
  });
}

/** Builds the document that runs an app. The CSP and the bridge come first; the app's own page follows. */
export function buildDocument(manifest, files) {
  assertAppletPackage(manifest, files);
  const shim = SHIM.replace('__APPLET_MANIFEST__', () => jsonForScript(manifest));
  const page = inlineHtml(files, manifest.entry, text.decode(files.get(manifest.entry)));
  // The page's own <!doctype>, <html> and <head> tags that follow are ignored by the parser (we left <head> open), and its
  // content lands in the head and body as usual.
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<script>${shim}</script>
${page}`;
}

// ---- the bridge ------------------------------------------------------------------------------------------------

/** The calls an app may make, as functions that check the manifest permissions. `store` is { load(id), save(id, data) };
 *  `copy(text)` and `fullscreen()` do the browser part. Separate from the DOM so it can be tested on its own. */
export function createBridge(manifest, { store, copy = async () => {}, fullscreen = async () => {} }) {
  const need = (perm) => {
    if (!manifest.permissions.includes(perm)) throw new Error(`Permission "${perm}" not granted`);
  };
  const checkKey = (k) => {
    if (typeof k !== 'string' || !k || k.length > MAX_KEY) throw new Error(`A storage key must be a string of 1 to ${MAX_KEY} characters`);
    return k;
  };
  const read = async () => {
    try { return new Map(JSON.parse((await store.load(manifest.id)) ?? '[]')); } catch { return new Map(); }
  };
  const write = async (map) => {
    const data = JSON.stringify([...map]);
    if (encoder.encode(data).length > MAX_STORAGE_BYTES) throw new Error('Storage is full');
    await store.save(manifest.id, data);
  };
  return {
    async storageGet({ key }) {
      need('storage');
      return (await read()).get(checkKey(key)) ?? null;
    },
    async storageSet({ key, value }) {
      need('storage');
      if (typeof value !== 'string') throw new Error('A stored value must be a string');
      const map = await read();
      map.set(checkKey(key), value);
      await write(map);
      return true;
    },
    async storageRemove({ key }) {
      need('storage');
      const map = await read();
      map.delete(checkKey(key));
      await write(map);
      return true;
    },
    async fullscreen() {
      need('fullscreen');
      await fullscreen();
      return true;
    },
    async copy({ text: t }) {
      need('clipboard');
      if (typeof t !== 'string' || t.length > MAX_COPY) throw new Error('Nothing to copy, or too much text');
      await copy(t);
      return true;
    },
  };
}

/**
 * Where an app's saved data lives by default: this browser's localStorage, in a slot named after the SHA-256 of the package.
 * It is not named after manifest.id, because the id is whatever the app's author wrote, so a package could claim another app's id
 * and read or overwrite its data. A different package (a new version, or a copy someone edited) has a different hash and starts
 * with an empty slot. The slot does not depend on what the app says about itself, so it cannot be claimed.
 */
export function localStore(hash, storage = globalThis.localStorage) {
  if (typeof hash !== 'string' || hash.length < 8) throw new Error('Saved data needs a slot named after the package hash');
  const key = `appverse:data:${hash}`;
  return { load: () => storage.getItem(key), save: (_id, data) => storage.setItem(key, data) };
}

/**
 * Mounts a running app into `container`. An app that has the storage permission needs somewhere to keep its data: `hash` is the
 * SHA-256 of its package (see localStore), or `saves` ({ load(id), save(id, data) }) replaces the place altogether.
 */
export function runApplet(manifest, files, container, { saves = null, hash = null } = {}) {
  if (!saves && !hash && manifest.permissions.includes('storage')) throw new Error('runApplet needs the package hash (or a place to save to) for an app that stores data');
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  if (manifest.permissions.includes('fullscreen')) frame.setAttribute('allow', 'fullscreen');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = manifest.title;
  frame.width = manifest.width;
  frame.height = manifest.height;
  frame.style.cssText = `width:${manifest.width}px;max-width:100%;height:auto;aspect-ratio:${manifest.width} / ${manifest.height};border:0;background:#fff`;

  const store = saves ?? (hash ? localStore(hash) : null);
  const handlers = createBridge(manifest, {
    store,
    copy: (t) => navigator.clipboard.writeText(t),
    fullscreen: () => frame.requestFullscreen(),
  });

  async function onMessage(e) {
    if (e.source !== frame.contentWindow) return; // only our app
    const m = e.data;
    if (!m || m.applet !== 1 || typeof m.id !== 'number' || !Object.hasOwn(handlers, m.type)) return;
    let reply;
    try {
      reply = { applet: 1, id: m.id, result: await handlers[m.type](m) };
    } catch (err) {
      reply = { applet: 1, id: m.id, error: String(err.message || err) };
    }
    frame.contentWindow?.postMessage(reply, '*');
  }

  window.addEventListener('message', onMessage);
  frame.srcdoc = buildDocument(manifest, files);
  container.replaceChildren(frame);
  frame.focus();

  return {
    stop() {
      window.removeEventListener('message', onMessage);
      frame.remove(); // kills the app and all its timers
    },
    fullscreen: () => manifest.permissions.includes('fullscreen') && frame.requestFullscreen(),
    canFullscreen: manifest.permissions.includes('fullscreen'),
  };
}
