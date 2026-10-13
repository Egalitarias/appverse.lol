// Packs every examples/<name>/ folder into examples/<name>.applet and writes examples/catalog.json, the library's featured list.
// Run it after adding or changing an example, and commit the output:  node tools/build-examples.mjs
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { packFolder } from './pack-folder.mjs';

const root = new URL('../examples/', import.meta.url);
const catalog = [];
for (const slug of readdirSync(root).filter((n) => statSync(new URL(`${n}/`, root), { throwIfNoEntry: false })?.isDirectory()).sort()) {
  const { manifest, blob, issues } = await packFolder(new URL(`${slug}/`, root).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  writeFileSync(new URL(`${slug}.applet`, root), bytes);
  for (const i of issues.filter((i) => i.level === 'warn')) console.log(`${slug}: warning: ${i.message}`);
  catalog.push({ slug, id: manifest.id, title: manifest.title, author: manifest.author, description: manifest.description, license: manifest.license, permissions: manifest.permissions, size: bytes.length, file: `examples/${slug}.applet` });
}
writeFileSync(new URL('catalog.json', root), JSON.stringify(catalog, null, 2) + '\n');
console.log(`${catalog.length} example${catalog.length === 1 ? '' : 's'}: ${catalog.map((c) => c.slug).join(', ')}`);
