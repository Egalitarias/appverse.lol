import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const docs = ['README.md', 'CONTRIBUTING.md', 'TRADEMARK.md', ...readdirSync(new URL('docs/', root)).map((n) => `docs/${n}`)];

test('documents link to real addresses, not to folders on one computer', () => {
  for (const f of docs) {
    const text = readFileSync(new URL(f, root), 'utf8');
    // a link out of the repository ("../other-repo") works only where that folder happens to sit next to this one
    assert.ok(!/\]\(\.\.\//.test(text), `${f}: a markdown link starts with ../`);
    assert.ok(!/href="\.\.\//.test(text), `${f}: an href starts with ../`);
    assert.ok(!/\.\.\/(gameverse|appverse)[\w.-]*/.test(text), `${f}: mentions a sibling folder`);
    assert.ok(!/[A-Za-z]:\\|\/Users\/|\/home\//.test(text), `${f}: mentions a path on a personal computer`);
  }
});

test('the workflow runs the tests on Linux and Windows without a build step', () => {
  const yml = readFileSync(new URL('.github/workflows/test.yml', root), 'utf8');
  assert.match(yml, /npm test/);
  assert.match(yml, /ubuntu-latest/);
  assert.match(yml, /windows-latest/);
  assert.match(yml, /permissions:\s*\n\s+contents: read/, 'the workflow token must be read-only');
  assert.ok(!/npm (ci|install)|secrets\./.test(yml), 'no install step and no secrets are needed');
});

test('the test script has no glob, because Node 20 (which the tools support) cannot expand one', () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.ok(!pkg.scripts.test.includes('*'), `scripts.test is "${pkg.scripts.test}"`);
});
