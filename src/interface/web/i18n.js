/**
 * Terjemahan antarmuka (Indonesia / English) tanpa dependensi.
 * - Teks statis: atribut data-i18n, data-i18n-html (hanya untuk teks bawaan kita sendiri), data-i18n-placeholder,
 *   data-i18n-aria-label.
 * - Teks dinamis: t('kunci', { param }).
 * Bahasa disimpan di localStorage (bila ada); bawaan mengikuti bahasa peramban (id → Indonesia, lainnya → English).
 * Catatan: pesan error yang datang dari server tetap berbahasa Indonesia.
 */
const STORAGE_KEY = 'lumiassist.lang';

const id = {
  'lang.label': 'Bahasa',
  'common.show': 'Lihat', 'common.hide': 'Sembunyikan', 'common.cancel': 'Batal', 'common.close': 'Tutup',
  'common.edit': 'Edit', 'common.delete': 'Hapus', 'common.requestFailed': 'Permintaan gagal',

  // Chat
  'chat.title': 'LumiAssist',
  'chat.tagline': 'Cerdas, ramah, dan sesuai data resmi',
  'chat.admin': 'Admin', 'chat.newChat': 'Percakapan baru',
  'chat.welcome': 'Halo! Apa yang ingin Anda ketahui?',
  'chat.aboutTopic': 'Ceritakan tentang {title}',
  'chat.placeholder': 'Tulis pertanyaan…', 'chat.question': 'Pertanyaan', 'chat.send': 'Kirim',
  'chat.connectionLost': 'Koneksi terputus sebelum jawaban selesai',

  // Admin: umum
  'admin.title': 'LumiAssist Admin',
  'admin.tagline': 'Kelola pengetahuan dan pengaturan asisten',
  'admin.backToChat': '← Chatbot',
  'admin.sessionExpired': 'Sesi berakhir, silakan masuk lagi.',
  'admin.retryIn': '{message} (coba lagi dalam {minutes} menit)',

  // Admin: login & daftar
  'login.title': 'Masuk admin', 'login.username': 'Username', 'login.password': 'Password', 'login.submit': 'Masuk',
  'login.noAccount': 'Belum punya akun?', 'login.register': 'Daftar',
  'reg.title': 'Daftar akun',
  'reg.intro': 'Setelah mendaftar, akun bisa dipakai setelah disetujui oleh admin. Akun yang disetujui dapat melihat dan mengubah knowledge yang sama.',
  'reg.username': 'Username (3–32 karakter: huruf kecil, angka, titik, garis bawah, tanda hubung)',
  'reg.display': 'Nama tampilan (opsional)', 'reg.password': 'Password (minimal 8 karakter)', 'reg.submit': 'Daftar',
  'reg.haveAccount': 'Sudah punya akun?', 'reg.login': 'Masuk',

  // Admin: panel
  'panel.signedInAs': 'Masuk sebagai', 'panel.editProfile': 'Edit profil', 'panel.changePassword': 'Ubah password',
  'panel.manageAdmins': 'Kelola admin', 'panel.logout': 'Keluar', 'panel.add': '+ Tambah knowledge',
  'panel.empty': 'Belum ada knowledge. Klik “Tambah knowledge” atau unggah file .md / .txt.',
  'panel.summary': '{active} aktif dari {total} knowledge',
  'panel.inactive': 'Nonaktif',
  'panel.docMeta': '{chars} karakter · diubah {date}',
  'panel.enableAria': 'Aktifkan {title}',
  'panel.enabledToast': 'Knowledge diaktifkan', 'panel.disabledToast': 'Knowledge dinonaktifkan',
  'panel.deletedToast': 'Knowledge dihapus', 'panel.savedToast': 'Knowledge disimpan',
  'panel.confirmDelete': 'Hapus "{title}"? Tindakan ini tidak bisa dibatalkan.',
  'panel.pending': '{n} menunggu',

  // Admin: pengaturan asisten
  'as.summary': 'Pengaturan asisten', 'as.summaryHint': '— nama, gaya bicara, dan keterangan tentang diri asisten',
  'as.name': 'Nama asisten', 'as.namePh': 'Mis. Lumi dari Lumicore',
  'as.style': 'Gaya bicara (instruksi tambahan)',
  'as.stylePh': 'Mis. Selalu ramah. Sapa pengguna dengan "Kak". Pahami dan jawab dalam bahasa apa pun yang dipakai pengguna.',
  'as.about': 'Tentang asisten (hanya disebut bila pengguna menanyakannya)',
  'as.aboutPh': 'Mis. Anda ditenagai model Qwen3.5-9B yang berjalan di server perusahaan, dan dapat berbahasa Indonesia, Inggris, serta bahasa lain.',
  'as.hint': 'Isian ini mengatur <strong>perilaku</strong> asisten dan berlaku langsung tanpa restart. Informasi layanan atau produk (jam buka, harga, kebijakan) tetap diisi di <strong>Knowledge</strong> di atas, bukan di sini.',
  'as.suggestionsId': 'Saran pertanyaan di layar awal chat — Bahasa Indonesia (satu per baris, maks 6)',
  'as.suggestionsEn': 'Saran pertanyaan di layar awal chat — English (satu per baris, maks 6)',
  'as.suggestionsPhId': 'Kosongkan agar saran dibuat otomatis dari judul knowledge.\nMis. Jam berapa layanan pelanggan buka?',
  'as.suggestionsPhEn': 'Kosongkan agar diterjemahkan otomatis dari kolom Indonesia.\nMis. What time does customer service open?',
  'as.suggestionsHint': 'Pengunjung melihat daftar sesuai bahasa yang dipilihnya (ID/EN). Bila salah satu kosong saat disimpan, otomatis diterjemahkan oleh AI dari kolom yang terisi.',
  'as.generate': 'Buat dengan AI', 'as.generating': 'Membuat saran…',
  'as.generated': 'Saran dari AI sudah diisikan. Periksa, ubah bila perlu, lalu klik Simpan pengaturan.',
  'as.toEn': 'Terjemahkan ke English (AI)', 'as.toId': 'Terjemahkan ke Indonesia (AI)', 'as.translating': 'Menerjemahkan…',
  'as.translated': 'Terjemahan sudah diisikan. Periksa lalu klik Simpan pengaturan.', 'as.nothingToTranslate': 'Isi dulu kolom yang akan diterjemahkan.',
  'as.save': 'Simpan pengaturan', 'as.saved': 'Pengaturan asisten disimpan',
  'as.metaDefault': 'Belum pernah diubah dari halaman ini: memakai nilai bawaan dari konfigurasi server.',
  'as.metaBy': 'Terakhir diubah oleh @{user} pada {date}.',

  // Admin: uji pencarian
  'search.summary': 'Uji pencarian', 'search.hint': '— lihat chunk yang diambil dan skornya (tanpa LLM)',
  'search.ph': 'Tulis pertanyaan uji, mis. berapa lama garansi?', 'search.submit': 'Cari',
  'search.searching': 'Mencari…', 'search.none': 'Tidak ada hasil.',
  'search.info': 'Ambang saat ini (MIN_SCORE): {minScore}. Chunk di bawah ambang tidak dipakai chatbot.',
  'search.hitTitle': '{title} · chunk {chunk}', 'search.hitScore': 'skor {score} · {state}',
  'search.used': 'dipakai', 'search.below': 'di bawah ambang',

  // Admin: editor knowledge
  'ed.add': 'Tambah knowledge', 'ed.edit': 'Edit knowledge', 'ed.title': 'Judul',
  'ed.file': 'Unggah file (PDF, DOCX, PPTX, TXT, MD, CSV — maks 10 MB), atau tulis langsung di kolom Isi',
  'ed.content': 'Isi', 'ed.enabled': 'Aktif (dipakai chatbot)',
  'ed.save': 'Simpan', 'ed.fileTooBig': 'File lebih dari 10 MB.',
  'ed.reading': 'Membaca file…',
  'ed.url': 'Atau ambil dari alamat web (URL)', 'ed.urlPh': 'https://www.perusahaan-anda.co.id/tentang', 'ed.fetch': 'Ambil',
  'ed.crawl': 'Ambil juga halaman lain di situs ini (maks 10 halaman)',
  'ed.urlEmpty': 'Isi alamat web terlebih dahulu.', 'ed.fetching': 'Mengambil halaman…',
  'ed.fetched': 'Teks diambil dari {format} ({chars} karakter). Periksa dan ubah bila perlu sebelum menyimpan.',
  'crawl.title': 'Pilih halaman yang akan disimpan', 'crawl.toggle': 'Pilih semua / kosongkan',
  'crawl.info': '{n} halaman diambil dari {host}. Tiap halaman yang dicentang disimpan sebagai knowledge terpisah.',
  'crawl.chars': '{n} karakter', 'crawl.save': 'Simpan {n} halaman', 'crawl.saving': 'Menyimpan {done}/{total}…',
  'crawl.saved': '{n} knowledge ditambahkan', 'crawl.none': 'Pilih minimal satu halaman.',
  'crawl.skipped': '{n} halaman dilewati (kosong, duplikat, atau gagal diambil).',
  'crawl.partial': 'Penjelajahan dihentikan karena batas waktu; sebagian halaman belum diambil.',
  'crawl.failed': '{n} halaman gagal disimpan: {message}',
  'ed.extracted': 'Teks diambil dari {format} ({detail}{chars} karakter). Periksa dan ubah bila perlu sebelum menyimpan.',
  'ed.pages': '{n} halaman, ', 'ed.slides': '{n} slide, ',

  // Admin: password
  'pw.change': 'Ubah password', 'pw.reset': 'Reset password @{username}',
  'pw.hintChange': 'Minimal 8 karakter. Setelah diganti, perangkat lain yang masih login akan keluar otomatis.',
  'pw.hintReset': 'Minimal 8 karakter. Akun itu akan keluar dari semua perangkat dan harus login dengan password baru.',
  'pw.current': 'Password saat ini', 'pw.new': 'Password baru', 'pw.confirm': 'Ulangi password baru', 'pw.save': 'Simpan password',
  'pw.tooShort': 'Password baru minimal 8 karakter', 'pw.mismatch': 'Konfirmasi password tidak sama',
  'pw.resetToast': 'Password @{username} direset', 'pw.changedToast': 'Password berhasil diubah',

  // Admin: profil
  'pf.titleSelf': 'Edit profil Anda', 'pf.titleOther': 'Edit profil @{username}',
  'pf.display': 'Nama tampilan',
  'pf.username': 'Username (3–32 karakter: huruf kecil, angka, titik, garis bawah, tanda hubung)',
  'pf.note': 'Mengganti username tidak membuat siapa pun keluar dari sesinya; login berikutnya memakai username yang baru.',
  'pf.save': 'Simpan profil', 'pf.saved': 'Profil disimpan',

  // Admin: akun
  'users.title': 'Akun admin', 'users.add': 'Tambah admin', 'users.username': 'Username',
  'users.display': 'Nama tampilan (opsional)', 'users.initialPassword': 'Password awal (minimal 8 karakter)',
  'users.you': 'Anda', 'users.pendingBadge': 'Menunggu persetujuan',
  'users.registeredAt': 'Mendaftar {date}', 'users.lastLogin': 'Login terakhir {date}', 'users.neverLogin': 'Belum pernah login',
  'users.approve': 'Setujui', 'users.reject': 'Tolak', 'users.approved': '@{username} disetujui',
  'users.rejectConfirm': 'Tolak dan hapus pendaftaran "{username}"?', 'users.rejected': 'Pendaftaran ditolak',
  'users.resetPassword': 'Reset password',
  'users.deleteConfirm': 'Hapus akun "{username}"? Akun itu langsung keluar dari semua perangkat.',
  'users.deleted': 'Akun dihapus', 'users.added': 'Admin ditambahkan',
};

