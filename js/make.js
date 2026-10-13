import { downloadBundle } from './downloads.js';

const note = document.getElementById('dl-note');

for (const btn of document.querySelectorAll('[data-bundle]')) {
  btn.addEventListener('click', async () => {
    note.hidden = true;
    btn.disabled = true;
    try {
      await downloadBundle(btn.dataset.bundle);
    } catch (e) {
      note.textContent = 'Download failed: ' + (e.message || e);
      note.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
}
