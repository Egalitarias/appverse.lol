#!/usr/bin/env node
// applet: one command for making Appverse apps. Needs Node 20 or newer, no install step.
//
//   node tools/applet.mjs new my-app          start an app from the starter template
//   node tools/applet.mjs dev                 run it in the browser sandbox, reloading when you save
//   node tools/applet.mjs check               look for mistakes (--strict: warnings fail too)
//   node tools/applet.mjs pack                build my-app.applet
//   node tools/applet.mjs inspect file.applet list a package's manifest and files
//   node tools/applet.mjs unpack file.applet  extract a package into a folder
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, basename, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readZip } from '../js/zip.js';
import { validateManifest } from '../js/manifest.js';
import { readManifest, lintApplet, buildApplet } from '../js/packer.js';
import { startDev } from './applet-dev.mjs';
import { walk, readFolder } from './pack-folder.mjs';

const toolsDir = dirname(fileURLToPath(import.meta.url));

const HELP = `applet: make, test and pack Appverse apps

  applet new <name>                 start an app in a new folder from the starter
  applet dev [folder] [--port N] [--open]
                                    run the app in the browser sandbox and reload when you save a file
  applet check [folder | file.applet] [--strict]
                                    look for mistakes: manifest, entry page, network use, missing files, browser storage,
                                    missing permissions; --strict makes warnings fail too
  applet pack [folder] [out.applet] build a package
  applet inspect <file.applet>      show a package's manifest and files
  applet unpack <file.applet> [folder] [--force]
                                    extract a package into a folder
  applet help [command]

"folder" defaults to the current folder. Documentation: https://appverse.lol/make.html`;

