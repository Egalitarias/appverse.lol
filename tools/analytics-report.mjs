#!/usr/bin/env node
// Turns Caddy's JSON access log into the daily totals that analytics.html shows. Runs on the server (see docs/analytics.md).
//
//   node tools/analytics-report.mjs --out /var/www/appverse-site/stats/data.json /var/log/caddy/appverse-access*.log
//
// Only totals come out: "on this day, this page was opened N times". Addresses and browser strings are read, counted
// and dropped; a "visitor" is a hash of address + browser + day that lives in memory for one run and is never written.
// Days that the logs no longer cover are kept from the existing output file, so the history outlives the log rotation.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const BOT = /bot|crawl|spider|slurp|curl|wget|python|node-fetch|go-http|java\/|headless|monitor|uptime|preview|facebookexternalhit|lighthouse|scan/i;
const PAGE = /^\/(?:[\w-]+\.html)?$/;

/** One log line -> { day, ip, agent, lang, referer, host, path, method, status } or null if it is not a Caddy request line. */
export function parseLine(line) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  const r = o?.request;
  if (!r || typeof o.ts !== 'number') return null;
  const header = (name) => {
    const v = r.headers?.[name] ?? r.headers?.[name.toLowerCase()];
    return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
  };
  return {
    day: new Date(o.ts * 1000).toISOString().slice(0, 10),
    ip: String(r.client_ip ?? r.remote_ip ?? ''),
    agent: header('User-Agent'),
    lang: header('Accept-Language'),
    referer: header('Referer'),
    host: String(r.host ?? ''),
    path: String(r.uri ?? '').split(/[?#]/)[0],
    method: String(r.method ?? ''),
    status: Number(o.status ?? 0),
  };
}

export const deviceOf = (agent) => (/ipad|tablet/i.test(agent) ? 'tablet' : /mobi|android|iphone/i.test(agent) ? 'phone' : 'desktop');
/** "en-GB,en;q=0.9" -> "en" */
export const languageOf = (header) => /^[a-z]{2,3}/i.exec(header.trim())?.[0].toLowerCase();
/** Only the site a visitor came from, never the page: "https://github.com/x/y?z" -> "github.com". Our own pages are not a source. */
export function sourceOf(referer, host) {
  try {
    const h = new URL(referer).hostname.replace(/^www\./, '');
    return h && h !== host.replace(/^www\./, '') ? h : undefined;
  } catch { return undefined; }
}
/** "/make.html" -> "make", "/" -> "home" */
export const pageName = (path) => path.replace(/^\//, '').replace(/\.html$/, '') || 'home';

const bump = (map, key, by = 1) => { map[key] = (map[key] ?? 0) + by; };
const top = (map, n) => Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n));

/**
 * Totals per day for the given lines. `salt` makes the visitor hashes differ from run to run, so they could not be matched
 * up with anything outside this process.
 */
export function aggregate(lines, salt = randomBytes(16).toString('hex')) {
  const days = new Map();
  const seen = new Map(); // day -> Set of visitor hashes
  for (const line of lines) {
    const e = parseLine(line);
    if (!e || e.method !== 'GET') continue;
    let d = days.get(e.day);
    if (!d) {
      d = { day: e.day, views: 0, visitors: 0, bots: 0, pages: {}, sources: {}, devices: {}, languages: {}, notFound: {}, starterFiles: 0, toolsFiles: 0, apps: 0 };
      days.set(e.day, d);
      seen.set(e.day, new Set());
    }
    if (BOT.test(e.agent) || !e.agent) { if (PAGE.test(e.path)) d.bots++; continue; }
    if (e.path === '/analytics.html' || e.path.startsWith('/analytics/')) continue; // this report is not a visit to the site
    if (e.status === 404) { if (e.path.length < 200) bump(d.notFound, e.path); continue; }
    if (e.status !== 200 && e.status !== 304) continue;

    // the downloads on make.html are zipped in the browser from these files, so a download shows up as these requests
    if (e.path === '/tools/applet.mjs') d.toolsFiles++;
    else if (e.path === '/templates/starter/manifest.json') d.starterFiles++;
    else if (/^\/examples\/[\w.-]+\.applet$/.test(e.path)) d.apps++;
    if (!PAGE.test(e.path)) continue;

    d.views++;
    bump(d.pages, pageName(e.path));
    const id = createHash('sha256').update(`${salt}|${e.day}|${e.ip}|${e.agent}`).digest('hex');
    const set = seen.get(e.day);
    if (!set.has(id)) {
      set.add(id);
      d.visitors++;
      bump(d.devices, deviceOf(e.agent));
      const lang = languageOf(e.lang);
      if (lang) bump(d.languages, lang);
      const src = sourceOf(e.referer, e.host);
      if (src) bump(d.sources, src);
    }
  }
  for (const d of days.values()) {
    d.sources = top(d.sources, 20);
    d.notFound = top(d.notFound, 20);
    // every tools download also fetches the starter files, so the starter-only downloads are what is left
    d.starterOnly = Math.max(0, d.starterFiles - d.toolsFiles);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** The old days plus the new ones. A day the logs only partly cover (the oldest log was rotated mid-day) keeps the fuller record. */
export function merge(previous, fresh, keepDays = 400) {
  const days = new Map((previous ?? []).map((d) => [d.day, d]));
  const size = (d) => d.views + d.bots;
  for (const d of fresh) if (!days.has(d.day) || size(d) >= size(days.get(d.day))) days.set(d.day, d);
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-keepDays);
}

const readLog = (file) => { const buf = readFileSync(file); return (file.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8'); };

export function buildReport(logTexts, previous, now = new Date()) {
  const days = merge(previous?.days, aggregate(logTexts.flatMap((t) => t.split('\n').filter(Boolean))));
  return { generatedAt: now.toISOString(), collectingSince: days[0]?.day ?? null, days };
}

function main(argv) {
  const out = argv[argv.indexOf('--out') + 1];
  const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');
  if (argv.indexOf('--out') < 0 || !out || !files.length) {
    console.error('usage: analytics-report.mjs --out <data.json> <access.log>...');
    process.exit(2);
  }
  let previous = null;
  try { previous = JSON.parse(readFileSync(out, 'utf8')); } catch { /* first run */ }
  const report = buildReport(files.map(readLog), previous);
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, JSON.stringify(report));
  renameSync(tmp, out);
  console.log(`${report.days.length} days written to ${out}`);
}

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
