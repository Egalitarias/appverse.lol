// Drives one browser through both runs (the sandbox, and the control page) and returns what happened as plain data. Playwright's
// global setup calls this once per engine and writes the result to .results/<engine>.json; the spec only reads that, so a failing
// check never makes Playwright restart a worker and repeat the minute-long run.
import { startSite, startCanary } from './servers.mjs';
import { PROBES, probePage } from './probes.mjs';
import { buildZip } from '../../js/zipwrite.js';

const enc = new TextEncoder();
const COOKIE = { name: 'hostcookie', value: '1' };

async function appletWithProbes(canary, opts) {
  const manifest = { applet: 1, id: 'test.escape', title: 'Escape attempts', entry: 'index.html', width: 480, height: 360, permissions: [] };
  const zip = buildZip([
    ['manifest.json', enc.encode(JSON.stringify(manifest))],
    ['index.html', enc.encode(probePage({ canary: canary.url, udpPort: canary.udpPort, site: opts.siteUrl, ...opts }))],
  ]);
  return Buffer.from(await zip.arrayBuffer());
}

/** A fresh browser context that writes down everything the page does that the test cares about. */
async function watch(browser, siteUrl) {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addCookies([{ ...COOKIE, url: siteUrl }]); // a cookie of the host page's own: an app must not see or add to the cookies
  const seen = { reports: {}, started: [], popups: [], downloads: [], dialogs: [], navigations: [] };
  await context.exposeBinding('__escapeReport', (_, r) => {
    if (r.result === 'started') seen.started.push(r.name);
    else seen.reports[r.name] = { result: r.result, detail: r.detail };
  });
  // only the top document listens: the app's own frame is not handed anything by the test
  await context.addInitScript(() => {
    if (window !== window.top) return;
    addEventListener('message', (e) => { if (e.data && e.data.escape === 1) window.__escapeReport(e.data); });
  });
  const track = (p) => {
    p.on('download', (d) => seen.downloads.push(d.suggestedFilename()));
    p.on('dialog', (d) => { seen.dialogs.push(d.type()); d.dismiss().catch(() => {}); });
  };
  const page = await context.newPage();
  track(page);
  context.on('page', (p) => { track(p); seen.popups.push(p.url()); });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) seen.navigations.push(f.url()); });
  return { context, page, seen };
}

async function waitFor(fn, ms = 40_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
}

const cookieNames = async (context, url) => (await context.cookies(url)).map((c) => c.name).sort();

async function sandboxed(browser) {
  const canary = await startCanary();
  const site = await startSite();
  const w = await watch(browser, site.url);
  const hostUrl = `${site.url}/index.html`;
  const response = await w.page.request.get(hostUrl);
  const strayNavigations = [];
  let attrs = null;

  /** Loads the host page, drops an app on it, runs it, and notes anything that moved the host page. */
  const runApp = async (opts, until) => {
    await w.page.goto(hostUrl);
    const before = w.seen.navigations.length;
    await w.page.setInputFiles('#file', { name: 'escape.applet', mimeType: 'application/octet-stream', buffer: await appletWithProbes(canary, { ...opts, siteUrl: site.url }) });
    await w.page.locator('#run').click();
    const frame = w.page.locator('#screen iframe');
    await frame.waitFor();
    attrs ??= { sandbox: await frame.getAttribute('sandbox'), referrerpolicy: await frame.getAttribute('referrerpolicy') };
    const finished = await until();
    await w.page.waitForTimeout(1500); // stragglers: late requests, redirects, prefetches
    strayNavigations.push(...w.seen.navigations.slice(before));
    if (w.page.url() !== hostUrl) strayNavigations.push(w.page.url());
    return finished;
  };

  const finished = await runApp({ group: 'main' }, () => waitFor(() => w.seen.reports.__done));
  // an attack that navigates or rewrites its own document can end the app's script, so each one gets a fresh app
  for (const p of PROBES.filter((x) => x.last)) await runApp({ only: p.name }, () => waitFor(() => w.seen.started.includes(p.name), 10_000));

  const out = {
    ...w.seen, finished, attrs, strayNavigations, hits: [...canary.hits], siteHits: [...site.hits], pages: w.context.pages().length,
    hostCsp: response.headers()['content-security-policy'], cookies: await cookieNames(w.context, site.url),
  };
  await w.context.close(); await canary.close(); await site.close();
  return out;
}

async function control(browser) {
  const canary = await startCanary();
  const site = await startSite({ '/__control/probe.html': probePage({ canary: canary.url, udpPort: canary.udpPort, site: null }) });
  const w = await watch(browser, site.url);
  // a page that never finishes loading (streams, workers, frames) must not hold us up: wait for the probes, not for "load"
  await w.page.goto(`${site.url}/__control/probe.html?group=main`, { waitUntil: 'commit' });
  const finished = await waitFor(() => w.seen.reports.__done);
  await w.page.waitForTimeout(2000);
  for (const p of PROBES.filter((x) => x.last)) {
    await w.page.goto(`${site.url}/__control/probe.html?only=${p.name}`, { waitUntil: 'commit' }).catch(() => {});
    await w.page.waitForTimeout(2500); // fixed: the page may be gone before it can say it is done
  }
  const out = { ...w.seen, finished, hits: [...canary.hits], siteHits: [...site.hits], cookies: await cookieNames(w.context, site.url) };
  await w.context.close(); await canary.close(); await site.close();
  return out;
}

export async function collect(browserType) {
  const browser = await browserType.launch();
  try {
    const sandbox = await sandboxed(browser);
    const ctl = await control(browser);
    return { browser: browserType.name(), version: browser.version(), sandbox, control: ctl };
  } finally { await browser.close(); }
}