const SHORT = {
  new: 'applet new <name>\n  Creates a folder <name> from the starter template (templates/starter) with a manifest, a small working app, a README and\n  AGENTS.md (notes for AI agents). The id is set to local.<name>: change it before sharing (the id names the storage slot,\n  so use the reverse of a domain you own).',
  dev: 'applet dev [folder] [--port N] [--open]\n  Starts a server on http://localhost:<port>/ (default 8080) that runs the app in the same sandbox as the website and\n  reloads it whenever a file in the folder changes. Checks show above the app. It only listens on this computer.\n  Stop it with Ctrl+C.',
  check: 'applet check [folder | file.applet] [--strict]\n  Without a manifest.json it guesses one, like the Pack an app page. Exit code 1 if there are errors. Warnings are things\n  that run but probably do not do what you meant (a bridge used without its permission, localStorage, network calls).\n  With --strict they make the exit code 1, which is useful in scripts and before you pack.',
  pack: 'applet pack [folder] [out.applet]\n  Needs a manifest.json. Checks the app, then writes <folder-name>.applet (or out.applet).',
  inspect: 'applet inspect <file.applet>\n  Prints the manifest and every file with its size.',
  unpack: 'applet unpack <file.applet> [folder] [--force]\n  Extracts into <file-name>/ by default. Refuses to write into a folder that already has files unless --force.',
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const title = (s) => s.replace(/[-_.]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function printFindings(findings) {
  const where = (f) => (f.file ? `${f.file}: ` : '');
  for (const f of findings) {
    if (f.level === 'error') console.error(`error: ${where(f)}${f.message}`);
    else if (f.level === 'warn') console.warn(`warning: ${where(f)}${f.message}`);
    else console.log(`note: ${f.message}`);
  }
  return { errors: findings.filter((f) => f.level === 'error').length, warnings: findings.filter((f) => f.level === 'warn').length };
}

/** A package file as { files, manifest }. */
async function readPackage(file) {
  const files = await readZip(new Uint8Array(readFileSync(file)));
  const found = readManifest(files);
  if (found.error || !found.raw) throw new Error(found.error ?? 'This package has no manifest.json');
  return { files, manifest: validateManifest(found.raw) };
}

// ---------------------------------------------------------------- commands

async function cmdCheck(rawArgs) {
  const strict = rawArgs.includes('--strict'); // warnings fail too
  const args = rawArgs.filter((a) => a !== '--strict');
  const target = args[0] && !args[0].startsWith('--') ? args[0] : '.';
  let files, manifest, guessed = false;
  if (/\.applet$/i.test(target) && existsSync(target) && statSync(target).isFile()) ({ files, manifest } = await readPackage(target));
  else ({ files, manifest, guessed } = readFolder(target));
  if (guessed) console.log('note: no manifest.json, so the details were guessed. `applet new` makes a folder with one.');
  const { errors, warnings } = printFindings(lintApplet(manifest, files));
  const what = `${manifest.title} (${plural(files.size, 'file')})`;
  if (errors) { console.error(`${plural(errors, 'problem')} in ${what}${warnings ? `, ${plural(warnings, 'warning')}` : ''}.`); return 1; }
  if (strict && warnings) { console.error(`${plural(warnings, 'warning')} in ${what}: --strict makes warnings fail.`); return 1; }
  console.log(warnings ? `OK: ${what} has no blocking problems, ${plural(warnings, 'warning')}.` : `OK: ${what} passes all checks.`);
  return 0;
}

async function cmdPack(args) {
  const positional = args.filter((a) => !a.startsWith('--'));
  let [dir = '.', out] = positional;
  // `applet pack small.applet`: one name ending in .applet (and not a folder) means the output file
  if (positional.length === 1 && /\.applet$/i.test(dir) && !(existsSync(dir) && statSync(dir).isDirectory())) { out = dir; dir = '.'; }
  const { files, manifest, guessed } = readFolder(dir);
  if (guessed) throw new Error(`No manifest.json in ${dir}. \`applet new\` makes a folder with one, or use the Pack an app page.`);
  const { errors } = printFindings(lintApplet(manifest, files));
  if (errors) throw new Error(`${plural(errors, 'problem')} to fix before this can be packed.`);
  const target = out || `${basename(resolve(dir))}.applet`;
  const zip = new Uint8Array(await (await buildApplet(manifest, files)).arrayBuffer());
  await readZip(zip); // round-trip check with the same reader the website uses
  writeFileSync(target, zip);
  console.log(`Packed ${plural(files.size, 'file')} into ${target} (${(zip.length / 1024).toFixed(1)} KB)`);
  return 0;
}

async function cmdInspect(file) {
  if (!file) throw new Error('applet inspect <file.applet>');
  const { files, manifest } = await readPackage(file);
  console.log(manifest);
  for (const [name, data] of files) console.log(String(data.length).padStart(9), name);
  return 0;
}

async function cmdUnpack(args) {
  const force = args.includes('--force');
  const [file, dir] = args.filter((a) => !a.startsWith('--'));
  if (!file) throw new Error('applet unpack <file.applet> [folder]');
  const files = await readZip(new Uint8Array(readFileSync(file)));
  const target = resolve(dir ?? basename(file).replace(/\.(applet|zip)$/i, ''));
  if (existsSync(target) && readdirSync(target).length && !force) throw new Error(`${target} already has files. Choose another folder, or add --force to overwrite.`);
  for (const [name, data] of files) {
    const dest = resolve(target, name);
    if (!dest.startsWith(target + sep)) throw new Error(`Unsafe path in the package: ${name}`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
  }
  console.log(`Unpacked ${plural(files.size, 'file')} into ${target}`);
  return 0;
}

function cmdNew(args) {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) throw new Error('applet new <name>');
  if (!/^[\w][\w .-]*$/.test(name)) throw new Error(`"${name}" is not a good folder name: use letters, digits, - and _`);
  const templateDir = join(toolsDir, '..', 'templates', 'starter');
  if (!existsSync(templateDir)) throw new Error(`The starter template is missing (${templateDir}).`);
  const dest = resolve(name);
  if (existsSync(dest) && readdirSync(dest).length) throw new Error(`${dest} already has files. Choose another name.`);
  for (const { name: rel, data } of walk(templateDir, '', true)) {
    const to = join(dest, rel);
    mkdirSync(dirname(to), { recursive: true });
    if (rel === 'manifest.json') {
      const m = JSON.parse(data.toString('utf8'));
      m.title = title(basename(dest)) || m.title;
      m.id = `local.${slug(basename(dest)) || 'app'}`.slice(0, 64);
      writeFileSync(to, JSON.stringify(m, null, 2) + '\n');
    } else if (rel === 'index.html') writeFileSync(to, data.toString('utf8').replace('<title>My App</title>', `<title>${(title(basename(dest)) || 'My App').replace(/[<&]/g, '')}</title>`));
    else writeFileSync(to, data);
  }
  const id = slug(basename(dest)) || 'app';
  // via npx there is no `applet` on the PATH, so show the command that works
  const cmd = process.env.npm_command === 'exec' ? 'npx appverse' : 'applet';
  console.log(`Created ${dest} (starter).
  Edit index.html and app.js, then from inside the folder:
    ${cmd} dev      run it in the browser sandbox, reloading when you save
    ${cmd} check    look for mistakes
    ${cmd} pack     build ${id}.applet
  Before you share it, change "id" in manifest.json to your own (the reverse of a domain you own, e.g. com.mystudio.${id}).`);
  return 0;
}

async function cmdDev(args) {
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 8080;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port needs a number from 0 to 65535');
  const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port') ?? '.';
  const dev = await startDev({ dir, port, onChange: () => console.log(`${new Date().toLocaleTimeString()}  changed: reloading`) });
  console.log(`Running ${dev.root}\n  ${dev.url}\nSave a file and the app reloads. Press Ctrl+C to stop.`);
  if (args.includes('--open')) {
    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', dev.url]] : process.platform === 'darwin' ? ['open', [dev.url]] : ['xdg-open', [dev.url]];
    spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => console.log('(could not open a browser: open the address above yourself)')).unref();
  }
  await new Promise((r) => { process.once('SIGINT', r); process.once('SIGTERM', r); });
  await dev.close();
  console.log('Stopped.');
  return 0;
}

/** Runs `applet`. Returns the exit code. */
export async function appletMain(argv) {
  const [cmd, ...args] = argv;
  try {
    switch (cmd) {
      case undefined: case '--help': case '-h': console.log(HELP); return 0;
      case 'help': console.log(SHORT[args[0]] ?? HELP); return 0;
      case 'new': return cmdNew(args);
      case 'dev': return await cmdDev(args);
      case 'check': return await cmdCheck(args);
      case 'pack': return await cmdPack(args);
      case 'inspect': return await cmdInspect(args[0]);
      case 'unpack': return await cmdUnpack(args);
      default: console.error(`Unknown command "${cmd}".\n\n${HELP}`); return 2;
    }
  } catch (e) {
    console.error('Error:', e.message);
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await appletMain(process.argv.slice(2));
}
