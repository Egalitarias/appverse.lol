import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const caddy = readFileSync(new URL('tools/Caddyfile', root), 'utf8');
const runnerRe = new RegExp(caddy.match(/@runner path_regexp runner (\S+)/)[1]);
const otherRe = caddy.match(/not path_regexp runner2 (\S+)/)[1];
const isRunner = (name) => runnerRe.test('/' + name);

test('the pages that run apps are exactly the ones allowed inline script in the Caddyfile', () => {
  const pages = readdirSync(root).filter((f) => f.endsWith('.html'));
  const runners = pages.filter((f) => /<script[^>]*src="js\/(main|library|pack)\.js"/.test(readFileSync(new URL(f, root), 'utf8')));
  assert.deepEqual(pages.filter(isRunner).sort(), runners.sort());
  for (const ok of ['/', '/index.html', '/library.html', '/pack.html']) assert.ok(runnerRe.test(ok), ok);
  for (const no of ['/make.html', '/spec.html', '/js/main.js', '/library.html.js', '/x/index.html', '/examples/notes.applet']) assert.ok(!runnerRe.test(no), no);
  assert.equal(otherRe, caddy.match(/@runner path_regexp runner (\S+)/)[1], 'the strict policy must be the exact opposite of the runner-page one');
});

test('every other page has no inline script, inline style or event-handler attribute (its CSP forbids them)', () => {
  for (const f of readdirSync(root).filter((n) => n.endsWith('.html') && !isRunner(n))) {
    const html = readFileSync(new URL(f, root), 'utf8');
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `${f}: inline <script>`);
    assert.ok(!/<style[\s>]/i.test(html), `${f}: inline <style>`);
    assert.ok(!/\sstyle\s*=/i.test(html), `${f}: style attribute`);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `${f}: event-handler attribute`);
  }
});

test('the runner-page policy keeps what an app document needs', () => {
  const runner = caddy.match(/header @runner Content-Security-Policy "([^"]*)"/)[1];
  for (const need of ["script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", 'data: blob:', 'font-src data:', "frame-ancestors 'none'"]) assert.ok(runner.includes(need), `missing ${need}`);
  const other = caddy.match(/header @other Content-Security-Policy "([^"]*)"/)[1];
  assert.ok(!other.includes('unsafe-inline'), 'the strict policy must not allow inline code');
});
