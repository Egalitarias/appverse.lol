// Tries to get out of the sandbox in real browsers. The attacks are in probes.mjs, the canary that catches them in servers.mjs, and
// run.mjs drives each browser through them once (global-setup.mjs); this file checks what happened, probe by probe.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PROBES } from './probes.mjs';
import { productionHeaders } from './servers.mjs';

/**
 * Attacks that are known to get through, by engine. A listed attack is expected to succeed in that engine: its test passes
 * while it does, and fails the day it stops (then delete the entry, because the gap is closed). Nothing else may get through.
 */
const KNOWN_GAPS = {
  // probeName: { engine: 'why it gets through' }, or { engine: { reason, platforms: ['linux'] } } when only one platform's build does it
  'popup-anchor': {
    webkit: {
      platforms: ['linux'],
      reason: 'WebKit on Linux opens a TCP connection to the host of a link that a script clicks with target=_blank, before it checks that the sandbox does not allow popups. An app can make the browser look up and connect to a host it chooses (no request is sent). Not known whether Safari does the same.',
    },
  },
};

const cache = new Map();
const results = (info) => {
  const name = info.project.name;
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(new URL(`./.results/${name}.json`, import.meta.url), 'utf8')));
  return cache.get(name);
};
const gapFor = (probe, engine) => {
  const gap = KNOWN_GAPS[probe]?.[engine];
  if (!gap || typeof gap === 'string') return gap;
  return !gap.platforms || gap.platforms.includes(process.platform) ? gap.reason : undefined;
};
/** A hit written as text, with the probes that had just started when it came in (a bare connection says nothing about which attack opened it). */
const describeHit = (h, startedAt = {}) => {
  const near = Object.entries(startedAt).filter(([, t]) => h.t && t <= h.t && h.t - t < 4000).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
  return `${h.kind} ${h.name}${near.length ? ` (just after the start of: ${near.join(', ')})` : ''}`;
};
const named = (hits, name) => hits.filter((h) => (h.kind === 'http' || h.kind === 'ws') && h.name === name);
/** The lookups of a probe's hostname that the browser logged, in the run with this phase letter ('s' the sandbox, 'c' the control page). */
const lookups = (p, all, phase) => (all.dnsNames ?? []).filter((n) => n === `${p.name}.${phase}.canary.test`);
const byKind = (kind) => PROBES.filter((p) => p.kind === kind);
/** What a probe got through to: the canary's hits for it, the UDP packets sent to its own port, or the requests that reached the site's own server. */
const reached = (p, data) => (p.origin === 'site' ? named(data.siteHits, p.name) : p.udp ? data.hits.filter((h) => h.kind === 'udp' && h.name === p.name) : p.tcp ? data.hits.filter((h) => h.kind === 'tcp' && h.name === p.name) : [...named(data.hits, p.name), ...data.hits.filter((h) => h.kind === 'tcp' && h.name === p.name)]);

