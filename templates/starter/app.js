// Everything runs in a sandbox with no network. appverse.storage keeps small values on this device (it needs the
// "storage" permission in manifest.json); the browser's own storage APIs do not work here.
const count = document.getElementById('count');
const status = document.getElementById('status');
let n = 0;

function show() {
  count.textContent = n;
}

async function save() {
  await appverse.storage.set('count', String(n));
  status.textContent = 'Saved';
}

appverse.storage.get('count').then((saved) => {
  n = Number(saved) || 0;
  show();
});

document.getElementById('add').onclick = () => { n++; show(); save(); };
document.getElementById('reset').onclick = () => { n = 0; show(); save(); };
