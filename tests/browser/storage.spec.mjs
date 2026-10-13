// The storage bridge keeps each app's data under the app's id. That id is written by the app's own author, so these tests ask what
// that does and does not protect. They run a real app in the sandbox, in a browser profile that keeps its data between apps.
import { test, expect } from '@playwright/test';
import { startSite } from './servers.mjs';
import { buildZip } from '../../js/zipwrite.js';

const enc = new TextEncoder();
const pack = async (id, script) => {
  const manifest = { applet: 1, id, title: id, entry: 'index.html', width: 320, height: 200, permissions: ['storage'] };
  const html = `<!doctype html><title>t</title><script>${script}</script>`;
  const zip = buildZip([['manifest.json', enc.encode(JSON.stringify(manifest))], ['index.html', enc.encode(html)]]);
  return Buffer.from(await zip.arrayBuffer());
};

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

test.describe('app storage', () => {
  let site, context, page;
  test.beforeAll(async ({ browser }) => {
    site = await startSite();
    context = await browser.newContext();
    page = await context.newPage();
    const saved = await runApp(page, site.url, await pack('lol.appverse.notes', "appverse.storage.set('secret', 'hunter2').then(() => console.log('RESULT:saved'))"));
    expect(saved).toBe('saved');
  });
  test.afterAll(async () => { await context?.close(); await site?.close(); });

  const read = (id) => pack(id, "appverse.storage.get('secret').then((v) => console.log('RESULT:' + v))");

  test('an app with its own id does not see another app\'s data', async () => {
    expect(await runApp(page, site.url, await read('com.example.someone-else'))).toBe('null');
  });

  test('the same app still sees its own data', async () => {
    expect(await runApp(page, site.url, await read('lol.appverse.notes'))).toBe('hunter2');
  });

  // KNOWN GAP: data is stored under the id the app declares, and nothing proves who declared it, so any package can read and
  // overwrite another app's data by writing that app's id in its manifest. Passing means the gap is closed: delete test.fail then.
  test('an app cannot read another app\'s data by claiming its id', async () => {
    test.fail(true, 'storage is keyed by the id an app declares for itself, so an app can claim any other app\'s id');
    expect(await runApp(page, site.url, await read('lol.appverse.notes'))).toBe('null');
  });
});
