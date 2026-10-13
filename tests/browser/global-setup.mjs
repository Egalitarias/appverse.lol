// Runs every browser through the attacks once, before any test, and writes what happened to .results/<engine>.json.
// BROWSERS=chromium,firefox limits it (the project names are the same).
import { chromium, firefox, webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collect } from './run.mjs';

const ENGINES = { chromium, firefox, webkit };

export default async function globalSetup() {
  const wanted = (process.env.BROWSERS ?? Object.keys(ENGINES).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const dir = fileURLToPath(new URL('./.results/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  await Promise.all(wanted.map(async (name) => {
    if (!ENGINES[name]) throw new Error(`unknown browser "${name}"`);
    writeFileSync(`${dir}${name}.json`, JSON.stringify(await collect(ENGINES[name]), null, 1));
  }));
}
