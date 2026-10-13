// Reads a folder and packs it into an .applet using the same checks as the site: js/packer.js.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { normalizeFiles, readManifest, manifestFromFields, lintApplet, buildApplet } from '../js/packer.js';
import { validateManifest } from '../js/manifest.js';

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

/** -> { manifest, blob, issues, files }. Throws a readable Error when the folder cannot be packed (errors are in `issues` too). */
export async function packFolder(dir) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${dir} is not a folder`);
  const list = walk(dir).map((f) => ({ path: relative(dir, f).split(sep).join('/'), data: new Uint8Array(readFileSync(f)) }));
  const { files, errors } = normalizeFiles(list);
  if (errors.length) throw new Error(errors.join('\n'));
  const { raw, error } = readManifest(files);
  if (error) throw new Error(error);
  if (!raw) throw new Error('The folder has no manifest.json');
  const manifest = validateManifest(raw);
  const issues = lintApplet(manifest, files);
  const bad = issues.filter((i) => i.level === 'error');
  if (bad.length) throw new Error(bad.map((i) => (i.file ? `${i.file}: ${i.message}` : i.message)).join('\n'));
  return { manifest, blob: await buildApplet(manifest, files), issues, files };
}
