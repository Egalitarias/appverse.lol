// Reading an app folder and packing it into an .applet with the same checks as the site (js/packer.js). Used by tools/applet.mjs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { LIMITS, safePath } from '../js/zip.js';
import { validateManifest } from '../js/manifest.js';
import { readManifest, guessManifest, manifestFromFields, lintApplet, buildApplet } from '../js/packer.js';

/** All files under a folder as [{ name, data }]; skips dotfiles, node_modules, .applet files and the folder's own AGENTS.md
 *  (a note for the AI agent writing the app, which does not belong in the package; `keepNotes` keeps it, to copy the starter). */
export function walk(dir, prefix = '', keepNotes = false) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || name === 'node_modules' || (name === 'AGENTS.md' && !prefix && !keepNotes)) continue;
    const full = join(dir, name);
    const rel = prefix + name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel + '/', keepNotes));
    else if (!name.toLowerCase().endsWith('.applet')) out.push({ name: rel, data: readFileSync(full) });
  }
  return out;
}

/** An app folder as { root, files: Map, manifest, guessed }. Without a manifest.json one is guessed (`guessed` is true).
 *  Throws a readable Error when the folder cannot be read or its manifest is wrong. */
export function readFolder(dir) {
  const root = resolve(dir);
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${dir} is not a folder`);
  const entries = walk(root);
  if (!entries.length) throw new Error(`${dir} has no files`);
  let total = 0;
  for (const { name, data } of entries) {
    safePath(name);
    if (data.length > LIMITS.maxFileBytes) throw new Error(`${name} is too large (the limit for one file is ${LIMITS.maxFileBytes / 1048576} MB)`);
    total += data.length;
  }
  if (entries.length > LIMITS.maxEntries) throw new Error(`${entries.length} files is too many for a package (the limit is ${LIMITS.maxEntries})`);
  if (total > LIMITS.maxTotalBytes) throw new Error(`The files add up to ${(total / 1048576).toFixed(1)} MB; the limit is ${LIMITS.maxTotalBytes / 1048576} MB`);
  const files = new Map(entries.map((e) => [e.name, new Uint8Array(e.data)]));
  const found = readManifest(files);
  if (found.error) throw new Error(found.error);
  const guessed = !found.raw;
  const manifest = guessed ? manifestFromFields(guessManifest(files, basename(root))) : validateManifest(found.raw);
  return { root, files, manifest, guessed };
}

/** -> { manifest, blob, issues, files }. Needs a manifest.json. Throws a readable Error when the folder cannot be packed. */
export async function packFolder(dir) {
  const { files, manifest, guessed } = readFolder(dir);
  if (guessed) throw new Error('The folder has no manifest.json');
  const issues = lintApplet(manifest, files);
  const bad = issues.filter((i) => i.level === 'error');
  if (bad.length) throw new Error(bad.map((i) => (i.file ? `${i.file}: ${i.message}` : i.message)).join('\n'));
  return { manifest, blob: await buildApplet(manifest, files), issues, files };
}
