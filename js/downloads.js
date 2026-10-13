// Files offered as downloads on make.html. Each bundle is zipped in the browser from files the site already
// serves, so there are no binary artifacts to keep in sync. A file is { from, as } (fetched from the site and
// stored in the zip as `as`) or { as, text } (generated here).
import { buildZip, downloadBlob } from './zipwrite.js';

const TOOLS_PACKAGE = '{ "name": "appverse-tools", "private": true, "type": "module", "bin": { "applet": "tools/applet.mjs" } }\n';
const TOOLS_README = `Appverse tools
==============

Needs Node.js 20 or newer. No install step. Run from this folder (or give the full path to tools/applet.mjs):

  node tools/applet.mjs new my-app          start an app from the starter template
  node tools/applet.mjs dev my-app          run it in the browser sandbox, reloading when you save a file
  node tools/applet.mjs check my-app        look for mistakes and warnings (--strict makes warnings fail)
  node tools/applet.mjs pack my-app         build my-app.applet
  node tools/applet.mjs inspect app.applet  list a package's manifest and files
  node tools/applet.mjs unpack app.applet   extract a package into a folder
  node tools/applet.mjs help                all commands and options

"npm link" in this folder installs a plain "applet" command.

Documentation: https://appverse.lol/make.html
Specification: https://appverse.lol/spec.html
`;

const STARTER_FILES = ['manifest.json', 'index.html', 'app.js', 'style.css', 'README.md', 'AGENTS.md'];

export const BUNDLES = {
  starter: {
    filename: 'appverse-starter.zip',
    files: STARTER_FILES.map((f) => ({ from: `templates/starter/${f}`, as: `my-app/${f}` })),
  },
  tools: {
    filename: 'appverse-tools.zip',
    files: [
      ...['applet.mjs', 'applet-dev.mjs', 'pack-folder.mjs'].map((f) => ({ from: `tools/${f}`, as: `appverse-tools/tools/${f}` })),
      ...['zip.js', 'zipwrite.js', 'manifest.js', 'packer.js', 'sandbox.js'].map((f) => ({ from: `js/${f}`, as: `appverse-tools/js/${f}` })),
      ...STARTER_FILES.map((f) => ({ from: `templates/starter/${f}`, as: `appverse-tools/templates/starter/${f}` })),
      { from: 'LICENSE', as: 'appverse-tools/LICENSE' },
      { as: 'appverse-tools/package.json', text: TOOLS_PACKAGE },
      { as: 'appverse-tools/README.txt', text: TOOLS_README },
    ],
  },
};

export async function buildBundle(key, base = '') {
  const bundle = BUNDLES[key];
  if (!bundle) throw new Error(`Unknown download "${key}"`);
  const enc = new TextEncoder();
  const entries = await Promise.all(
    bundle.files.map(async (f) => {
      if (f.text !== undefined) return [f.as, enc.encode(f.text)];
      const res = await fetch(base + f.from);
      if (!res.ok) throw new Error(`Could not fetch ${f.from} (HTTP ${res.status})`);
      return [f.as, new Uint8Array(await res.arrayBuffer())];
    }),
  );
  return { filename: bundle.filename, blob: buildZip(entries) };
}

export async function downloadBundle(key) {
  const { filename, blob } = await buildBundle(key);
  downloadBlob(blob, filename);
}
