# RAG-project

Chatbot Retrieval-Augmented Generation (RAG) dengan antarmuka web dan **halaman admin** untuk mengelola knowledge, dibangun dengan **Clean Architecture**. Bisa berjalan 100% lokal: **PostgreSQL (+ pgvector)** untuk penyimpanan dan pencarian semantik, serta **LLM lokal** (vLLM; server lain berprotokol OpenAI juga bisa) tanpa API berbayar.

## Menjalankan

Tanpa konfigurasi apa pun (mode paling sederhana: file JSON + TF-IDF + jawaban ekstraktif):

```bash
npm install
ADMIN_USERNAME=admin ADMIN_PASSWORD=pilih-sendiri npm start     # http://localhost:3000
npm test
```

- Chat: `http://localhost:3000` — jawaban muncul **bertahap** (streaming)
- Admin: `http://localhost:3000/admin.html` — login dengan **username + password** (lihat [Akun admin](#akun-admin))

### Dengan Docker

```bash
cp .env.example .env     # lalu isi/aktifkan variabel yang dibutuhkan
docker compose --env-file .env up --build
```

PowerShell tanpa `.env`: `$env:ADMIN_PASSWORD="pilih-sendiri"; docker compose up --build`.

### Di server dengan PostgreSQL/LLM yang hanya terbuka di loopback

Bila PostgreSQL dan LLM di server itu dipublikasikan hanya ke `127.0.0.1` (mis. `-p 127.0.0.1:5434:5432` dan `-p 127.0.0.1:8100:8000`), kontainer lain **tidak bisa** menjangkaunya: port loopback host tidak terlihat dari jaringan bridge, dan pada jaringan bridge bawaan nama kontainer tidak bisa di-resolve. Pakai `docker-compose.server.yml`, yang menjalankan aplikasi dengan `network_mode: host` sehingga alamatnya cukup `127.0.0.1`:

```bash
# .env
DATABASE_URL=postgres://rag_app:PASSWORD@127.0.0.1:5434/rag
LLM_BASE_URL=http://127.0.0.1:8100/v1

docker compose -f docker-compose.server.yml up -d --build
docker compose -f docker-compose.server.yml logs -f rag
```

Aplikasi mendengarkan langsung di port host (`PORT`, bawaan 3000) pada semua antarmuka. Batasi dengan firewall, atau set `HOST=127.0.0.1` dan akses lewat reverse proxy / SSH tunnel (`ssh -L 3000:127.0.0.1:3000 user@server`).

## Konfigurasi (environment)

Implementasi dipilih otomatis di `src/bootstrap.js` dari variabel berikut:

| Variabel | Fungsi | Bila kosong |
|---|---|---|
| `DATABASE_URL` | Simpan knowledge di PostgreSQL | file JSON di `DATA_DIR` |
| `DATABASE_SSL` | `true` / `no-verify` untuk koneksi SSL | tanpa SSL |
| `EMBEDDING_MODEL` (+ `EMBEDDING_BASE_URL`) | Pencarian berdasarkan makna via pgvector (lihat [Pencarian berdasarkan makna](#pencarian-berdasarkan-makna-embedding)) | TF-IDF (cocok kata) |
| `EMBEDDING_STARTUP_WAIT_SECONDS` | Lama menunggu layanan embedding saat start | 90 |
| `LLM_BASE_URL` + `LLM_MODEL` | LLM lokal OpenAI-compatible | `ANTHROPIC_API_KEY` → Claude, selain itu ekstraktif |
| `ASSISTANT_NAME` | Nama awal asisten (setelah disimpan dari halaman admin, yang dipakai nilai dari sana) | `Asisten Virtual` |
| `ASSISTANT_STYLE` | Gaya bicara awal (idem) | kosong |
| `MIN_SCORE` | Ambang kemiripan minimum; **kalibrasi** bila memakai embedding | 0.05 (TF-IDF) / 0.35 sementara (vektor) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Akun admin **pertama** (hanya dipakai bila belum ada akun) | `admin` + password acak dicetak sekali di log |
| `ADMIN_TOKEN` | Token API untuk otomasi (n8n); tidak untuk login manusia | API token nonaktif |
| `SESSION_SECRET` | Kunci penanda sesi login | diturunkan dari `ADMIN_TOKEN`, atau acak (login ulang tiap restart) |
| `SESSION_TTL_HOURS` | Lama sesi login | 12 |
| `TRUST_PROXY=true` | Percaya header Cloudflare/proxy (IP asli, HTTPS) — wajib bila di belakang tunnel/proxy | tidak |
| `COOKIE_SECURE` | `auto` / `true` / `false` untuk atribut `Secure` cookie | `auto` |
| `SEED_ON_EMPTY=false` | Jangan impor `knowledge/` saat penyimpanan kosong | impor |

Daftar lengkap ada di `.env.example`.

## LLM lokal (tanpa API berbayar)

BE memanggil LLM **langsung** lewat endpoint OpenAI-compatible `/v1/chat/completions` (dengan `stream: true`), bukan lewat n8n — jalur chat tetap secepat mungkin.

Konfigurasi yang dipakai di server ini: **vLLM** (kontainer `vllm-qwen`, hanya dipublikasikan ke loopback host) dengan model Qwen3.5-9B:

```bash
LLM_BASE_URL=http://127.0.0.1:8100/v1
LLM_MODEL=qwen3.5-9b          # persis seperti nama model di server vLLM (cek: GET /v1/models)
LLM_API_KEY=...               # bila vLLM dijalankan dengan --api-key; isi langsung di .env, jangan dibagikan
```

Aplikasi hanya memerlukan endpoint berprotokol OpenAI, jadi server lain juga bisa dipakai dengan mengganti `LLM_BASE_URL` (mis. LM Studio `http://localhost:1234/v1`, llama.cpp `llama-server` `http://localhost:8080/v1`, Ollama `http://localhost:11434/v1`). Itu opsional dan **tidak dipakai** pada setup ini.

**Dari dalam Docker**, `localhost` menunjuk ke kontainer itu sendiri. Karena vLLM dan PostgreSQL hanya terbuka di loopback host, `docker-compose.server.yml` memakai `network_mode: host` sehingga `127.0.0.1` di `.env` menunjuk ke host. (Docker Desktop di Windows/Mac: gunakan `host.docker.internal` sebagai ganti `localhost`, dan pastikan firewall mengizinkan portnya.)

**Model "thinking" (mis. Qwen3.x di vLLM).** Mode berpikir membuat jawaban lambat muncul. Matikan per permintaan:

```bash
LLM_EXTRA_BODY='{"chat_template_kwargs":{"enable_thinking":false}}'
```

`LLM_EXTRA_BODY` diteruskan apa adanya ke permintaan (field `model`, `messages`, `stream` tidak bisa ditimpa), jadi bisa dipakai untuk opsi khusus runtime lain. Alternatif di sisi server vLLM: `--default-chat-template-kwargs '{"enable_thinking": false}'`. Sebagai pengaman, blok `<think>…</think>` yang tetap ditulis model dibuang dari jawaban (kasus tag pembuka yang hilang tidak ditangani; pakai `--reasoning-parser` di vLLM).

## PostgreSQL + pgvector

Siapkan sekali di server PostgreSQL Anda:

```sql
CREATE DATABASE rag;
\c rag
CREATE EXTENSION IF NOT EXISTS vector;     -- butuh pgvector terpasang; perlu superuser
```

Lalu `DATABASE_URL=postgres://user:pass@host:5432/rag`. Tabel (`knowledge_documents`, `knowledge_chunks`) dibuat otomatis saat start. Pastikan `pg_hba.conf` dan firewall mengizinkan host aplikasi.

## Pencarian berdasarkan makna (embedding)

Tanpa embedding, pencarian hanya mencocokkan **kata** (TF-IDF): "ongkir ke Papua?" tidak menemukan dokumen yang menulis "pengiriman". Dengan embedding, kalimat dibandingkan berdasarkan **makna**, jadi pertanyaan dengan kata berbeda, singkatan, atau bahasa lain tetap ketemu.

**1. Jalankan layanan embedding** (Hugging Face TEI + `BAAI/bge-m3`, multibahasa, cocok untuk bahasa Indonesia; berjalan di CPU dan hanya dibuka ke `127.0.0.1`):

```bash
docker compose -f docker-compose.embedding.yml up -d
docker compose -f docker-compose.embedding.yml logs -f embeddings   # tunggu siap; unduhan model pertama ±2,3 GB

# uji: harus mencetak 1024 (dimensi vektor bge-m3)
curl -s http://127.0.0.1:8200/v1/embeddings -H 'content-type: application/json' \
  -d '{"input":["halo"],"model":"BAAI/bge-m3"}' | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data'][0]['embedding']))"
```

Bila tag image tidak ditemukan, set `TEI_TAG=cpu-1.8` (atau `cpu-latest`). Server perlu akses ke Hugging Face untuk mengunduh model pertama kali. Untuk GPU, gunakan tag GPU TEI (perhatikan memori GPU yang sudah dipakai vLLM).

**2. Aktifkan di `.env` aplikasi** (butuh `DATABASE_URL` dengan pgvector), lalu jalankan ulang:

```bash
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_BASE_URL=http://127.0.0.1:8200/v1
```

Log harus menampilkan `Pencarian: pgvector (BAAI/bge-m3)`. Dimensi vektor dideteksi otomatis, dokumen yang sudah ada langsung diindeks, dan edit satu knowledge hanya meng-embed ulang chunk yang berubah. Bila layanan embedding belum siap saat aplikasi start, aplikasi menunggu hingga `EMBEDDING_STARTUP_WAIT_SECONDS` (bawaan 90) dengan log "Menunggu layanan embedding".

Model lain: set `EMBEDDING_MODEL` sesuai nama di server dan, bila perlu, `EMBEDDING_DOC_PREFIX` / `EMBEDDING_QUERY_PREFIX` (mis. `passage: ` / `query: ` untuk e5; `search_document: ` / `search_query: ` untuk nomic). bge-m3 tidak membutuhkan awalan. Mengganti model membuat tabel chunk dibuat ulang otomatis.

### Kalibrasi `MIN_SCORE` (wajib saat memakai embedding)

Skor kemiripan **tidak absolut**: model BGE, misalnya, cenderung memberi skor tinggi (sekitar 0,6 ke atas) bahkan untuk teks yang kurang berhubungan, dan angkanya berbeda tiap model. Ambang bawaan hanya penampung sementara; tentukan dari data Anda:

1. Tulis 15 sampai 30 pertanyaan contoh di `scripts/calibration-questions.txt`: baris `+` untuk pertanyaan yang jawabannya **ada** di knowledge (sertakan yang bahasanya berbeda dari dokumen), baris `-` untuk yang **tidak ada**.
2. Jalankan terhadap aplikasi yang sedang berjalan (butuh `ADMIN_TOKEN` di `.env`):

```bash
docker run --rm --network host -v "$PWD":/app -w /app \
  -e ADMIN_TOKEN="$(grep '^ADMIN_TOKEN=' .env | cut -d= -f2-)" \
  node:24-slim node scripts/calibrate.mjs http://127.0.0.1:3000 scripts/calibration-questions.txt
```

(Atau `ADMIN_TOKEN=... node scripts/calibrate.mjs <alamat> <berkas>` bila Node terpasang; sesuaikan port dengan `PORT` aplikasi.)

3. Skrip menampilkan skor teratas tiap pertanyaan dan merekomendasikan `MIN_SCORE=0.xx`, termasuk pertanyaan mana yang akan ditolak atau masih lolos. Pasang di `.env`, jalankan ulang, lalu cek hasil akhirnya lewat **Admin → Uji pencarian**. Ulangi bila knowledge bertambah banyak atau model embedding diganti.

Skrip memilih ambang yang **lebih mementingkan tidak menolak pertanyaan sah**: pertanyaan sah yang tertolak dihitung dua kali lebih buruk daripada pertanyaan tak relevan yang lolos, sebab LLM masih bisa mengatakan "informasi belum tersedia" pada informasi yang tidak nyambung. Bila skor kedua kelompok tumpang tindih, skrip memberi peringatan; opsi lanjutannya adalah reranker (belum ada).

## Perilaku chatbot (gaya customer service, tetap sesuai dokumen)

Chatbot bersikap seperti CS yang ramah, tetapi **fakta hanya boleh berasal dari knowledge aktif**:

| Situasi | Yang terjadi |
|---|---|
| Ada knowledge yang cocok | LLM menjawab singkat dan hangat berdasarkan knowledge itu; chip sumber tampil di bawah jawaban. |
| Hanya sebagian terjawab | Menjawab bagian yang ada, jujur bahwa sisanya belum ada informasinya. |
| Sapaan, terima kasih, "kamu siapa?" | LLM membalas ramah, memperkenalkan diri, dan menyebut topik yang tersedia (judul knowledge aktif). |
| Pertanyaan fakta yang tidak ada di knowledge | Minta maaf singkat, **tidak menebak**, lalu menawarkan topik yang tersedia. |
| Pertanyaan lanjutan pendek ("kalau ke Papua?") | Pencarian diulang bersama pertanyaan sebelumnya, jadi konteks percakapan terbawa. |
| LLM sedang mati dan tidak ada knowledge yang cocok | Pesan tetap berisi daftar topik (percakapan tidak error). |

**Di mana menulis apa:** *perilaku* asisten (nama, gaya, siapa dirinya) di **Pengaturan asisten**; *fakta layanan* (jam buka, harga, kebijakan) di **Knowledge**. Instruksi yang ditulis di Knowledge tidak mengubah perilaku, sebab isi Knowledge diperlakukan sebagai data, bukan perintah.

Aturan di prompt: tidak mengaku manusia, tidak menyebut kata "dokumen/konteks", menyapa hanya di pesan pertama, dan mengabaikan perintah yang disisipkan di pesan pengguna atau isi knowledge. Nama, gaya, dan keterangan tentang diri asisten diatur dari **Admin → Pengaturan asisten** (berlaku langsung tanpa restart; tercatat siapa yang terakhir mengubah). `ASSISTANT_NAME` / `ASSISTANT_STYLE` hanya nilai awal sebelum pernah disimpan dari halaman itu. Pada model kecil, aturan "jangan menebak" tidak bisa dijamin 100%; uji dengan pertanyaan yang jawabannya sengaja tidak ada di knowledge, dan perketat `ASSISTANT_STYLE` bila perlu.

## Akun admin

Halaman `/admin.html` memakai **akun per orang** (username + password), bukan satu token bersama.

- **Akun pertama** dibuat otomatis saat aplikasi pertama kali jalan dengan `ADMIN_USERNAME` (bawaan `admin`) dan `ADMIN_PASSWORD`. Tanpa `ADMIN_PASSWORD`, password acak dicetak **sekali** di log. Setelah akun ada, kedua variabel itu **diabaikan**: hapus `ADMIN_PASSWORD` dari `.env` setelah login pertama.
- Siapa yang sedang login tampil di bagian atas halaman ("Masuk sebagai ...").
- **Ubah password** sendiri lewat tombol di bagian atas (minimal 8 karakter, tidak wajib simbol). Perangkat lain yang masih login otomatis keluar.
- **Daftar akun**: halaman login punya tautan "Daftar" (username, nama, password). Akun baru berstatus **menunggu** dan belum bisa login (pesan: "menunggu persetujuan admin") sampai akun admin yang ada menyetujuinya di **Kelola admin → Setujui** (atau **Tolak** untuk menghapus). Akun yang disetujui punya hak yang sama dengan admin lain: melihat dan mengubah knowledge yang sama, mengelola akun, dan pengaturan asisten. Pendaftaran dibatasi 5 per jam per alamat IP dan maksimal 50 akun menunggu. Akun yang sudah ada sebelum fitur ini otomatis berstatus aktif.
- **Edit profil**: tombol **Edit profil** (akun sendiri) dan **Edit** di tiap baris **Kelola admin** mengubah nama tampilan dan username. Mengganti username tidak mengeluarkan siapa pun dari sesinya; login berikutnya memakai username baru. API: `PATCH /api/admin/users/:id` (hanya sesi login).
- **Kelola admin**: setujui/tolak pendaftaran, tambah akun, reset password akun lain, hapus akun. Tidak bisa menghapus diri sendiri atau akun terakhir.
- Password disimpan sebagai hash **scrypt** (tabel `admin_users` di PostgreSQL, atau `data/admin-users.json` tanpa database). Sesi berupa cookie `HttpOnly` + `SameSite=Lax` (+ `Secure` bila lewat HTTPS), bukan token yang disimpan di JavaScript.
- **Pembatasan login**: 5 kali gagal untuk satu akun, atau 30 kali dari satu alamat IP, mengunci 5 menit.
- Permintaan yang mengubah data dari situs lain ditolak (proteksi CSRF).
- **Lupa password semua akun**: hapus baris di tabel `admin_users` (atau berkas `admin-users.json`) lalu restart dengan `ADMIN_USERNAME`/`ADMIN_PASSWORD` baru.

### Di belakang Cloudflare Tunnel / proxy
Set `TRUST_PROXY=true` agar pembatas login memakai IP asli pengunjung (`CF-Connecting-IP`) dan cookie otomatis `Secure` saat diakses lewat HTTPS. Tanpa itu, semua pengunjung tampak berasal dari alamat `cloudflared` dan satu penyerang bisa mengunci semua orang. Aktifkan hanya bila aplikasi **tidak** bisa dijangkau langsung dari luar tanpa melewati proxy, atau batasi dengan firewall. Disarankan menambah **Cloudflare Access** di depan hostname ini sebagai lapisan pertama.

Batasan: logout menghapus cookie di peramban tetapi tidak membatalkan cookie yang sudah dicuri sebelum kedaluwarsa (sesi dicabut saat password diganti/direset atau akun dihapus).

## Mengelola knowledge

Di `/admin.html` admin dapat **menambah, mengedit, menghapus, mengunggah `.md`/`.txt`, dan mengaktifkan/menonaktifkan** knowledge. Hanya knowledge **aktif** yang dipakai chatbot, dan perubahan langsung berlaku tanpa restart. Folder `knowledge/` hanyalah **dokumen awal**: diimpor sekali saat penyimpanan masih kosong.

### API admin (untuk n8n / otomasi)

Endpoint knowledge dapat diakses dengan sesi login **atau** `Authorization: Bearer <ADMIN_TOKEN>` (untuk otomasi seperti n8n; set `ADMIN_TOKEN` di `.env`). Endpoint akun (`/api/admin/me`, `/password`, `/users`) hanya untuk sesi login, token API tidak cukup.

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/admin/knowledge` | daftar (ringkas) |
| GET | `/api/admin/knowledge/:id` | detail + isi |
| POST | `/api/admin/knowledge` | buat `{title, content, enabled?}` |
| PUT/PATCH | `/api/admin/knowledge/:id` | ubah sebagian `{title?, content?, enabled?}` |
| DELETE | `/api/admin/knowledge/:id` | hapus |
| POST | `/api/admin/search` | uji pencarian `{query}` → chunk + skor |
| GET/PUT | `/api/admin/assistant` | pengaturan asisten `{name, style, about}` (sesi) |
| POST | `/api/admin/login` · `/logout` | masuk `{username, password}` / keluar (sesi) |
| GET | `/api/admin/me` | akun yang sedang login (sesi) |
| POST | `/api/admin/password` | ubah password sendiri `{currentPassword, newPassword}` (sesi) |
| GET/POST | `/api/admin/users` | daftar / tambah akun `{username, displayName?, password}` (sesi) |
| POST/DELETE | `/api/admin/users/:id/password` · `/api/admin/users/:id` | reset password / ubah profil (PATCH) / hapus akun (sesi) |

API chat (publik): `POST /api/chat` (jawaban utuh) dan `POST /api/chat/stream` (Server-Sent Events: `sources` → `token`* → `done`/`error`).

## Peran n8n

n8n **tidak berada di jalur chat** (menambah satu hop dan latensi). Pakai n8n untuk otomasi di sekitarnya, memanggil API admin di atas:

- Jadwal harian: ambil dokumen dari Google Drive / Notion / SharePoint → konversi PDF/DOCX ke teks → `POST /api/admin/knowledge`.
- Notifikasi ke Slack/email saat knowledge berubah.

Konfigurasi node **HTTP Request**: Method `POST`, URL `http://<host-aplikasi>:3000/api/admin/knowledge`, Authentication → *Header Auth* (`Authorization` = `Bearer <ADMIN_TOKEN>`), Body JSON `{"title": "...", "content": "..."}`. Satu dokumen sumber = satu knowledge; untuk memperbarui, simpan `id` hasil POST lalu `PUT` ke `/api/admin/knowledge/<id>`.

## Arsitektur

Dependensi hanya mengarah ke dalam: `interface → application → domain`; `infrastructure` mengimplementasikan port milik `application`.

```
src/
├── domain/            Entitas & aturan murni (Chunk, Message, KnowledgeDocument, error)
├── application/       Use case (AskQuestion [+stream], Reindex/Seed/Save/Delete/List/SearchKnowledge, riwayat) + ports.js
├── infrastructure/    Adapter:
│   ├── persistence/   file JSON, PostgreSQL, riwayat in-memory
│   ├── retrieval/     TF-IDF, pgvector
│   ├── embedding/     embedder OpenAI-compatible
│   ├── generation/    LLM lokal OpenAI-compatible, Claude API, ekstraktif
│   └── llm/           HTTP, SSE, prompt bersama
├── interface/
│   ├── http/          Server (JSON + SSE), controller chat, knowledge & akun, sesi + token API
│   └── web/           Frontend (index = chat, admin.html = kelola knowledge)
├── bootstrap.js       Memilih implementasi konkret dari environment
├── composition.js     Composition root: merakit use case, controller, server
└── main.js            Entry point
```

Mengganti komponen cukup menulis adapter baru dan mengubah `bootstrap.js` — use case tidak tersentuh.

## Pengujian

```bash
npm test                                                   # 120 tes; 8 tes PostgreSQL otomatis dilewati
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/ragtest npm test   # + tes PostgreSQL/pgvector
```

`TEST_DATABASE_URL` harus menunjuk ke database **khusus tes** (tabel `knowledge_*` di-drop). LLM/embedding diganti server palsu OpenAI-compatible (`test/helpers/fake-llm.js`).

## Keterbatasan saat ini
- Semua admin berperan sama (belum ada peran/izin berbeda) dan belum ada catatan audit siapa mengubah knowledge.
- Sesi tanpa status: tidak bisa dicabut satu per satu (lihat batasan di bagian Akun admin).
- Pembatas login ada di memori, jadi hitungannya reset saat restart.
- Riwayat chat di memori (hilang saat restart).
- Unggah hanya `.md`/`.txt` (PDF/DOCX belum didukung; bisa lewat n8n).
- Belum ada reranker maupun hybrid search (kata + makna); kualitas bergantung pada model embedding dan `MIN_SCORE`. Kode/ID persis (mis. nomor produk) paling baik dicari dengan kata, bukan makna.

## Cloudflare dan cache

Server mengirim `Cache-Control: no-store` untuk semua halaman dan berkas statis, **dan** menambahkan `?v=<hash isi berkas>` otomatis pada URL JS/CSS/gambar (di HTML dan di import antar-modul), sehingga peramban yang masih menyimpan salinan lama tetap meminta berkas baru setiap kali aplikasi diperbarui. Dengan begitu Cloudflare maupun peramban tidak menyajikan `admin.js`/`app.js` versi lama setelah aplikasi diperbarui. Bila setelah update halaman terasa tidak berubah (mis. tombol Simpan hanya memuat ulang halaman), buka Cloudflare → **Caching → Configuration → Purge Everything**, lalu muat ulang peramban dengan Ctrl+Shift+R.

## Bahasa antarmuka (ID / EN)

Halaman chat dan admin punya pilihan bahasa **ID | EN** di pojok kanan atas. Pilihan disimpan di peramban; tanpa pilihan, bahasa mengikuti peramban (id → Indonesia, lainnya → English). Semua teks ada di `src/interface/web/i18n.js` (dua kamus); tes memastikan kedua bahasa selalu punya kunci yang sama dan tidak ada teks yang tertinggal. Yang **tidak** ikut diterjemahkan: pesan error dari server (mis. validasi) dan isi knowledge. Bahasa jawaban chatbot mengikuti bahasa pertanyaan pengguna lewat "Gaya bicara" di Pengaturan asisten.

## Logo dan ikon

Berkas ada di `src/interface/web/`: `logo-mark.png` (simbol di header chat dan admin), `favicon.png` (ikon tab, 64 px) dan `apple-touch-icon.png` (180 px). Tulisan "LumiAssist" di header adalah teks biasa yang diberi warna logo ("Lumi" biru tua, "Assist" indigo; warnanya di `styles.css`), jadi tetap tajam di layar apa pun. Untuk mengganti logo, timpa berkas-berkas itu; versi aset otomatis membuat peramban mengambil yang baru. Bila ada logo versi besar atau SVG, hasilnya akan lebih tajam di layar HP beresolusi tinggi.

## Unggah file sebagai knowledge

Di **Tambah/Edit knowledge**, admin bisa **mengunggah file** atau **menulis sendiri** isinya di kolom Isi.

| Format | Yang diambil |
|---|---|
| **PDF** | teks per halaman (baris dan paragraf mengikuti posisi di halaman) |
| **DOCX** | paragraf dan tabel (baris tabel menjadi `sel \| sel`) |
| **PPTX** | teks tiap slide (berjudul "Slide N", urut sesuai presentasi) beserta catatan pembicara |
| **TXT, MD, CSV** | isi apa adanya (UTF-8 atau UTF-16 ber-BOM); judul dari heading `# ...` pada Markdown |

- **Maksimal 10 MB per file.** Teks hasil ekstraksi maksimal 500.000 karakter (pecah file yang lebih besar).
- File **tidak langsung disimpan**: teksnya muncul di editor untuk diperiksa dan dirapikan dulu, baru disimpan seperti knowledge biasa (jadi bisa diedit/dinonaktifkan/dihapus).
- **Belum didukung:** format lama `.doc`/`.ppt`/`.xls` (buka lalu "Simpan sebagai" DOCX/PPTX/PDF), **PDF hasil scan atau gambar** (tidak ada teks; perlu OCR), file ber-password, serta gambar/grafik di dalam dokumen. Tabel di PDF dibaca sebagai teks biasa (kolom bisa tidak rapi).
- Keamanan: jenis file diperiksa dari isinya (bukan hanya nama), arsip DOCX/PPTX dibatasi ukuran setelah dibuka (anti "zip bomb"), PDF dibaca tanpa menjalankan skrip (PDF.js 6.x; versi 5.6–6.2 punya celah eksekusi JavaScript dan **jangan diturunkan**). Endpoint: `POST /api/admin/knowledge/extract` (isi mentah + header `x-filename`; sesi login atau Bearer token).
- Dokumen besar menghasilkan banyak chunk; dengan embedding di CPU, **menyimpannya bisa memakan waktu** (puluhan detik sampai menit). Bila di balik Cloudflare permintaan melewati ~100 detik, kemungkinan muncul galat 524 padahal indeksnya tetap selesai di server; muat ulang daftar untuk memastikan.
- Membutuhkan **Node ≥ 22.13** (image Docker memakai Node 24).

## Ambil knowledge dari URL (website perusahaan)

Di **Tambah knowledge** ada kolom **"Atau ambil dari alamat web (URL)"**.

- **Satu halaman:** tempel alamat (mis. `www.perusahaan.co.id/tentang`; tanpa skema dianggap `https://`), klik **Ambil**. Teks halaman muncul di editor untuk diperiksa, lalu disimpan seperti knowledge biasa. Baris `Sumber: <url>` ditambahkan di akhir isi.
- **Seluruh situs:** centang **"Ambil juga halaman lain di situs ini"**. Server mengambil halaman awal beserta tautan di situs yang sama (satu tingkat, maksimal 10 halaman; batas keras 20), lalu menampilkan daftar untuk dipilih. Tiap halaman yang dicentang disimpan sebagai **knowledge terpisah** (jadi bisa dinonaktifkan atau dihapus satu per satu). Halaman akun/keranjang, gambar, dan berkas dokumen dilewati; halaman duplikat atau kosong dibuang.
- Alamat yang menunjuk ke **PDF, DOCX, atau PPTX** juga dibaca (lewat pembaca file yang sama).
- Tentang isinya: menu, footer, dan form dibuang; area `<main>`/`<article>` diutamakan. Halaman yang kontennya baru muncul lewat **JavaScript** (aplikasi React/SPA) **tidak terbaca**, dan akan ditolak dengan pesan yang jelas. `robots.txt` tidak dibaca: **hanya ambil situs milik Anda atau yang Anda berhak memakai isinya.**
- Batas: 10 MB per halaman, 10 dtk menunggu respons, 60 dtk untuk seluruh penjelajahan (sisanya ditandai "dihentikan karena batas waktu").
- Endpoint: `POST /api/admin/knowledge/import-url` `{url, crawl?, maxPages?}` (sesi login atau Bearer token). Tidak menyimpan apa pun; hasilnya disimpan lewat endpoint knowledge biasa.

**Keamanan (SSRF).** Fitur ini membuat server meminta halaman atas perintah pengguna, sehingga tanpa pengaman bisa dipakai menjangkau layanan internal (LLM di `127.0.0.1:8100`, PostgreSQL, n8n, metadata cloud, perangkat LAN). Karena itu:
- Hanya alamat **internet publik** yang boleh dituju. Loopback, jaringan privat (10/8, 172.16/12, 192.168/16), link-local, CGNAT (100.64/10, dipakai VPN/WARP), multicast, serta IPv6 yang setara (termasuk bentuk IPv4-dalam-IPv6) **ditolak**. IP dalam bentuk desimal/heksadesimal ikut tertangkap.
- Alamat diperiksa **saat koneksi dibuat** (bukan hanya saat URL dibaca), sehingga trik DNS-rebinding tidak berhasil; setiap **pengalihan (redirect)** diperiksa ulang (maks 5), dan skema selain http/https ditolak.
- Port dibatasi 80, 443, 8080, 8443; URL berisi `user:password@` ditolak; tanpa cookie dan kredensial.
- Ukuran dibatasi juga **setelah dekompresi** (gzip/br), dan permintaan ikut dibatalkan bila klien memutus koneksi.
- Bila perlu mengambil halaman dari **jaringan internal** (mis. wiki perusahaan), setel `URL_IMPORT_ALLOW_PRIVATE=true` di `.env`. Itu mematikan semua pengaman di atas, jadi aktifkan hanya bila **semua admin dipercaya**.

## Saran pertanyaan di layar awal chat

Tombol saran di layar awal chat **tidak lagi tetap**:
- **Bawaan (otomatis):** dibuat dari **judul knowledge yang aktif** ("Ceritakan tentang <judul>", maks 4), jadi langsung mengikuti knowledge yang ditambah, diganti, atau dinonaktifkan, dalam bahasa antarmuka (ID/EN) yang dipilih pengunjung. Tanpa knowledge aktif, tidak ada tombol saran.
- **Diatur admin:** di **Admin → Pengaturan asisten** ada dua kolom, **Bahasa Indonesia** dan **English** (satu per baris, maks 6 baris, 120 karakter per baris). Pengunjung melihat daftar sesuai bahasa yang dipilihnya (ID/EN); bila daftar bahasa itu kosong, dipakai daftar bahasa lainnya, dan bila keduanya kosong, tombol dibuat otomatis dari judul knowledge.
- **Terjemahan otomatis:** bila saat menyimpan hanya satu bahasa yang terisi, bahasa lainnya **diterjemahkan oleh LLM** dan ikut disimpan (gagal atau LLM mati: tersimpan apa adanya). Tombol **Terjemahkan ke English / ke Indonesia (AI)** menerjemahkan isi kolom yang sedang ditulis agar bisa diperiksa dulu. Ubah salah satu kolom setelah keduanya terisi tidak otomatis menyinkronkan yang lain: klik tombol terjemahkan lagi.
- **Buat dengan AI:** tombol itu meminta LLM menyusun 4 pertanyaan berbahasa Indonesia dari knowledge aktif (judul + awal isinya), lalu menerjemahkannya ke English. Hasilnya hanya **diisikan ke kolom** untuk Anda periksa; baru berlaku setelah klik **Simpan pengaturan**. Memerlukan LLM aktif (`LLM_BASE_URL`); tanpa LLM muncul pesan petunjuk.
- API: `GET /api/suggestions` (publik; `{suggestions: {id, en}, topics}`), `POST /api/admin/assistant/suggest` dan `POST /api/admin/assistant/translate-suggestions` `{from, lines}` (sesi login). Daftar saran ikut tersimpan di pengaturan asisten (PostgreSQL atau `settings.json`); data lama berupa satu daftar dibaca sebagai Indonesia.

## Sumber yang bisa diklik

Di bawah jawaban chatbot, chip sumber (📄 judul knowledge) menjadi **tautan** bila knowledge itu punya alamat web: server membaca baris `Sumber: https://...` di isi knowledge (ditambahkan otomatis oleh **Ambil dari URL**, atau ketik sendiri di akhir isi, juga dikenali `Source:`). Klik membuka halaman aslinya di tab baru (`noopener noreferrer`); knowledge tanpa baris itu tetap label biasa. Alamat web di dalam teks jawaban juga otomatis menjadi tautan.

Keamanan: hanya `http://` dan `https://` yang dijadikan tautan (`javascript:`, `data:`, dst. diabaikan di server **dan** di peramban), alamat tanpa kredensial, dan teks jawaban tidak pernah dimasukkan lewat `innerHTML`. Untuk memperbarui knowledge lama agar chip-nya bisa diklik, tambahkan baris `Sumber: <alamat>` di akhir isinya.
