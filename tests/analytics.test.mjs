import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aggregate, buildReport, merge, parseLine, sourceOf, languageOf, deviceOf, pageName } from '../tools/analytics-report.mjs';
import { lastDays, sumMaps } from '../js/analytics-page.js';

const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/130.0';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148';

/** A Caddy JSON access-log line. */
const line = (o) => JSON.stringify({
  level: 'info', ts: Date.parse(`${o.day ?? '2026-10-14'}T12:00:00Z`) / 1000, status: o.status ?? 200,
  request: { client_ip: o.ip ?? '1.1.1.1', method: o.method ?? 'GET', host: 'appverse.lol', uri: o.uri ?? '/', headers: { 'User-Agent': [o.agent ?? BROWSER], 'Accept-Language': [o.lang ?? 'en-GB,en;q=0.9'], ...(o.referer ? { Referer: [o.referer] } : {}) } },
});

test('a log line becomes a day, a path without its query, and the headers that are counted', () => {
  const e = parseLine(line({ uri: '/library.html?q=secret#x', referer: 'https://github.com/a/b' }));
  assert.equal(e.day, '2026-10-14');
  assert.equal(e.path, '/library.html');
  assert.equal(e.agent, BROWSER);
  assert.equal(parseLine('not json'), null);
  assert.equal(parseLine('{"msg":"no request here"}'), null);
});

test('small helpers: page names, languages, devices and sources keep only what is needed', () => {
  assert.equal(pageName('/'), 'home');
  assert.equal(pageName('/make.html'), 'make');
  assert.equal(languageOf('en-GB,en;q=0.9'), 'en');
  assert.equal(languageOf(''), undefined);
  assert.equal(deviceOf(PHONE), 'phone');
  assert.equal(deviceOf(BROWSER), 'desktop');
  assert.equal(sourceOf('https://www.github.com/a/b?c=d', 'appverse.lol'), 'github.com');
  assert.equal(sourceOf('https://appverse.lol/make.html', 'appverse.lol'), undefined);
  assert.equal(sourceOf('', 'appverse.lol'), undefined);
});

test('visitors, views, downloads, bots and missing pages are counted for the day', () => {
  const days = aggregate([
    line({ ip: '1.1.1.1', uri: '/' , referer: 'https://github.com/x'}),
    line({ ip: '1.1.1.1', uri: '/make.html' }), // the same visitor again: a view, not a new visitor
    line({ ip: '2.2.2.2', uri: '/make.html', agent: PHONE, lang: 'de-DE' }),
    line({ ip: '3.3.3.3', uri: '/', agent: 'Googlebot/2.1' }),
    line({ ip: '4.4.4.4', uri: '/', agent: 'curl/8.4.0' }),
    line({ ip: '1.1.1.1', uri: '/nope.html', status: 404 }),
    line({ ip: '1.1.1.1', uri: '/tools/applet.mjs' }),
    line({ ip: '1.1.1.1', uri: '/templates/starter/manifest.json' }),
    line({ ip: '2.2.2.2', uri: '/templates/starter/manifest.json' }),
    line({ ip: '1.1.1.1', uri: '/examples/notes.applet' }),
    line({ ip: '1.1.1.1', uri: '/analytics.html' }), // the report itself is not a visit
    line({ ip: '1.1.1.1', uri: '/', method: 'POST' }),
    line({ ip: '1.1.1.1', uri: '/analytics.html', status: 401 }),
  ], 'salt');
  assert.equal(days.length, 1);
  const d = days[0];
  assert.equal(d.views, 3);
  assert.equal(d.visitors, 2);
  assert.equal(d.bots, 2);
  assert.deepEqual(d.pages, { home: 1, make: 2 });
  assert.deepEqual(d.devices, { desktop: 1, phone: 1 });
  assert.deepEqual(d.languages, { en: 1, de: 1 });
  assert.deepEqual(d.sources, { 'github.com': 1 });
  assert.deepEqual(d.notFound, { '/nope.html': 1 });
  assert.equal(d.toolsFiles, 1);
  assert.equal(d.starterOnly, 1, 'two starter fetches, one of them part of a tools download');
  assert.equal(d.apps, 1);
});

