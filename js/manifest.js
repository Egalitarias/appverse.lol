// Applet manifest and package validation, shared by the website and (later) the applet CLI.

export const PERMISSIONS = {
  storage: 'Save and load data on this device',
  fullscreen: 'Go fullscreen',
  clipboard: 'Copy text to your clipboard',
};

const ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;

function str(m, key, max, required = false) {
  const v = m[key];
  if (v === undefined || v === '') {
    if (required) throw new Error(`manifest.${key} is required`);
    return '';
  }
  if (typeof v !== 'string' || v.length > max) throw new Error(`manifest.${key} must be a string up to ${max} chars`);
  return v;
}

/** The only kinds of file a package may hold: web files, images, fonts, audio and video, data and notes. No wasm, no executables. */
const ALLOWED_FILE = /\.(?:html?|css|js|json|txt|md|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp3|ogg|wav|m4a|mp4|webm)$/i;

/** Names of files in a package that are not an allowed kind (manifest.json is always fine). */
export function disallowedFiles(files) {
  return [...files.keys()].filter((name) => name !== 'manifest.json' && !ALLOWED_FILE.test(name));
}

/** A CSP set from inside the package (a <meta http-equiv="Content-Security-Policy">) is refused: Appverse injects the one policy. */
export const CSP_META = /<meta\b[^>]*http-equiv\s*=\s*["']?\s*content-security-policy/i;

/** Throws unless the package is made only of allowed files, the entry is an HTML page, and no page sets its own CSP. The last check before anything runs. */
export function assertAppletPackage(manifest, files) {
  if (!/\.html?$/i.test(manifest?.entry ?? '')) throw new Error('The entry file must be an HTML page ending in .html');
  if (!files.has(manifest.entry)) throw new Error(`Entry file "${manifest.entry}" not found in package`);
  const bad = disallowedFiles(files);
  if (bad.length) throw new Error(`An app may hold only web files, images, fonts, audio, video and text. Not allowed: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? `, and ${bad.length - 5} more` : ''}`);
  const dec = new TextDecoder();
  for (const [name, data] of files) {
    if (/\.html?$/i.test(name) && CSP_META.test(dec.decode(data))) throw new Error(`${name} sets its own Content-Security-Policy: Appverse adds one, so remove that tag`);
  }
}

export function validateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('manifest.json must be an object');
  if (raw.applet !== 1) throw new Error('manifest.applet must be 1 (format version)');

  const id = str(raw, 'id', 64, true);
  if (!ID_RE.test(id)) throw new Error('manifest.id must be 3-64 chars of a-z 0-9 . _ - (e.g. "com.example.notes")');

  const permissions = raw.permissions ?? [];
  if (!Array.isArray(permissions) || permissions.some((p) => !Object.hasOwn(PERMISSIONS, p)))
    throw new Error(`manifest.permissions may only contain: ${Object.keys(PERMISSIONS).join(', ')}`);

  const entry = str(raw, 'entry', 255) || 'index.html';
  if (!/\.html?$/i.test(entry)) throw new Error('manifest.entry must be an HTML file ending in .html (such as "index.html")');

  const dim = (k, def) => {
    const v = raw[k] ?? def;
    if (!Number.isInteger(v) || v < 64 || v > 4096) throw new Error(`manifest.${k} must be an integer 64-4096`);
    return v;
  };

  return {
    applet: 1,
    id,
    title: str(raw, 'title', 80, true),
    author: str(raw, 'author', 80),
    version: str(raw, 'version', 20),
    description: str(raw, 'description', 500),
    license: str(raw, 'license', 120),
    entry,
    width: dim('width', 480),
    height: dim('height', 640),
    permissions: [...new Set(permissions)],
  };
}

/**
 * What a stranger sees first when they open a package's manifest.json in a zip viewer or on a web site: what the file is and
 * how to run it. The packers write these two fields right after "applet"; players ignore them, and they are never required.
 */
export const APPLET_ABOUT = 'An Appverse app (.applet): a small zip holding a web app (HTML, CSS and JavaScript), which runs in a sandbox with no network access. To run it, open https://appverse.lol and drop this file on the home page.';
export const APPLET_PLAY_AT = 'https://appverse.lol/';

/** manifest.json text for a package: "applet", then "about" and "playAt", then the rest of the fields in their order. */
export function appletManifestText(fields) {
  const { applet = 1, about, playAt, ...rest } = fields; // anything stale is replaced
  return JSON.stringify({ applet, about: APPLET_ABOUT, playAt: APPLET_PLAY_AT, ...rest }, null, 2) + '\n';
}
