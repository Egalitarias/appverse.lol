// The two servers the browser tests need.
//
//  - the site: the repository, served with the headers that tools/Caddyfile gives the real site (the content-security-policy for
//    the pages that run apps is read out of that file, so these tests cannot drift from what is deployed);
//  - the canary: a second origin that answers anything and writes down every way it was reached (HTTP, WebSocket upgrade, a bare TCP
//    connection, a UDP packet). An app in the sandbox must never reach it, so any entry in `hits` is an escape.
import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import { createServer as createTcpServer } from 'node:net';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.applet': 'application/octet-stream', '.png': 'image/png', '.ico': 'image/x-icon',
};
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** The policies and the "which pages run apps" rule, exactly as the production Caddyfile has them. */
export function productionHeaders() {
  const caddy = readFileSync(join(root, 'tools/Caddyfile'), 'utf8');
  return {
    runnerPage: new RegExp(caddy.match(/@runner path_regexp runner (\S+)/)[1]),
    runnerCsp: caddy.match(/header @runner Content-Security-Policy "([^"]*)"/)[1],
    otherCsp: caddy.match(/header @other Content-Security-Policy "([^"]*)"/)[1],
  };
}

/** This machine's address on the network, if it has one: some browsers will not send WebRTC (STUN) traffic to a loopback address. */
export const lanAddress = () => Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1';

const listen = (server, kind, host = '127.0.0.1') => new Promise((ok, fail) => {
  server.once('error', fail);
  (kind === 'udp' ? server.bind(0, host, () => ok(server.address().port)) : server.listen(0, host, () => ok(server.address().port)));
});

/** `pages` maps a path to extra test-only HTML (the unprotected control pages); they are served without any policy. */
export async function startSite(pages = {}) {
  const policy = productionHeaders();
  const hits = []; // requests for /probe/<name>: an app that reaches back to the site's own origin (the host page's policy allows 'self')
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = decodeURIComponent(url.pathname);
    if (path.startsWith('/probe/')) hits.push({ kind: 'http', name: nameOf(req.url), method: req.method });
    const base = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache' };
    if (Object.hasOwn(pages, path)) {
      res.writeHead(200, { ...base, 'Content-Type': TYPES['.html'] });
      return res.end(pages[path]);
    }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, base); return res.end('not found'); }
    const csp = policy.runnerPage.test(path) ? policy.runnerCsp : policy.otherCsp;
    res.writeHead(200, { ...base, 'Content-Security-Policy': csp, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, hits, close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }) };
}

/** What `/probe/<name>.ext?query` is called in the hit list: "name". */
const nameOf = (url) => /^\/probe\/([^/?#.]+)/.exec(new URL(url, 'http://x').pathname)?.[1] ?? '(other)';

/** `udp` and `tcp` name the ports to open, one per attack that sends no HTTP (WebRTC; a preconnect hint), so a packet or connection says which. */
export async function startCanary({ udp = [], tcp = [] } = {}) {
  const hits = [];
  const server = createServer((req, res) => {
    const name = nameOf(req.url);
    hits.push({ kind: 'http', name, method: req.method, url: req.url, origin: req.headers.origin ?? '', t: Date.now() });
    const path = new URL(req.url, 'http://x').pathname;
    const type = path.endsWith('.js') ? TYPES['.js'] : path.endsWith('.css') || /^\/probe\/(css-import|link-stylesheet)/.test(path) ? TYPES['.css'] : 'image/gif';
    res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', Connection: 'close' });
    res.end(type === 'image/gif' ? GIF : type === TYPES['.css'] ? 'body{}' : 'void 0;');
  });
  server.on('connection', () => hits.push({ kind: 'tcp', name: '(connection)', t: Date.now() }));
  server.on('upgrade', (req, socket) => { hits.push({ kind: 'ws', name: nameOf(req.url), url: req.url, t: Date.now() }); socket.destroy(); });
  const port = await listen(server);

  // UDP listeners for WebRTC: STUN requests to them are traffic that a content-security-policy cannot stop
  const sockets = {};
  for (const name of udp) {
    const socket = createSocket('udp4');
    socket.on('message', (msg, from) => hits.push({ kind: 'udp', name, bytes: msg.length, from: from.port, t: Date.now() }));
    sockets[name] = { socket, port: await listen(socket, 'udp', '0.0.0.0') };
  }
  const udpPorts = Object.fromEntries(Object.entries(sockets).map(([name, s]) => [name, s.port]));
  const tcpServers = {};
  for (const name of tcp) {
    const s = createTcpServer((socket) => { hits.push({ kind: 'tcp', name, t: Date.now() }); socket.on('error', () => {}); socket.destroy(); });
    tcpServers[name] = { server: s, port: await listen(s, 'tcp') };
  }
  const tcpPorts = Object.fromEntries(Object.entries(tcpServers).map(([name, s]) => [name, s.port]));

  return {
    url: `http://127.0.0.1:${port}`,
    udpPorts,
    tcpPorts,
    udpHost: lanAddress(),
    hits,
    reset: () => { hits.length = 0; },
    /** The HTTP and WebSocket requests that carried this probe's name. */
    named: (name) => hits.filter((h) => (h.kind === 'http' || h.kind === 'ws') && h.name === name),
    /** Contacts that have no path: a bare connection or a UDP packet. */
    bare: () => hits.filter((h) => h.kind === 'tcp' || h.kind === 'udp'),
    close: () => new Promise((ok) => { for (const { socket } of Object.values(sockets)) socket.close(); for (const { server: s } of Object.values(tcpServers)) s.close(); server.closeAllConnections(); server.close(ok); }),
  };
}
