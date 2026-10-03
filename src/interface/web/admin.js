import { createAdminApi } from './admin-api.js';
import { applyTranslations, initI18n, locale, onLanguageChange, t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const MAX_FILE = 10 * 1024 * 1024;
let me = null;
let editingId = null;
let lastItems = [];
let lastAssistant = null;
let passwordTarget = null; // null = ubah password sendiri; {id, username} = reset password akun lain
const api = createAdminApi();
const fmt = (iso) => new Date(iso).toLocaleString(locale());
const retryMessage = (err) => (err.status === 429
  ? t('admin.retryIn', { message: err.message, minutes: Math.max(1, Math.ceil(err.retryAfter / 60)) })
  : err.message);

initI18n();

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

const sessionExpired = () => showLogin(t('admin.sessionExpired'));

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
  lastItems = items;
  const active = items.filter((i) => i.enabled).length;
  $('summary').textContent = t('panel.summary', { active, total: items.length });
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
    badge.textContent = t('panel.inactive');
    h.append(badge);
  }
  const meta = document.createElement('p');
  meta.textContent = t('panel.docMeta', { chars: doc.chars.toLocaleString(locale()), date: fmt(doc.updatedAt) });
  info.append(h, meta);

  const controls = document.createElement('div');
  controls.className = 'controls';

  const sw = document.createElement('label');
  sw.className = 'switch';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.setAttribute('role', 'switch');
  cb.checked = doc.enabled;
  cb.setAttribute('aria-label', t('panel.enableAria', { title: doc.title }));
  cb.addEventListener('change', () => run(() => api.update(doc.id, { enabled: cb.checked }), cb.checked ? t('panel.enabledToast') : t('panel.disabledToast')));
  sw.append(cb, document.createElement('span'));

  const edit = button(t('common.edit'), 'ghost', () => openEditor(doc.id));
  const del = button(t('common.delete'), 'ghost danger', () => {
    if (confirm(t('panel.confirmDelete', { title: doc.title }))) run(() => api.remove(doc.id), t('panel.deletedToast'));
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
  $('fileInfo').textContent = '';
  $('editorTitle').textContent = id ? t('ed.edit') : t('ed.add');
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
    $('loginError').textContent = retryMessage(err);
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
    $('regError').textContent = retryMessage(err);
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
    toggle.textContent = show ? t('common.hide') : t('common.show');
    return;
  }
  const close = e.target.closest('[data-close]');
  if (close) $(close.dataset.close).close();
});

// ---------- Ubah / reset password ----------
function openPasswordDialogLabels() {
  const isReset = Boolean(passwordTarget);
  $('pwTitle').textContent = isReset ? t('pw.reset', { username: passwordTarget.username }) : t('pw.change');
  $('pwHint').textContent = isReset ? t('pw.hintReset') : t('pw.hintChange');
}

function openPasswordDialog(target = null) {
  passwordTarget = target;
  $('passwordForm').reset();
  $('pwError').textContent = '';
  const isReset = Boolean(target);
  $('pwTitle').textContent = isReset ? t('pw.reset', { username: target.username }) : t('pw.change');
  $('pwHint').textContent = isReset ? t('pw.hintReset') : t('pw.hintChange');
  $('pwCurrentRow').hidden = isReset;
  $('pwCurrent').required = !isReset;
  for (const id of ['pwCurrent', 'pwNew', 'pwConfirm']) { $(id).type = 'password'; }
  document.querySelectorAll('#passwordForm [data-toggle]').forEach((b) => { b.textContent = t('common.show'); });
  $('passwordDialog').showModal();
  (isReset ? $('pwNew') : $('pwCurrent')).focus();
}

$('openPassword').addEventListener('click', () => openPasswordDialog());

// ---------- Edit profil ----------
let profileTarget = null;
function openProfileDialog(target) {
  profileTarget = target;
  $('pfTitle').textContent = target.id === me.id ? t('pf.titleSelf') : t('pf.titleOther', { username: target.username });
  $('pfDisplay').value = target.displayName;
  $('pfUsername').value = target.username;
  $('pfError').textContent = '';
  $('profileDialog').showModal();
  $('pfDisplay').focus();
}

$('openProfile').addEventListener('click', () => openProfileDialog(me));

$('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('pfSave').disabled = true;
  $('pfError').textContent = '';
  try {
    const updated = await api.updateUser(profileTarget.id, { displayName: $('pfDisplay').value, username: $('pfUsername').value });
    $('profileDialog').close();
    if (updated.id === me.id) showPanel(updated);
    toast(t('pf.saved'));
    if ($('usersDialog').open) await renderUsers();
  } catch (err) {
    if (err.status === 401) { $('profileDialog').close(); $('usersDialog').close(); sessionExpired(); }
    else $('pfError').textContent = err.message;
  } finally {
    $('pfSave').disabled = false;
  }
});