const en = {
  'lang.label': 'Language',
  'common.show': 'Show', 'common.hide': 'Hide', 'common.cancel': 'Cancel', 'common.close': 'Close',
  'common.edit': 'Edit', 'common.delete': 'Delete', 'common.requestFailed': 'Request failed',

  'chat.title': 'LumiAssist',
  'chat.tagline': 'Smart, friendly, grounded in official data',
  'chat.admin': 'Admin', 'chat.newChat': 'New chat',
  'chat.welcome': 'Hi! What would you like to know?',
  'chat.aboutTopic': 'Tell me about {title}',
  'chat.placeholder': 'Type your question…', 'chat.question': 'Question', 'chat.send': 'Send',
  'chat.connectionLost': 'Connection lost before the answer finished',

  'admin.title': 'LumiAssist Admin',
  'admin.tagline': 'Manage knowledge and assistant settings',
  'admin.backToChat': '← Chatbot',
  'admin.sessionExpired': 'Your session has expired, please sign in again.',
  'admin.retryIn': '{message} (try again in {minutes} min)',

  'login.title': 'Admin sign in', 'login.username': 'Username', 'login.password': 'Password', 'login.submit': 'Sign in',
  'login.noAccount': "Don't have an account?", 'login.register': 'Sign up',
  'reg.title': 'Create an account',
  'reg.intro': 'After signing up, your account can be used once an admin approves it. Approved accounts can view and edit the same knowledge.',
  'reg.username': 'Username (3–32 characters: lowercase letters, digits, dot, underscore, hyphen)',
  'reg.display': 'Display name (optional)', 'reg.password': 'Password (at least 8 characters)', 'reg.submit': 'Sign up',
  'reg.haveAccount': 'Already have an account?', 'reg.login': 'Sign in',

  'panel.signedInAs': 'Signed in as', 'panel.editProfile': 'Edit profile', 'panel.changePassword': 'Change password',
  'panel.manageAdmins': 'Manage admins', 'panel.logout': 'Sign out', 'panel.add': '+ Add knowledge',
  'panel.empty': 'No knowledge yet. Click “Add knowledge” or upload a .md / .txt file.',
  'panel.summary': '{active} of {total} knowledge active',
  'panel.inactive': 'Inactive',
  'panel.docMeta': '{chars} characters · updated {date}',
  'panel.enableAria': 'Enable {title}',
  'panel.enabledToast': 'Knowledge enabled', 'panel.disabledToast': 'Knowledge disabled',
  'panel.deletedToast': 'Knowledge deleted', 'panel.savedToast': 'Knowledge saved',
  'panel.confirmDelete': 'Delete "{title}"? This cannot be undone.',
  'panel.pending': '{n} pending',

  'as.summary': 'Assistant settings', 'as.summaryHint': '— name, tone of voice, and a short description of the assistant',
  'as.name': 'Assistant name', 'as.namePh': 'E.g. Lumi from Lumicore',
  'as.style': 'Tone of voice (extra instructions)',
  'as.stylePh': 'E.g. Always be friendly. Address users as "Kak". Understand and reply in whatever language the user writes in.',
  'as.about': 'About the assistant (only mentioned if the user asks)',
  'as.aboutPh': 'E.g. You are powered by the Qwen3.5-9B model running on the company server, and you can speak Indonesian, English, and other languages.',
  'as.hint': 'These fields control the assistant’s <strong>behavior</strong> and apply immediately, no restart needed. Service or product information (opening hours, prices, policies) still belongs in <strong>Knowledge</strong> above, not here.',
  'as.suggestionsId': 'Suggested questions on the chat start screen — Bahasa Indonesia (one per line, max 6)',
  'as.suggestionsEn': 'Suggested questions on the chat start screen — English (one per line, max 6)',
  'as.suggestionsPhId': 'Leave empty to generate them automatically from the knowledge titles.\nE.g. Jam berapa layanan pelanggan buka?',
  'as.suggestionsPhEn': 'Leave empty to translate automatically from the Indonesian field.\nE.g. What time does customer service open?',
  'as.suggestionsHint': 'Visitors see the list matching the language they pick (ID/EN). If one is empty when you save, AI translates it from the filled one automatically.',
  'as.generate': 'Generate with AI', 'as.generating': 'Generating suggestions…',
  'as.generated': 'AI suggestions filled in. Review and edit them, then click Save settings.',
  'as.toEn': 'Translate to English (AI)', 'as.toId': 'Translate to Indonesian (AI)', 'as.translating': 'Translating…',
  'as.translated': 'Translation filled in. Review it, then click Save settings.', 'as.nothingToTranslate': 'Fill in the field to translate first.',
  'as.save': 'Save settings', 'as.saved': 'Assistant settings saved',
  'as.metaDefault': 'Never changed from this page: using the defaults from the server configuration.',
  'as.metaBy': 'Last changed by @{user} on {date}.',

  'search.summary': 'Test search', 'search.hint': '— see the retrieved chunks and their scores (no LLM)',
  'search.ph': 'Type a test question, e.g. how long is the warranty?', 'search.submit': 'Search',
  'search.searching': 'Searching…', 'search.none': 'No results.',
  'search.info': 'Current threshold (MIN_SCORE): {minScore}. Chunks below the threshold are not used by the chatbot.',
  'search.hitTitle': '{title} · chunk {chunk}', 'search.hitScore': 'score {score} · {state}',
  'search.used': 'used', 'search.below': 'below threshold',

  'ed.add': 'Add knowledge', 'ed.edit': 'Edit knowledge', 'ed.title': 'Title',
  'ed.file': 'Upload a file (PDF, DOCX, PPTX, TXT, MD, CSV — max 10 MB), or just type in the Content field',
  'ed.content': 'Content', 'ed.enabled': 'Active (used by the chatbot)',
  'ed.save': 'Save', 'ed.fileTooBig': 'File is larger than 10 MB.',
  'ed.reading': 'Reading file…',
  'ed.url': 'Or fetch from a web address (URL)', 'ed.urlPh': 'https://www.your-company.com/about', 'ed.fetch': 'Fetch',
  'ed.crawl': 'Also fetch other pages on this site (up to 10 pages)',
  'ed.urlEmpty': 'Enter a web address first.', 'ed.fetching': 'Fetching page…',
  'ed.fetched': 'Text extracted from {format} ({chars} characters). Review and edit it before saving if needed.',
  'crawl.title': 'Choose the pages to save', 'crawl.toggle': 'Select all / clear',
  'crawl.info': '{n} pages fetched from {host}. Each checked page is saved as a separate knowledge entry.',
  'crawl.chars': '{n} characters', 'crawl.save': 'Save {n} pages', 'crawl.saving': 'Saving {done}/{total}…',
  'crawl.saved': '{n} knowledge entries added', 'crawl.none': 'Select at least one page.',
  'crawl.skipped': '{n} pages skipped (empty, duplicate, or failed to fetch).',
  'crawl.partial': 'Crawling stopped because of the time limit; some pages were not fetched.',
  'crawl.failed': '{n} pages could not be saved: {message}',
  'ed.extracted': 'Text extracted from {format} ({detail}{chars} characters). Review and edit it before saving if needed.',
  'ed.pages': '{n} pages, ', 'ed.slides': '{n} slides, ',

  'pw.change': 'Change password', 'pw.reset': 'Reset password for @{username}',
  'pw.hintChange': 'At least 8 characters. After changing it, other devices that are still signed in will be signed out automatically.',
  'pw.hintReset': 'At least 8 characters. That account will be signed out of all devices and must sign in with the new password.',
  'pw.current': 'Current password', 'pw.new': 'New password', 'pw.confirm': 'Repeat new password', 'pw.save': 'Save password',
  'pw.tooShort': 'New password must be at least 8 characters', 'pw.mismatch': 'Password confirmation does not match',
  'pw.resetToast': 'Password for @{username} was reset', 'pw.changedToast': 'Password changed successfully',

  'pf.titleSelf': 'Edit your profile', 'pf.titleOther': 'Edit profile of @{username}',
  'pf.display': 'Display name',
  'pf.username': 'Username (3–32 characters: lowercase letters, digits, dot, underscore, hyphen)',
  'pf.note': 'Changing the username does not sign anyone out; the next sign-in uses the new username.',
  'pf.save': 'Save profile', 'pf.saved': 'Profile saved',

  'users.title': 'Admin accounts', 'users.add': 'Add admin', 'users.username': 'Username',
  'users.display': 'Display name (optional)', 'users.initialPassword': 'Initial password (at least 8 characters)',
  'users.you': 'You', 'users.pendingBadge': 'Awaiting approval',
  'users.registeredAt': 'Signed up {date}', 'users.lastLogin': 'Last sign-in {date}', 'users.neverLogin': 'Never signed in',
  'users.approve': 'Approve', 'users.reject': 'Reject', 'users.approved': '@{username} approved',
  'users.rejectConfirm': 'Reject and delete the sign-up of "{username}"?', 'users.rejected': 'Sign-up rejected',
  'users.resetPassword': 'Reset password',
  'users.deleteConfirm': 'Delete account "{username}"? It is signed out of all devices immediately.',
  'users.deleted': 'Account deleted', 'users.added': 'Admin added',
};