// ================================================================================================================================
test.describe('the sandbox, as a hostile app with no permissions', () => {
  test('the app ran to the end (so "nothing reached the canary" is not because nothing ran)', ({}, info) => {
    const { sandbox } = results(info);
    expect(sandbox.reports.__ran, 'the app never started').toBeTruthy();
    expect(sandbox.finished, 'the app never finished its attempts').toBe(true);
  });

  test('the frame is sandboxed with allow-scripts and nothing else', ({}, info) => {
    const { attrs } = results(info).sandbox;
    expect(attrs.sandbox).toBe('allow-scripts');
    expect(attrs.referrerpolicy).toBe('no-referrer');
  });

  test('the page that runs apps carries the production policy', ({}, info) => {
    expect(results(info).sandbox.hostCsp).toBe(productionHeaders().runnerCsp);
  });

  for (const p of byKind('net')) {
    test(`cannot reach the network: ${p.name}`, ({}, info) => {
      const { sandbox } = results(info);
      const gap = gapFor(p.name, info.project.name);
      test.fail(Boolean(gap), gap);
      expect(sandbox.started, `${p.name} was never tried`).toContain(p.name);
      if (p.dns) {
        const all = results(info);
        test.skip(!all.dnsObserved, 'this browser does not write down its DNS lookups, so a lookup cannot be seen');
        expect(lookups(p, all, 's'), `${p.name}: the browser looked up a hostname the app chose`).toEqual([]);
        return;
      }
      expect(reached(p, sandbox), `${p.name} got out`).toEqual([]);
    });
  }

  test('nothing else reached the canary: no HTTP, WebSocket, bare TCP connection or UDP packet', ({}, info) => {
    const { sandbox } = results(info);
    expect(sandbox.hits.filter((h) => !gapFor(h.name, info.project.name)).map((h) => describeHit(h, sandbox.startedAt)), 'the canary was reached').toEqual([]);
    expect(sandbox.siteHits, "the site's own server was reached by the app").toEqual([]);
  });

  test('no popup, download, dialog or cookie, and the page that runs the app does not move', ({}, info) => {
    const { sandbox } = results(info);
    expect(sandbox.popups, 'a window opened').toEqual([]);
    expect(sandbox.downloads, 'a file was downloaded').toEqual([]);
    expect(sandbox.dialogs, 'a dialog opened').toEqual([]);
    expect(sandbox.cookies, 'the app changed the cookies of the page that runs it').toEqual(['hostcookie']);
    expect(sandbox.strayNavigations, 'the page that runs the app was navigated').toEqual([]);
    expect(sandbox.pages, 'a second page is open').toBe(1);
  });

  for (const p of byKind('cap')) {
    test(`is refused: ${p.name}`, ({}, info) => {
      const { sandbox } = results(info);
      expect(sandbox.started, `${p.name} was never tried`).toContain(p.name);
      expect(sandbox.reports[p.name]?.result, `${p.name}: ${sandbox.reports[p.name]?.detail ?? 'no report'}`).toBe('blocked');
    });
  }

  for (const p of byKind('works')) {
    test(`still works: ${p.name}`, ({}, info) => {
      const { sandbox } = results(info);
      expect(sandbox.reports[p.name]?.result, `${p.name}: ${sandbox.reports[p.name]?.detail ?? 'no report'}`).toBe('allowed');
    });
  }
});

// ================================================================================================================================
// The same attacks with nothing in the way: each one a browser can observe must reach the canary. If one does not, the probe is
// broken, and the sandbox result above would mean nothing.
test.describe('control: the same attacks on a page with no sandbox and no policy', () => {
  test('the probe page ran to the end', ({}, info) => {
    expect(results(info).control.finished).toBe(true);
  });

  for (const p of byKind('net').filter((x) => !x.harness)) {
    test(`reaches the canary: ${p.name}`, ({}, info) => {
      if (p.dns) {
        const all = results(info);
        test.skip(!all.dnsObserved || !(p.dnsControl ?? []).includes(info.project.name), 'this browser does not look the name up with nothing in the way, or does not log lookups, so the attack cannot be observed');
        expect(lookups(p, all, 'c'), `${p.name}: no lookup, so the sandbox result for it means nothing`).not.toEqual([]);
        return;
      }
      test.skip(!p.control.includes(info.project.name), 'this browser ignores the attack even with nothing in the way, so it cannot be observed');
      const { control } = results(info);
      const load = control.lastLoads?.[p.name];
      const why = load && (load.loaded !== true || !load.started) ? ` (its page ${load.loaded !== true ? `did not load: ${load.loaded}` : 'loaded but the probe never started'})` : '';
      expect(reached(p, control), `${p.name} never got out, so the sandbox result for it means nothing${why}`).not.toEqual([]);
    });
  }

  test('opens windows, downloads a file, shows a dialog and sets a cookie', ({}, info) => {
    const { control } = results(info);
    expect(control.popups.length, 'no popup opened').toBeGreaterThan(0);
    expect(control.downloads.length, 'nothing downloaded').toBeGreaterThan(0);
    expect(control.dialogs.length, 'no dialog').toBeGreaterThan(0);
    expect(control.cookies, 'no cookie planted').toContain('planted');
  });

  for (const p of byKind('cap').filter((x) => x.controlExpect)) {
    test(`is allowed: ${p.name}`, ({}, info) => {
      const r = results(info).control.reports[p.name];
      expect(r?.result, `${p.name}: ${r?.detail ?? 'no report'}`).toBe(p.controlExpect);
    });
  }

  for (const p of byKind('works')) {
    test(`works: ${p.name}`, ({}, info) => {
      expect(results(info).control.reports[p.name]?.result).toBe('allowed');
    });
  }
});