$('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const next = $('pwNew').value;
  if (next.length < 8) return void ($('pwError').textContent = t('pw.tooShort'));
  if (next !== $('pwConfirm').value) return void ($('pwError').textContent = t('pw.mismatch'));
  $('pwSave').disabled = true;
  try {
    if (passwordTarget) await api.resetPassword(passwordTarget.id, next);
    else await api.changePassword($('pwCurrent').value, next);
    $('passwordDialog').close();
    toast(passwordTarget ? t('pw.resetToast', { username: passwordTarget.username }) : t('pw.changedToast'));
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
    $('pendingCount').textContent = t('panel.pending', { n: waiting });
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
      badge.textContent = t('users.you');
      h.append(badge);
    }
    const pending = u.status === 'pending';
    if (pending) {
      const badge = document.createElement('span');
      badge.className = 'badge pending';
      badge.textContent = t('users.pendingBadge');
      h.append(badge);
    }
    const meta = document.createElement('p');
    meta.textContent = pending
      ? t('users.registeredAt', { date: fmt(u.createdAt) })
      : (u.lastLoginAt ? t('users.lastLogin', { date: fmt(u.lastLoginAt) }) : t('users.neverLogin'));
    info.append(h, meta);
    const controls = document.createElement('div');
    controls.className = 'controls';
    const failed = (err) => { if (err.status === 401) { $('usersDialog').close(); sessionExpired(); } else toast(err.message); };
    if (pending) {
      controls.append(
        button(t('users.approve'), 'primary', async () => {
          try { await api.approveUser(u.id); toast(t('users.approved', { username: u.username })); await renderUsers(); updatePendingCount(); } catch (err) { failed(err); }
        }),
        button(t('users.reject'), 'ghost danger', async () => {
          if (!confirm(t('users.rejectConfirm', { username: u.username }))) return;
          try { await api.removeUser(u.id); toast(t('users.rejected')); await renderUsers(); updatePendingCount(); } catch (err) { failed(err); }
        }),
      );
    } else {
      controls.append(button(t('common.edit'), 'ghost', () => openProfileDialog(u)));
    }
    if (!pending && u.id !== me.id) {
      controls.append(
        button(t('users.resetPassword'), 'ghost', () => openPasswordDialog({ id: u.id, username: u.username })),
        button(t('common.delete'), 'ghost danger', async () => {
          if (!confirm(t('users.deleteConfirm', { username: u.username }))) return;
          try { await api.removeUser(u.id); toast(t('users.deleted')); await renderUsers(); } catch (err) { failed(err); }
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
    toast(t('users.added'));
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
function renderAssistantMeta() {
  const a = lastAssistant;
  if (!a) return;
  $('asMeta').textContent = a.isDefault ? t('as.metaDefault') : t('as.metaBy', { user: a.updatedBy, date: fmt(a.updatedAt) });
}

async function loadAssistant() {
  try {
    const a = await api.assistant();
    $('asName').value = a.name;
    $('asStyle').value = a.style;
    $('asAbout').value = a.about;
    lastAssistant = a;
    renderAssistantMeta();
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
    toast(t('as.saved'));
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
  info.textContent = t('search.searching');
  try {
    const { hits, minScore } = await api.search($('searchQuery').value);
    info.textContent = hits.length
      ? t('search.info', { minScore })
      : t('search.none');
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
  title.textContent = t('search.hitTitle', { title: hit.title, chunk: hit.chunk });
  const score = document.createElement('span');
  score.className = 'badge';
  score.textContent = t('search.hitScore', { score: hit.score, state: hit.aboveThreshold ? t('search.used') : t('search.below') });
  head.append(title, score);
  const text = document.createElement('p');
  text.textContent = hit.text.length > 240 ? `${hit.text.slice(0, 240)}…` : hit.text;
  li.append(head, text);
  return li;
}

$('cancel').addEventListener('click', () => $('editor').close());

$('docFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  $('editorError').textContent = '';
  $('fileInfo').textContent = '';
  if (!file) return;
  if (file.size > MAX_FILE) {
    e.target.value = '';
    $('editorError').textContent = t('ed.fileTooBig');
    return;
  }
  $('fileInfo').textContent = t('ed.reading');
  $('save').disabled = true;
  try {
    const doc = await api.extract(file);
    $('docContent').value = doc.content;
    if (!$('docTitle').value.trim()) $('docTitle').value = doc.title;
    const detail = doc.pages ? t('ed.pages', { n: doc.pages }) : doc.slides ? t('ed.slides', { n: doc.slides }) : '';
    $('fileInfo').textContent = t('ed.extracted', { format: doc.format, detail, chars: doc.chars.toLocaleString(locale()) });
  } catch (err) {
    $('fileInfo').textContent = '';
    e.target.value = '';
    if (err.status === 401) { $('editor').close(); sessionExpired(); } else $('editorError').textContent = err.message;
  } finally {
    $('save').disabled = false;
  }
});

$('editorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = { title: $('docTitle').value, content: $('docContent').value, enabled: $('docEnabled').checked };
  $('save').disabled = true;
  try {
    await (editingId ? api.update(editingId, data) : api.create(data));
    $('editor').close();
    toast(t('panel.savedToast'));
    await refresh();
  } catch (err) {
    if (err.status === 401) { $('editor').close(); sessionExpired(); }
    else $('editorError').textContent = err.message;
  } finally {
    $('save').disabled = false;
  }
});

// Ganti bahasa: gambar ulang bagian yang dibuat lewat JavaScript (daftar, lencana, judul dialog yang sedang terbuka).
onLanguageChange(async () => {
  document.querySelectorAll('[data-toggle]').forEach((b) => { $(b.dataset.toggle).type = 'password'; });
  if (!me) return;
  applyTranslations();
  render(lastItems); // tanpa memuat ulang dari server agar isian pengaturan yang belum disimpan tidak tertimpa
  renderAssistantMeta();
  updatePendingCount();
  if ($('usersDialog').open) await renderUsers().catch(() => {});
  if ($('editor').open) $('editorTitle').textContent = editingId ? t('ed.edit') : t('ed.add');
  if ($('passwordDialog').open) openPasswordDialogLabels();
  if ($('profileDialog').open && profileTarget) $('pfTitle').textContent = profileTarget.id === me.id ? t('pf.titleSelf') : t('pf.titleOther', { username: profileTarget.username });
});

// Mulai: cek apakah masih ada sesi (cookie), bila tidak tampilkan form login.
api.me()
  .then(async (user) => { showPanel(user); await refresh(); })
  .catch(() => showLogin());
