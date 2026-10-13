// An app's saved data belongs to the package that saved it (the SHA-256 of the file), not to the id the app's author wrote in its
// manifest: an id proves nothing about who wrote an app. These tests run real apps in the sandbox, in one browser profile that keeps
// its data between apps, and ask who can see what.
import { test, expect } from '@playwright/test';
import { startSite } from './servers.mjs';
import { buildZip } from '../../js/zipwrite.js';

const enc = new TextEncoder();
const NOTES = 'lol.appverse.notes';

const pack = async (id, script, extra = '') => {
  const manifest = { applet: 1, id, title: id, entry: 'index.html', width: 320, height: 200, permissions: ['storage'] };
  const html = `<!doctype html><title>t</title><p>${extra}</p><script>${script}</script>`;
  const zip = buildZip([['manifest.json', enc.encode(JSON.stringify(manifest))], ['index.html', enc.encode(html)]]);
  return Buffer.from(await zip.arrayBuffer());
};

// first run saves the secret and says "saved"; every later run of the same package says what it finds
const KEEPER = "appverse.storage.get('secret').then((v) => v === null ? appverse.storage.set('secret', 'hunter2').then(() => console.log('RESULT:saved')) : console.log('RESULT:' + v))";
const READER = "appverse.storage.get('secret').then((v) => console.log('RESULT:' + v))";

/** Runs an app on the host page and returns what it printed with console.log("RESULT:..."). */
async function runApp(page, siteUrl, buffer) {
  const printed = [];
  const on = (m) => { if (m.text().startsWith('RESULT:')) printed.push(m.text().slice(7)); };
  page.on('console', on);
  await page.goto(`${siteUrl}/index.html`);
  await page.setInputFiles('#file', { name: 'a.applet', mimeType: 'application/octet-stream', buffer });
  await page.locator('#run').click();
  const end = Date.now() + 8000;
  while (!printed.length && Date.now() < end) await page.waitForTimeout(100);
  page.off('console', on);
  return printed[0];
}

test.describe('app storage belongs to the package, not to the id it declares', () => {
  let site, context, page, notes;

  test.beforeAll(async ({ browser }) => {
    site = await startSite();
    context = await browser.newContext();
    page = await context.newPage();
    notes = await pack(NOTES, KEEPER);
    expect(await runApp(page, site.url, notes), 'the first run saves the secret').toBe('saved');
  });
  test.afterAll(async () => { await context?.close(); await site?.close(); });

  test('the same package gets its data back', async () => {
    expect(await runApp(page, site.url, notes)).toBe('hunter2');
  });

  test('an app with another id does not see it', async () => {
    expect(await runApp(page, site.url, await pack('com.example.someone-else', READER))).toBe('null');
  });

  test('an app cannot read another app\'s data by claiming its id', async () => {
    expect(await runApp(page, site.url, await pack(NOTES, READER))).toBe('null');
  });

  test('an edited copy of an app (same id, different file) starts empty: a new version does not inherit data', async () => {
    expect(await runApp(page, site.url, await pack(NOTES, KEEPER, 'version 2'))).toBe('saved');
  });

  test('data an older version of the site kept under the declared id is never handed out', async () => {
    await page.goto(`${site.url}/index.html`);
    await page.evaluate((id) => localStorage.setItem(`appverse:storage:${id}`, JSON.stringify([['secret', 'legacy']])), NOTES);
    expect(await runApp(page, site.url, await pack(NOTES, READER, 'after legacy'))).toBe('null');
    expect(await runApp(page, site.url, notes)).toBe('hunter2');
  });
});
