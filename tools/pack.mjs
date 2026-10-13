// Packs a folder into an .applet:  node tools/pack.mjs <folder> <out.applet>
// Checks the package the same way the site does before writing it.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { buildZipCompressed } from '../js/zipwrite.js';
import { validateManifest, assertAppletPackage } from '../js/manifest.js';
import { buildDocument } from '../js/sandbox.js';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: node tools/pack.mjs <folder> <out.applet>'); process.exit(2); }

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
try {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${dir} is not a folder`);
  const files = new Map(walk(dir).map((f) => [relative(dir, f).split(sep).join('/'), new Uint8Array(readFileSync(f))]));
  if (!files.has('manifest.json')) throw new Error('The folder has no manifest.json');
  const manifest = validateManifest(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))));
  assertAppletPackage(manifest, files);
  buildDocument(manifest, files); // catches missing files and network references
  const blob = await buildZipCompressed([...files]);
  writeFileSync(out, new Uint8Array(await blob.arrayBuffer()));
  console.log(`${out}: ${files.size} files, ${manifest.title} ${manifest.version}`);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
