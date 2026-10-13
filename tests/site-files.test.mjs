import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSiteFiles } from '../tools/site-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { served, unused } = readSiteFiles();
const servedSet = new Set(served);
const pages = served.filter((f) => /^[^/]+\.html$/.test(f));

test('every line in tools/site-files.txt matches a tracked file', () => {
  assert.deepEqual(unused, []);
});

test('the site does not serve drafts, tests, docs or dotfiles', () => {
  const secret = served.filter((f) => /^(tests|docs)\//.test(f) || /(^|\/)\./.test(f) || /^(package\.json|TRADEMARK\.md|CONTRIBUTING\.md|README\.md)$/.test(f) || /^tools\/(deploy\.sh|Caddyfile|site-files\.)/.test(f));
  assert.deepEqual(secret, []);
});

test('the sitemap lists exactly the public pages the site serves (a noindex page stays off it)', () => {
  const xml = readFileSync(resolve(root, 'sitemap.xml'), 'utf8');
  const listed = [...xml.matchAll(/<loc>https:\/\/appverse\.lol\/([^<]*)<\/loc>/g)].map((m) => m[1] || 'index.html');
  const isPublic = (p) => !/<meta name="robots" content="noindex">/.test(readFileSync(resolve(root, p), 'utf8'));
  assert.deepEqual([...listed].sort(), pages.filter(isPublic).sort());
});

test('every page, script and stylesheet the served pages link to is served', () => {
  for (const page of pages) {
    const html = readFileSync(resolve(root, page), 'utf8');
    for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const ref = m[1];
      if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(ref)) continue; // https:, mailto:, data:, a fragment
      const path = ref.split(/[?#]/)[0];
      const file = posix.normalize(path.startsWith('/') ? path.slice(1) : path);
      if (file === './' || file === '.' || file === '') { assert.ok(servedSet.has('index.html')); continue; } // the home page
      assert.ok(servedSet.has(file), `${page} links to ${ref}, which the deploy does not serve`);
    }
  }
});
