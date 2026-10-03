import { createAdminApi } from './admin-api.js';

const $ = (id) => document.getElementById(id);
const MAX_FILE = 1_000_000;
let me = null;
let editingId = null;
let passwordTarget = null; // null = ubah password sendiri; {id, username} = reset password akun lain
const api = createAdminApi();

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2500);
}

function showLogin(message = '') {
  me = null;
  $('panel').hidden = true;
  $('register').hidden = true;
  $('login').hidden = false;
  $('loginError').textContent = message;
  $('loginUser').focus();
}

function showPanel(user) {
  me = user;
  $('login').hidden = true;
  $('register').hidden = true;
  $('panel').hidden = false;
  $('whoName').textContent = user.displayName;
  $('whoHandle').textContent = `@${user.username}`;
  $('avatar').textContent = user.displayName.trim().charAt(0).toUpperCase() || '?';
}

const sessionExpired = () => showLogin('Sesi berakhir, silakan masuk lagi.');

async function refresh() {
  try {
    render(await api.list());
    loadAssistant();
    updatePendingCount();
  } catch (err) {
    if (err.status === 401) sessionExpired();
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
    if (err.status === 401) return sessionExpired();
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

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginBtn').disabled = true;
  $('loginError').textContent = '';
  try {
    const user = await api.login($('loginUser').value, $('loginPass').value);
    $('loginPass').value = '';
    showPanel(user);
    await refresh();
  } catch (err) {
    $('loginError').textContent = err.status === 429
      ? `${err.message} (coba lagi dalam ${Math.max(1, Math.ceil(err.retryAfter / 60))} menit)`
      : err.message;
    $('loginPass').select();
  } finally {
    $('loginBtn').disabled = false;
  }
});

$('showRegister').addEventListener('click', () => {
  $('login').hidden = true;
  $('register').hidden = false;
  $('regError').textContent = '';
  $('regOk').textContent = '';
  $('regUser').focus();
});
$('showLogin').addEventListener('click', () => showLogin());

$('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('regBtn').disabled = true;
  $('regError').textContent = '';
  $('regOk').textContent = '';
  try {
    const result = await api.register({ username: $('regUser').value, displayName: $('regDisplay').value, password: $('regPass').value });
    $('registerForm').reset();
    $('regOk').textContent = result.message;
  } catch (err) {
    $('regError').textContent = err.status === 429
      ? `${err.message} (coba lagi dalam ${Math.max(1, Math.ceil(err.retryAfter / 60))} menit)`
      : err.message;
  } finally {
    $('regBtn').disabled = false;
  }
});

$('logout').addEventListener('click', async () => {
  await api.logout().catch(() => {});
  showLogin();
});

// Tombol "Lihat/Sembunyikan" password
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) {
    const input = $(toggle.dataset.toggle);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Sembunyikan' : 'Lihat';
    return;
  }
  const close = e.target.closest('[data-close]');
  if (close) $(close.dataset.close).close();
});

// ---------- Ubah / reset password ----------
function openPasswordDialog(target = null) {
  passwordTarget = target;
  $('passwordForm').reset();
  $('pwError').textContent = '';
  const isReset = Boolean(target);
  $('pwTitle').textContent = isReset ? `Reset password @${target.username}` : 'Ubah password';
  $('pwHint').textContent = isReset
    ? 'Minimal 8 karakter. Akun itu akan keluar dari semua perangkat dan harus login dengan password baru.'
    : 'Minimal 8 karakter. Setelah diganti, perangkat lain yang masih login akan keluar otomatis.';
  $('pwCurrentRow').hidden = isReset;
  $('pwCurrent').required = !isReset;
  for (const id of ['pwCurrent', 'pwNew', 'pwConfirm']) { $(id).type = 'password'; }
  document.querySelectorAll('#passwordForm [data-toggle]').forEach((b) => { b.textContent = 'Lihat'; });
  $('passwordDialog').showModal();
  (isReset ? $('pwNew') : $('pwCurrent')).focus();
}

$('openPassword').addEventListener('click', () => openPasswordDialog());

$('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const next = $('pwNew').value;
  if (next.length < 8) return void ($('pwError').textContent = 'Password baru minimal 8 karakter');
  if (next !== $('pwConfirm').value) return void ($('pwError').textContent = 'Konfirmasi password tidak sama');
  $('pwSave').disabled = true;
  try {
    if (passwordTarget) await api.resetPassword(passwordTarget.id, next);
    else await api.changePassword($('pwCurrent').value, next);
    $('passwordDialog').close();
    toast(passwordTarget ? `Password @${passwordTarget.username} direset` : 'Password berhasil diubah');
  } catch (err) {
    if (err.status === 401) { $('passwordDialog').close(); sessionExpired(); }
    else $('pwError').textContent = err.message;
  } finally {
    $('pwSave').disabled = false;
  }
});

