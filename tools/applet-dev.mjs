// `applet dev`: serves an app folder in the real sandbox and reloads it whenever a file changes.
// Listens on 127.0.0.1 only. Serves the page, the few runtime files from ../js, and the app itself as JSON.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFolder } from './pack-folder.mjs';
import { lintApplet } from '../js/packer.js';

const jsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'js');

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>applet dev</title>
<link rel="icon" href="data:,">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #14141c; color: #e8e8f0; font: 15px/1.5 system-ui, sans-serif; }
  header { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: baseline; padding: 10px 16px; border-bottom: 1px solid #ffffff22; }
  header strong { letter-spacing: .08em; }
  #status { color: #9a9ab0; font-size: 13px; }
  button { background: #3a3a4c; color: #fff; border: 0; border-radius: 8px; padding: 4px 12px; font: inherit; cursor: pointer; }
  ul { list-style: none; margin: 0; padding: 0 16px; }
  li { margin: 6px 0; padding: 6px 10px; border-radius: 8px; background: #1f1f2b; white-space: pre-wrap; font-size: 14px; }
  li b { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; padding: 1px 8px; border-radius: 99px; margin-right: 8px; }
  .error b { background: #ff6b6b33; color: #ff6b6b; } .warn b { background: #ffa30033; color: #ffb84d; } .info b { background: #29adff2a; color: #7cc7ff; }
  #problem { color: #ff6b6b; padding: 8px 16px; white-space: pre-wrap; }
  #screen { display: flex; justify-content: center; padding: 16px; }
  iframe { border-radius: 8px; }
</style></head>
<body>
<header><strong>applet dev</strong><span id="title"></span><span id="status">loading...</span><button id="reload" type="button">Reload now</button></header>
<p id="problem" hidden></p>
<ul id="findings"></ul>
<div id="screen"></div>
<script type="module">
import { runApplet } from '/js/sandbox.js';
const $ = (id) => document.getElementById(id);
let running = null;
window.__appletDevLoads = 0;
async function load() {
  const data = await (await fetch('/__app', { cache: 'no-store' })).json();
  window.__appletDevLoads++;
  running?.stop();
  running = null;
  $('status').textContent = 'loaded ' + new Date().toLocaleTimeString() + ' (reloads when you save a file)';
  $('title').textContent = data.manifest ? data.manifest.title : '';
  $('findings').replaceChildren(...(data.findings ?? []).concat(data.note ? [{ level: 'info', message: data.note }] : []).map((f) => {
    const li = document.createElement('li');
    li.className = f.level;
    li.append(Object.assign(document.createElement('b'), { textContent: f.level === 'warn' ? 'warning' : f.level }), (f.file ? f.file + ': ' : '') + f.message);
    return li;
  }));
  $('problem').hidden = !data.error;
  $('problem').textContent = data.error ?? '';
  if (data.error) return;
  if ((data.findings ?? []).some((f) => f.level === 'error')) return; // fix the errors above first
  const files = new Map(Object.entries(data.files).map(([k, v]) => [k, Uint8Array.from(atob(v), (c) => c.charCodeAt(0))]));
  try {
    running = runApplet(data.manifest, files, $('screen'));
  } catch (e) {
    $('problem').hidden = false;
    $('problem').textContent = String(e.message || e);
  }
}
$('reload').onclick = load;
new EventSource('/__events').addEventListener('change', load);
load();
</script></body></html>`;

/** The app folder as the page needs it: manifest, checks and every file as base64. */
export function snapshot(root) {
  let folder;
  try {
    folder = readFolder(root);
  } catch (e) {
    return { error: e.message };
  }
  const { files, manifest, guessed } = folder;
  return {
    manifest,
    note: guessed ? 'There is no manifest.json, so these details are guesses. `applet new` makes a folder with one.' : '',
    findings: lintApplet(manifest, files),
    files: Object.fromEntries([...files].map(([k, v]) => [k, Buffer.from(v).toString('base64')])),
  };
}

// a cheap fingerprint of the folder (names, sizes, modification times) to notice changes
function signature(root, prefix = '') {
  let sig = '';
  let names;
  try { names = readdirSync(join(root, prefix)).sort(); } catch { return 'gone'; }
  for (const name of names) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    let st;
    try { st = statSync(join(root, rel)); } catch { continue; }
    if (st.isDirectory()) sig += `${rel}/` + signature(root, rel);
    else if (!name.toLowerCase().endsWith('.applet')) sig += `${rel}:${st.size}:${Math.round(st.mtimeMs)};`;
  }
  return sig;
}

export async function startDev({ dir = '.', port = 8080, onChange } = {}) {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`${dir} is not a folder`);
  const clients = new Set();
  let sig = signature(root);
  const poll = setInterval(() => {
    const next = signature(root);
    if (next === sig) return;
    sig = next;
    for (const res of clients) res.write('event: change\ndata: {}\n\n');
    onChange?.();
  }, 350);
  const beat = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000);

  const server = createServer((req, res) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) { res.writeHead(403).end('forbidden'); return; }
    if (req.method !== 'GET') { res.writeHead(405).end('method not allowed'); return; }
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(PAGE);
    } else if (path === '/__app') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(snapshot(root)));
    } else if (path === '/__events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else if (path.startsWith('/js/') && path.endsWith('.js')) {
      let rel;
      try { rel = decodeURIComponent(path.slice(4)); } catch { res.writeHead(400).end('bad request'); return; }
      const file = resolve(jsDir, rel);
      if (rel.includes('..') || rel.includes('\\') || !file.startsWith(jsDir + sep) || !existsSync(file)) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }).end(readFileSync(file));
    } else {
      res.writeHead(404).end('not found');
    }
  });

  const listen = (p, triesLeft) => new Promise((ok, fail) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && p !== 0 && triesLeft > 0) listen(p + 1, triesLeft - 1).then(ok, fail);
      else fail(e);
    });
    server.listen(p, '127.0.0.1', () => ok(server.address().port));
  });
  const actualPort = await listen(port, 20);
  return {
    server,
    port: actualPort,
    url: `http://localhost:${actualPort}/`,
    root,
    close() {
      clearInterval(poll);
      clearInterval(beat);
      for (const res of clients) res.end();
      clients.clear();
      server.closeAllConnections?.();
      return new Promise((r) => server.close(r));
    },
  };
}
