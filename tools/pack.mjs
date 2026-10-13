// Kept for compatibility: node tools/pack.mjs <folder> <out.applet> is `applet pack <folder> <out.applet>`.
import { appletMain } from './applet.mjs';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: node tools/pack.mjs <folder> <out.applet>'); process.exit(2); }
process.exitCode = await appletMain(['pack', dir, out]);
