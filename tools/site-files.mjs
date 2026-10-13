#!/usr/bin/env node
// Prints the tracked files that the site serves, one per line: the files that match tools/site-files.txt.
//
//   node tools/site-files.mjs | tar cf - -T -        (what tools/deploy.sh does)
//
// Fails if a line in the list matches no tracked file (a typo or a renamed file), so the list cannot quietly go stale.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The entries of a site-files list: [{ path, dir }]. */
export function parseList(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((path) => ({ path, dir: path.endsWith('/') }));
}

/** { served, unused }: the tracked files the list lets through, and the list entries that matched nothing. */
export function siteFiles(tracked, entries) {
  const matches = (e, f) => (e.dir ? f.startsWith(e.path) : f === e.path);
  return {
    served: tracked.filter((f) => entries.some((e) => matches(e, f))),
    unused: entries.filter((e) => !tracked.some((f) => matches(e, f))).map((e) => e.path),
  };
}

export function readSiteFiles(dir = root) {
  const tracked = execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }).split('\n').filter(Boolean);
  return siteFiles(tracked, parseList(readFileSync(resolve(dir, 'tools/site-files.txt'), 'utf8')));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { served, unused } = readSiteFiles();
  if (unused.length) {
    console.error(`tools/site-files.txt lists files that do not exist: ${unused.join(', ')}`);
    process.exit(1);
  }
  process.stdout.write(served.join('\n') + '\n');
}