export const dictionaries = { id, en };
const LOCALES = { id: 'id-ID', en: 'en-US' };
const listeners = new Set();

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved in dictionaries) return saved;
  } catch { /* penyimpanan tidak tersedia: lanjut ke bahasa peramban */ }
  return String(globalThis.navigator?.language ?? 'id').toLowerCase().startsWith('id') ? 'id' : 'en';
}

let current = detect();

export const language = () => current;
export const locale = () => LOCALES[current];

/** Terjemahan untuk `key` dengan parameter {nama}; jatuh ke bahasa Indonesia, lalu ke kuncinya sendiri. */
export function t(key, params = {}) {
  const template = dictionaries[current][key] ?? dictionaries.id[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}

/** Menerapkan terjemahan ke semua elemen bertanda data-i18n* di dalam `root`. */
export function applyTranslations(root = document) {
  document.documentElement.lang = current;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml); // hanya teks bawaan kita
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  const titleKey = document.documentElement.dataset.titleKey;
  if (titleKey) document.title = t(titleKey);
  for (const b of root.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === current));
}

export function setLanguage(lang) {
  if (!(lang in dictionaries) || lang === current) return;
  current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* tidak apa-apa: berlaku untuk sesi ini */ }
  applyTranslations();
  for (const listener of listeners) listener(lang);
}

/** Dipanggil bila bahasa diganti, agar bagian yang dibuat lewat JavaScript bisa digambar ulang. */
export const onLanguageChange = (listener) => { listeners.add(listener); };

/** Menerapkan terjemahan awal dan menghubungkan tombol [data-lang]. */
export function initI18n() {
  applyTranslations();
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-lang]');
    if (button) setLanguage(button.dataset.lang);
  });
}