test('the report keeps totals only: no address, browser string or query comes out', () => {
  const out = JSON.stringify(buildReport([[
    line({ ip: '203.0.113.77', uri: '/library.html?q=private-search', agent: BROWSER, referer: 'https://example.org/some/secret/page?token=abc' }),
    line({ ip: '203.0.113.78', uri: '/missing?token=abc', status: 404 }),
  ].join('\n')], null, new Date('2026-10-14T13:00:00Z')));
  for (const leak of ['203.0.113', 'Firefox', 'private-search', 'secret/page', 'token=abc', 'Mozilla']) assert.ok(!out.includes(leak), `the report contains ${leak}`);
  assert.match(out, /example\.org/);
  assert.match(out, /"\/missing"/);
});

test('days the logs no longer cover are kept, and a day the logs only partly cover keeps the fuller record', () => {
  const full = { day: '2026-10-13', views: 50, visitors: 20, bots: 5 };
  const old = { day: '2026-10-01', views: 9, visitors: 4, bots: 0 };
  const partial = { day: '2026-10-13', views: 3, visitors: 2, bots: 0 };
  const merged = merge([old, full], [partial, { day: '2026-10-14', views: 1, visitors: 1, bots: 0 }]);
  assert.deepEqual(merged.map((d) => d.day), ['2026-10-01', '2026-10-13', '2026-10-14']);
  assert.equal(merged[1].views, 50);
  assert.equal(merge([{ day: '2026-10-13', views: 3, visitors: 1, bots: 0 }], [{ day: '2026-10-13', views: 8, visitors: 2, bots: 0 }])[0].views, 8);
});

test('the page fills quiet days and adds the per-day maps up', () => {
  const all = [{ day: '2026-10-14', pages: { home: 2 } }, { day: '2026-10-12', pages: { home: 1, make: 1 } }];
  const series = lastDays(all, 4, new Date('2026-10-14T08:00:00Z'));
  assert.deepEqual(series.map((d) => d.day), ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
  assert.deepEqual(sumMaps(series, 'pages'), { home: 3, make: 1 });
  assert.equal(series[0].views, 0);
});

test('the analytics page is private: password-protected, noindex, off the sitemap and out of robots.txt', () => {
  const caddy = read('tools/Caddyfile');
  const matcher = new RegExp(caddy.match(/@private path ([^\n]+)/)[1].trim().split(/\s+/).map((p) => '^' + p.replace(/\*/g, '.*') + '$').join('|'));
  for (const p of ['/analytics.html', '/analytics/data.json']) assert.ok(matcher.test(p), `${p} must ask for the password`);
  for (const p of ['/', '/privacy.html', '/make.html']) assert.ok(!matcher.test(p), `${p} must stay public`);
  assert.match(caddy, /basic_auth @private/);
  assert.match(caddy, /REPLACE_WITH_THE_OUTPUT_OF_caddy_hash-password/, 'the repository holds a placeholder, never a real hash');
  assert.ok(!/\$2[aby]\$/.test(caddy), 'a bcrypt hash must not be committed');
  assert.match(read('analytics.html'), /<meta name="robots" content="noindex">/);
  assert.ok(!read('sitemap.xml').includes('analytics'));
  assert.match(read('robots.txt'), /Disallow: \/analytics/);
});

test('the page only reads the totals file from its own address, and the privacy page says what the log holds', () => {
  const js = read('js/analytics-page.js');
  assert.match(js, /fetch\('analytics\/data\.json'/);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(js), 'no other site is contacted');
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(js), 'log data is shown with DOM calls only');
  const privacy = read('privacy.html');
  assert.match(privacy, /access log/);
  assert.match(privacy, /14 days/);
  assert.match(read('tools/Caddyfile'), /roll_keep_for 336h/, '14 days, as the privacy page says');
});
