import { createAdminApi } from './admin-api.js';

const $ = (id) => document.getElementById(id);
const MAX_FILE = 1_000_000;
const storage = {
  get: () => { try { return sessionStorage.getItem('adminToken') ?? ''; } catch { return ''; } },
  set: (v) => { try { v ? sessionStorage.setItem('adminToken', v) : sessionStorage.removeItem('adminToken'); } catch { /* abaikan */ } },
};
let token = storage.get();
let editingId = null;
const api = createAdminApi(() => token);

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2500);
}

function showLogin(message = '') {
  token = '';
  storage.set('');
  $('panel').hidden = true;
  $('logout').hidden = true;
  $('login').hidden = false;
  $('loginError').textContent = message;
  $('token').focus();
}

async function refresh() {
  try {
    const items = await api.list();
    $('login').hidden = true;
    $('panel').hidden = false;
    $('logout').hidden = false;
    render(items);
  } catch (err) {
    if (err.status === 401) showLogin(token ? 'Token salah.' : '');
    else toast(err.message);
  }
}

function render(items) {
  const active = items.filter((i) => i.enabled).length;
  $('summary').textContent = `${active} aktif dari ${items.length} knowledge`;
  $('empty').hidden = items.length > 0;
  const list = $('list');
  list.replaceChildren(...items.map(renderItem));
}

function renderItem(doc) {
  const li = document.createElement('li');
  li.className = `item${doc.enabled ? '' : ' off'}`;

  const info = document.createElement('div');
  info.className = 'info';
  const h = document.createElement('h3');
  h.textContent = doc.title;
  if (!doc.enabled) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'Nonaktif';
    h.append(badge);
  }
  const meta = document.createElement('p');
  meta.textContent = `${doc.chars.toLocaleString('id-ID')} karakter · diubah ${new Date(doc.updatedAt).toLocaleString('id-ID')}`;
  info.append(h, meta);

  const controls = document.createElement('div');
  controls.className = 'controls';

  const sw = document.createElement('label');
  sw.className = 'switch';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.setAttribute('role', 'switch');
  cb.checked = doc.enabled;
  cb.setAttribute('aria-label', `Aktifkan ${doc.title}`);
  cb.addEventListener('change', () => run(() => api.update(doc.id, { enabled: cb.checked }), cb.checked ? 'Knowledge diaktifkan' : 'Knowledge dinonaktifkan'));
  sw.append(cb, document.createElement('span'));

  const edit = button('Edit', 'ghost', () => openEditor(doc.id));
  const del = button('Hapus', 'ghost danger', () => {
    if (confirm(`Hapus "${doc.title}"? Tindakan ini tidak bisa dibatalkan.`)) run(() => api.remove(doc.id), 'Knowledge dihapus');
  });
  controls.append(sw, edit, del);

  li.append(info, controls);
  return li;
}

function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

async function run(action, successMessage) {
  try {
    await action();
    toast(successMessage);
  } catch (err) {
    if (err.status === 401) return showLogin('Sesi berakhir, masuk lagi.');
    toast(err.message);
  }
  await refresh();
}

async function openEditor(id = null) {
  editingId = id;
  $('editorError').textContent = '';
  $('docFile').value = '';
  $('editorTitle').textContent = id ? 'Edit knowledge' : 'Tambah knowledge';
  if (id) {
    try {
      const doc = await api.get(id);
      $('docTitle').value = doc.title;
      $('docContent').value = doc.content;
      $('docEnabled').checked = doc.enabled;
    } catch (err) {
      return toast(err.message);
    }
  } else {
    $('docTitle').value = '';
    $('docContent').value = '';
    $('docEnabled').checked = true;
  }
  $('editor').showModal();
  $('docTitle').focus();
}

$('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  token = $('token').value.trim();
  storage.set(token);
  $('token').value = '';
  refresh();
});
$('logout').addEventListener('click', () => showLogin());
$('add').addEventListener('click', () => openEditor());
$('searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const info = $('searchInfo');
  info.textContent = 'Mencari…';
  try {
    const { hits, minScore } = await api.search($('searchQuery').value);
    info.textContent = hits.length
      ? `Ambang saat ini (MIN_SCORE): ${minScore}. Chunk di bawah ambang tidak dipakai chatbot.`
      : 'Tidak ada hasil.';
    $('searchResults').replaceChildren(...hits.map(renderHit));
  } catch (err) {
    if (err.status === 401) return showLogin('Sesi berakhir, masuk lagi.');
    info.textContent = err.message;
    $('searchResults').replaceChildren();
  }
});

function renderHit(hit) {
  const li = document.createElement('li');
  li.className = `hit${hit.aboveThreshold ? '' : ' below'}`;
  const head = document.createElement('div');
  head.className = 'hit-head';
  const title = document.createElement('strong');
  title.textContent = `${hit.title} · chunk ${hit.chunk}`;
  const score = document.createElement('span');
  score.className = 'badge';
  score.textContent = `skor ${hit.score} · ${hit.aboveThreshold ? 'dipakai' : 'di bawah ambang'}`;
  head.append(title, score);
  const text = document.createElement('p');
  text.textContent = hit.text.length > 240 ? `${hit.text.slice(0, 240)}…` : hit.text;
  li.append(head, text);
  return li;
}

$('cancel').addEventListener('click', () => $('editor').close());

$('docFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > MAX_FILE) {
    e.target.value = '';
    $('editorError').textContent = 'File lebih dari 1 MB.';
    return;
  }
  $('editorError').textContent = '';
  const text = await file.text();
  $('docContent').value = text;
  if (!$('docTitle').value.trim()) {
    $('docTitle').value = text.match(/^#\s+(.+)$/m)?.[1] ?? file.name.replace(/\.[^.]+$/, '');
  }
});

$('editorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = { title: $('docTitle').value, content: $('docContent').value, enabled: $('docEnabled').checked };
  $('save').disabled = true;
  try {
    await (editingId ? api.update(editingId, data) : api.create(data));
    $('editor').close();
    toast('Knowledge disimpan');
    await refresh();
  } catch (err) {
    if (err.status === 401) { $('editor').close(); showLogin('Sesi berakhir, masuk lagi.'); }
    else $('editorError').textContent = err.message;
  } finally {
    $('save').disabled = false;
  }
});

if (token) refresh(); else showLogin();
