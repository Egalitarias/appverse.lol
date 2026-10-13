#!/usr/bin/env node
// Builds the npm package for the applet tools into dist/npm (or the folder you give), then you publish from there:
//
//   node tools/build-npm.mjs
//   cd dist/npm && npm publish --access public
//
// The package holds exactly the files in the website's "Download tools" bundle (js/downloads.js is the one list), so
// the download, the tests and the npm package cannot drift apart. The repository's own package.json stays private.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLES } from '../js/downloads.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'appverse-tools/';
export const PACKAGE_VERSION = '0.1.1';

const README = `# appverse

The \`applet\` command for making apps for [Appverse](https://appverse.lol): small web apps (plain HTML, CSS and JavaScript) that run
safely in the browser, in a sandbox with no network access, packed as \`.applet\` files.

Needs Node.js 20 or newer.

\`\`\`
npx appverse new my-app          start an app from the starter template
cd my-app
npx appverse dev                 run it in the browser sandbox, reloading each time you save a file
npx appverse check               look for mistakes and warnings (--strict makes warnings fail)
npx appverse pack                build my-app.applet
npx appverse inspect app.applet  list a package's manifest and files
npx appverse unpack app.applet   extract a package
\`\`\`

Install it once with \`npm install -g appverse\` and the command is just \`applet\` (for example \`applet dev\`).

\`applet check\` finds what would stop an app from working in the sandbox: files or URLs that are not in the package, network calls,
\`localStorage\` and cookies, a bridge call without its permission, ES module imports. Drop the packed file on https://appverse.lol to run it.

- Guide: https://appverse.lol/make.html
- Specification: https://appverse.lol/spec.html
- Pack and test in the browser, no install: https://appverse.lol/pack.html

MIT licensed.
`;

export function buildNpmPackage(out = join(root, 'dist', 'npm')) {
  out = resolve(out);
  // empty the folder rather than delete it: on Windows a folder that is some shell's current directory cannot be removed
  if (existsSync(out)) for (const name of readdirSync(out)) rmSync(join(out, name), { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const files = [];
  for (const f of BUNDLES.tools.files) {
    if (!f.as.startsWith(PREFIX)) throw new Error(`unexpected path in the tools bundle: ${f.as}`);
    const rel = f.as.slice(PREFIX.length);
    if (rel === 'package.json' || rel === 'README.txt') continue; // replaced by the package's own
    const dest = join(out, rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (f.text !== undefined) writeFileSync(dest, f.text);
    else writeFileSync(dest, readFileSync(join(root, f.from)));
    files.push(rel);
  }
  writeFileSync(join(out, 'README.md'), README);
  const pkg = {
    name: 'appverse',
    version: PACKAGE_VERSION,
    description: 'Make, test and pack Appverse apps (.applet): the applet command-line tool',
    type: 'module',
    bin: { applet: 'tools/applet.mjs', appverse: 'tools/applet.mjs' },
    files: ['tools', 'js', 'templates', 'README.md', 'LICENSE'],
    engines: { node: '>=20' },
    license: 'MIT',
    author: 'Gary Davies',
    homepage: 'https://appverse.lol/make.html',
    repository: { type: 'git', url: 'git+https://github.com/Egalitarias/appverse.lol.git' },
    keywords: ['appverse', 'applet', 'sandbox', 'cli', 'web-app'],
  };
  writeFileSync(join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  return { out, files: [...files, 'README.md', 'package.json'], pkg };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { out, files, pkg } = buildNpmPackage(process.argv[2]);
  console.log(`Built ${pkg.name}@${pkg.version} in ${out} (${files.length} files).\nTo publish: cd "${out}" && npm publish --access public`);
}
