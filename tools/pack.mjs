// Checks a folder and packs it into an .applet:  node tools/pack.mjs <folder> <out.applet>
import { writeFileSync } from 'node:fs';
import { packFolder } from './pack-folder.mjs';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: node tools/pack.mjs <folder> <out.applet>'); process.exit(2); }

try {
  const { manifest, blob, issues, files } = await packFolder(dir);
  for (const i of issues) console.log(`${i.level}: ${i.file ? `${i.file}: ` : ''}${i.message}`);
  writeFileSync(out, new Uint8Array(await blob.arrayBuffer()));
  console.log(`${out}: ${files.size} files, ${manifest.title} ${manifest.version}`);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
