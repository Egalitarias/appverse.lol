const text = document.getElementById('text');
const status = document.getElementById('status');
let timer;

appverse.storage.get('note').then((saved) => {
  text.value = saved ?? '';
  status.textContent = saved === null ? 'New note' : 'Loaded';
});

text.addEventListener('input', () => {
  status.textContent = 'Saving...';
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await appverse.storage.set('note', text.value);
    status.textContent = 'Saved';
  }, 400);
});

document.getElementById('copy').addEventListener('click', async () => {
  await appverse.copyText(text.value);
  status.textContent = 'Copied';
});