// ---------- Kelola akun admin ----------
async function updatePendingCount() {
  try {
    const waiting = (await api.users()).filter((u) => u.status === 'pending').length;
    $('pendingCount').hidden = waiting === 0;
    $('pendingCount').textContent = `${waiting} menunggu`;
  } catch { /* lencana hanya pelengkap */ }
}

async function renderUsers() {
  const items = (await api.users()).sort((a, b) => (b.status === 'pending') - (a.status === 'pending'));
  $('userList').replaceChildren(...items.map((u) => {
    const li = document.createElement('li');
    li.className = 'item';
    const info = document.createElement('div');
    info.className = 'info';
    const h = document.createElement('h3');
    h.textContent = u.displayName;
    const handle = document.createElement('span');
    handle.className = 'muted';
    handle.textContent = ` @${u.username}`;
    h.append(handle);
    if (u.id === me.id) {
      const badge = document.createElement('span');
      badge.className = 'badge me';
      badge.textContent = 'Anda';
      h.append(badge);
    }
    const pending = u.status === 'pending';
    if (pending) {
      const badge = document.createElement('span');
      badge.className = 'badge pending';
      badge.textContent = 'Menunggu persetujuan';
      h.append(badge);
    }
    const meta = document.createElement('p');
    meta.textContent = pending
      ? `Mendaftar ${new Date(u.createdAt).toLocaleString('id-ID')}`
      : (u.lastLoginAt ? `Login terakhir ${new Date(u.lastLoginAt).toLocaleString('id-ID')}` : 'Belum pernah login');
    info.append(h, meta);
    const controls = document.createElement('div');
    controls.className = 'controls';
    const failed = (err) => { if (err.status === 401) { $('usersDialog').close(); sessionExpired(); } else toast(err.message); };
    if (pending) {
      controls.append(
        button('Setujui', 'primary', async () => {
          try { await api.approveUser(u.id); toast(`@${u.username} disetujui`); await renderUsers(); updatePendingCount(); } catch (err) { failed(err); }
        }),
        button('Tolak', 'ghost danger', async () => {
          if (!confirm(`Tolak dan hapus pendaftaran "${u.username}"?`)) return;
          try { await api.removeUser(u.id); toast('Pendaftaran ditolak'); await renderUsers(); updatePendingCount(); } catch (err) { failed(err); }
        }),
      );
    } else if (u.id !== me.id) {
      controls.append(
        button('Reset password', 'ghost', () => openPasswordDialog({ id: u.id, username: u.username })),
        button('Hapus', 'ghost danger', async () => {
          if (!confirm(`Hapus akun "${u.username}"? Akun itu langsung keluar dari semua perangkat.`)) return;
          try { await api.removeUser(u.id); toast('Akun dihapus'); await renderUsers(); } catch (err) { failed(err); }
        }),
      );
    }
    li.append(info, controls);
    return li;
  }));
}

$('openUsers').addEventListener('click', async () => {
  $('userForm').reset();
  $('userError').textContent = '';
  try { await renderUsers(); } catch (err) { return err.status === 401 ? sessionExpired() : toast(err.message); }
  $('usersDialog').showModal();
});

$('userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('userSave').disabled = true;
  $('userError').textContent = '';
  try {
    await api.createUser({ username: $('newUsername').value, displayName: $('newDisplay').value, password: $('newPassword').value });
    $('userForm').reset();
    toast('Admin ditambahkan');
    await renderUsers();
  } catch (err) {
    if (err.status === 401) { $('usersDialog').close(); sessionExpired(); }
    else $('userError').textContent = err.message;
  } finally {
    $('userSave').disabled = false;
  }
});

$('add').addEventListener('click', () => openEditor());
// ---------- Pengaturan asisten ----------
async function loadAssistant() {
  try {
    const a = await api.assistant();
    $('asName').value = a.name;
    $('asStyle').value = a.style;
    $('asAbout').value = a.about;
    $('asMeta').textContent = a.isDefault
      ? 'Belum pernah diubah dari halaman ini: memakai nilai bawaan dari konfigurasi server.'
      : `Terakhir diubah oleh @${a.updatedBy} pada ${new Date(a.updatedAt).toLocaleString('id-ID')}.`;
  } catch (err) {
    if (err.status === 401) sessionExpired();
  }
}

$('assistantForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('asSave').disabled = true;
  $('asError').textContent = '';
  try {
    await api.saveAssistant({ name: $('asName').value, style: $('asStyle').value, about: $('asAbout').value });
    toast('Pengaturan asisten disimpan');
    await loadAssistant();
  } catch (err) {
    if (err.status === 401) sessionExpired();
    else $('asError').textContent = err.message;
  } finally {
    $('asSave').disabled = false;
  }
});

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
    if (err.status === 401) return sessionExpired();
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
    if (err.status === 401) { $('editor').close(); sessionExpired(); }
    else $('editorError').textContent = err.message;
  } finally {
    $('save').disabled = false;
  }
});

// Mulai: cek apakah masih ada sesi (cookie), bila tidak tampilkan form login.
api.me()
  .then(async (user) => { showPanel(user); await refresh(); })
  .catch(() => showLogin());
