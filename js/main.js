import { readZip, sha256Hex } from './zip.js';
import { validateManifest, assertAppletPackage, PERMISSIONS } from './manifest.js';
import { runApplet } from './sandbox.js';

const $ = (id) => document.getElementById(id);
const hero = $('hero'), drop = $('drop'), fileInput = $('file'), errorBox = $('error'), card = $('card'), stage = $('stage');

let pending = null; // { manifest, files }
let running = null;

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = !msg;
}

function reset() {
  running?.stop();
  running = pending = null;
  card.hidden = stage.hidden = true;
  hero.hidden = drop.hidden = false;
}

const li = (textContent) => Object.assign(document.createElement('li'), { textContent });

async function loadFile(file) {
  showError('');
  reset();
  try {
    if (!file.name.toLowerCase().endsWith('.applet')) throw new Error('Please choose an .applet file');
    const buf = await file.arrayBuffer();
    const files = await readZip(buf);
    const mjson = files.get('manifest.json');
    if (!mjson) throw new Error('Package has no manifest.json');
    let raw;
    try { raw = JSON.parse(new TextDecoder().decode(mjson)); } catch { throw new Error('manifest.json is not valid JSON'); }
    const manifest = validateManifest(raw);
    assertAppletPackage(manifest, files);

    const hash = await sha256Hex(buf);
    pending = { manifest, files, hash };
    $('c-title').textContent = manifest.title;
    $('c-meta').textContent = [manifest.author && `by ${manifest.author}`, manifest.version && `v${manifest.version}`,
      `${files.size} files, ${(buf.byteLength / 1024).toFixed(1)} KB`].filter(Boolean).join(' · ');
    $('c-desc').textContent = manifest.description;
    $('c-license').textContent = `License: ${manifest.license || 'not specified'}`;
    $('c-perms').replaceChildren(...(manifest.permissions.length
      ? manifest.permissions.map((p) => li(PERMISSIONS[p]))
      : [li('Nothing special: just run, with no network and no saving.')]));
    $('c-hash').textContent = hash;
    hero.hidden = drop.hidden = true;
    card.hidden = false;
  } catch (err) {
    showError(err.message || String(err));
  }
}

$('run').onclick = () => {
  if (!pending) return;
  const { manifest, files, hash } = pending;
  try {
    card.hidden = true;
    stage.hidden = false;
    $('s-title').textContent = manifest.title;
    running = runApplet(manifest, files, $('screen'), { hash });
    $('full').hidden = !running.canFullscreen;
  } catch (err) {
    reset();
    showError(err.message || String(err));
  }
};
$('cancel').onclick = reset;
$('stop').onclick = reset;
$('full').onclick = () => running?.fullscreen();

drop.onclick = () => fileInput.click();
drop.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileInput.click());
fileInput.onchange = () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); fileInput.value = ''; };
for (const ev of ['dragenter', 'dragover']) addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) loadFile(f); });
