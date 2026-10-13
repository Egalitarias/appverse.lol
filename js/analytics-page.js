// The analytics page (analytics.html): site-wide totals for the person who runs Appverse. The numbers are a file of daily totals
// that tools/analytics-report.mjs writes on the server; the server asks for a password before it hands out this page or that file.
// Everything is built with DOM calls only (page names and addresses are data), and the charts are SVG.
const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const svg = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
};

const number = (n) => new Intl.NumberFormat().format(Math.round(n));
const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '0%');
const RANGES = [7, 30, 90];

function say(text, bad = false) {
  const box = $('status');
  box.textContent = text;
  box.className = bad ? 'msg bad' : 'msg';
  box.hidden = !text;
}

const card = (value, name) => el('div', { className: 'card' }, el('div', { className: 'value', textContent: value }), el('div', { className: 'label', textContent: name }));

/** One entry per day for the last `days` days, so a quiet day shows as a gap, not as a missing bar. */
export function lastDays(all, days, today = new Date()) {
  const byDay = new Map(all.map((d) => [d.day, d]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, views: 0, visitors: 0, bots: 0, pages: {}, sources: {}, devices: {}, languages: {}, notFound: {}, toolsFiles: 0, starterOnly: 0, apps: 0 });
  }
  return out;
}

/** Adds up a per-day map such as `pages` over the days. */
export function sumMaps(series, field) {
  const total = {};
  for (const d of series) for (const [k, n] of Object.entries(d[field] ?? {})) total[k] = (total[k] ?? 0) + n;
  return total;
}

/** Bars grouped by day. `keys` is [[field, className, legend]...]. */
function chart(target, series, keys) {
  const W = 900, H = 220, left = 40, bottom = 22, top = 8, right = 6;
  const max = Math.max(1, ...series.flatMap((d) => keys.map(([k]) => d[k] ?? 0)));
  const unit = 10 ** Math.floor(Math.log10(max));
  const ceil = Math.ceil(max / unit) * unit || 1;
  const plotW = W - left - right, plotH = H - top - bottom;
  const slot = plotW / series.length;
  const barW = Math.max(1, (slot * 0.8) / keys.length);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${keys.map((k) => k[2]).join(' and ')} per day` });
  for (let i = 0; i <= 4; i++) {
    const y = top + plotH - (plotH * i) / 4;
    root.append(svg('line', { class: 'grid', x1: left, x2: W - right, y1: y, y2: y }), svg('text', { class: 'axis', x: left - 6, y: y + 4, 'text-anchor': 'end' }, document.createTextNode(number((ceil * i) / 4))));
  }
  series.forEach((d, i) => {
    const x0 = left + i * slot + slot * 0.1;
    keys.forEach(([k, cls, name], j) => {
      const h = ((d[k] ?? 0) / ceil) * plotH;
      const bar = svg('rect', { class: cls, x: x0 + j * barW, y: top + plotH - h, width: Math.max(0.5, barW - 1), height: h });
      bar.append(svg('title', {}, document.createTextNode(`${d.day}: ${number(d[k] ?? 0)} ${name.toLowerCase()}`)));
      root.append(bar);
    });
    if (series.length <= 14 || i % Math.ceil(series.length / 8) === 0) {
      root.append(svg('text', { class: 'axis', x: left + i * slot + slot / 2, y: H - 6, 'text-anchor': 'middle' }, document.createTextNode(d.day.slice(5))));
    }
  });
  target.replaceChildren(root, el('div', { className: 'legend' }, ...keys.map(([, cls, name]) => el('span', {}, el('span', { className: `swatch ${cls}` }), name))));
}

/** A list of names with a count and a bar as long as its share of the biggest. */
function barList(target, counts, format = (k) => k) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { target.replaceChildren(el('li', { className: 'small', textContent: 'Nothing yet.' })); return; }
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const biggest = entries[0][1];
  target.replaceChildren(...entries.slice(0, 12).map(([k, n]) => {
    const fill = el('span', { className: 'fill' });
    fill.style.width = `${Math.max(2, (n / biggest) * 100)}%`;
    return el('li', {}, el('span', { textContent: format(k) }), el('span', { className: 'small', textContent: `${number(n)} (${percent(n, total)})` }), el('span', { className: 'track' }, fill));
  }));
}

const language = (code) => { try { return new Intl.DisplayNames(undefined, { type: 'language' }).of(code) || code; } catch { return code; } };

function show(data, days) {
  const series = lastDays(data.days, days);
  const sum = (field) => series.reduce((a, d) => a + (d[field] ?? 0), 0);
  $('since').textContent = data.collectingSince
    ? `Counted since ${data.collectingSince}; showing the last ${days} days. Updated ${new Date(data.generatedAt).toLocaleString()}.`
    : `Counting has just started; showing the last ${days} days.`;
  $('cards').replaceChildren(
    card(number(sum('visitors')), 'visitors (per day, added up)'),
    card(number(sum('views')), 'page views'),
    card(number(sum('toolsFiles')), 'tools downloads'),
    card(number(sum('starterOnly')), 'starter downloads'),
    card(number(sum('apps')), 'apps opened'),
    card(number(sum('bots')), 'bot requests left out'));
  chart($('chart-views'), series, [['visitors', 'bar-a', 'Visitors'], ['views', 'bar-b', 'Page views']]);
  chart($('chart-downloads'), series, [['toolsFiles', 'bar-a', 'Tools downloads'], ['starterOnly', 'bar-b', 'Starter downloads'], ['apps', 'bar-c', 'Apps opened']]);
  barList($('pages'), sumMaps(series, 'pages'));
  barList($('sources'), sumMaps(series, 'sources'));
  barList($('devices'), sumMaps(series, 'devices'));
  barList($('languages'), sumMaps(series, 'languages'), language);
  const missing = Object.entries(sumMaps(series, 'notFound')).sort((a, b) => b[1] - a[1]).slice(0, 15);
  $('not-found').replaceChildren(...(missing.length
    ? missing.map(([path, n]) => el('tr', {}, el('td', {}, el('code', { textContent: path })), el('td', { className: 'num', textContent: number(n) })))
    : [el('tr', {}, el('td', { colSpan: 2, className: 'small', textContent: 'None in this time.' }))]));
}

async function start() {
  const stored = (() => { try { return Number(localStorage.getItem('av_analytics_days')); } catch { return 0; } })();
  let days = RANGES.includes(stored) ? stored : 30;
  let data = null;

  const draw = () => {
    show(data, days);
    for (const b of $('range').children) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days));
  };
  $('range').replaceChildren(...RANGES.map((n) => {
    const b = el('button', { type: 'button', className: 'chip', textContent: `Last ${n} days` });
    b.dataset.days = String(n);
    b.addEventListener('click', () => {
      days = n;
      try { localStorage.setItem('av_analytics_days', String(n)); } catch { /* optional */ }
      draw();
    });
    return b;
  }));

  say('Loading...');
  try {
    const res = await fetch('analytics/data.json', { cache: 'no-store' });
    if (res.status === 404) throw new Error('No numbers yet. The report has not run on the server: see docs/analytics.md.');
    if (!res.ok) throw new Error(`The numbers could not be loaded (HTTP ${res.status}).`);
    data = await res.json();
    $('report').hidden = false;
    say('');
    draw();
  } catch (err) { say(err.message, true); }
}

if (typeof document !== 'undefined' && document.getElementById('status')) start();
