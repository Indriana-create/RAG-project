# RAG-project

Chatbot Retrieval-Augmented Generation (RAG) dengan antarmuka web dan **halaman admin** untuk mengelola knowledge, dibangun dengan **Clean Architecture**. Bisa berjalan 100% lokal: **PostgreSQL (+ pgvector)** untuk penyimpanan dan pencarian semantik, serta **LLM lokal** (LM Studio / vLLM / llama.cpp) tanpa API berbayar.

## Menjalankan

Tanpa konfigurasi apa pun (mode paling sederhana: file JSON + TF-IDF + jawaban ekstraktif):

```bash
npm install
ADMIN_TOKEN=rahasia npm start     # http://localhost:3000
npm test
```

- Chat: `http://localhost:3000` — jawaban muncul **bertahap** (streaming)
- Admin: `http://localhost:3000/admin.html` (login dengan `ADMIN_TOKEN`; bila tidak diset, token acak dicetak di log)

### Dengan Docker

```bash
cp .env.example .env     # lalu isi/aktifkan variabel yang dibutuhkan
docker compose --env-file .env up --build
```

PowerShell tanpa `.env`: `$env:ADMIN_TOKEN="rahasia"; docker compose up --build`.

## Konfigurasi (environment)

Implementasi dipilih otomatis di `src/bootstrap.js` dari variabel berikut:

| Variabel | Fungsi | Bila kosong |
|---|---|---|
| `DATABASE_URL` | Simpan knowledge di PostgreSQL | file JSON di `DATA_DIR` |
| `DATABASE_SSL` | `true` / `no-verify` untuk koneksi SSL | tanpa SSL |
| `EMBEDDING_MODEL` (+ `EMBEDDING_BASE_URL`) | Pencarian semantik via pgvector | TF-IDF (cocok kata) |
| `LLM_BASE_URL` + `LLM_MODEL` | LLM lokal OpenAI-compatible | `ANTHROPIC_API_KEY` → Claude, selain itu ekstraktif |
| `MIN_SCORE` | Ambang kemiripan minimum | 0.05 (TF-IDF) / 0.35 (vektor) |
| `ADMIN_TOKEN` | Token login admin | token acak di log |
| `SEED_ON_EMPTY=false` | Jangan impor `knowledge/` saat penyimpanan kosong | impor |

Daftar lengkap ada di `.env.example`.

## LLM lokal (tanpa API berbayar)

BE memanggil LLM **langsung** lewat endpoint OpenAI-compatible `/v1/chat/completions` (dengan `stream: true`), bukan lewat n8n — jalur chat tetap secepat mungkin.

| Runtime | Contoh `LLM_BASE_URL` |
|---|---|
| LM Studio | `http://localhost:1234/v1` |
| vLLM | `http://localhost:8000/v1` |
| llama.cpp `llama-server` | `http://localhost:8080/v1` |

`LLM_MODEL` harus sama dengan nama model di server tersebut. Contoh LM Studio:

```bash
LLM_BASE_URL=http://localhost:1234/v1 LLM_MODEL=nama-model ADMIN_TOKEN=rahasia npm start
```

**Dari dalam Docker (Windows/Mac)** `localhost` menunjuk ke kontainer itu sendiri. Pakai `http://host.docker.internal:1234/v1`, dan di LM Studio aktifkan **Serve on Local Network** (bila tidak, koneksi dari Docker ditolak). Firewall Windows juga harus mengizinkan port tersebut.

Catatan: model "thinking" bisa memuntahkan blok `<think>…</think>` ke jawaban; pakai varian instruct non-thinking atau matikan mode berpikir di server.

## PostgreSQL + pgvector

Siapkan sekali di server PostgreSQL Anda:

```sql
CREATE DATABASE rag;
\c rag
CREATE EXTENSION IF NOT EXISTS vector;     -- butuh pgvector terpasang; perlu superuser
```

Lalu `DATABASE_URL=postgres://user:pass@host:5432/rag`. Tabel (`knowledge_documents`, `knowledge_chunks`) dibuat otomatis saat start. Pastikan `pg_hba.conf` dan firewall mengizinkan host aplikasi.

Pencarian semantik (butuh model embedding yang dimuat di server LLM Anda, endpoint `/v1/embeddings`):

```bash
DATABASE_URL=... EMBEDDING_MODEL=nama-model-embedding \
LLM_BASE_URL=http://localhost:1234/v1 LLM_MODEL=nama-model npm start
```

- Pilih model embedding **multibahasa** (mis. bge-m3) bila dokumen berbahasa Indonesia.
- Beberapa model butuh awalan: `EMBEDDING_DOC_PREFIX` / `EMBEDDING_QUERY_PREFIX` (mis. `search_document: ` / `search_query: ` untuk nomic, `passage: ` / `query: ` untuk e5).
- Dimensi vektor dideteksi otomatis. Mengganti model membuat tabel chunk dibuat ulang dan diindeks ulang (data sumber di `knowledge_documents` aman).
- Pengindeksan **inkremental**: edit satu dokumen hanya meng-embed chunk yang berubah.

### Kalibrasi `MIN_SCORE`

Skor kemiripan sangat bergantung pada model embedding, jadi angka bawaan (0.35) hanya titik awal. Buka **Admin → Uji pencarian**, coba beberapa pertanyaan relevan dan tidak relevan, lalu atur `MIN_SCORE` di antara skor tertinggi pertanyaan tidak relevan dan skor terendah pertanyaan relevan.

## Mengelola knowledge

Di `/admin.html` admin dapat **menambah, mengedit, menghapus, mengunggah `.md`/`.txt`, dan mengaktifkan/menonaktifkan** knowledge. Hanya knowledge **aktif** yang dipakai chatbot, dan perubahan langsung berlaku tanpa restart. Folder `knowledge/` hanyalah **dokumen awal**: diimpor sekali saat penyimpanan masih kosong.

### API admin (untuk n8n / otomasi)

Semua endpoint butuh `Authorization: Bearer <ADMIN_TOKEN>`.

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/admin/knowledge` | daftar (ringkas) |
| GET | `/api/admin/knowledge/:id` | detail + isi |
| POST | `/api/admin/knowledge` | buat `{title, content, enabled?}` |
| PUT/PATCH | `/api/admin/knowledge/:id` | ubah sebagian `{title?, content?, enabled?}` |
| DELETE | `/api/admin/knowledge/:id` | hapus |
| POST | `/api/admin/search` | uji pencarian `{query}` → chunk + skor |

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
│   ├── http/          Server (JSON + SSE), controller chat & admin, autentikasi token
│   └── web/           Frontend (index = chat, admin.html = kelola knowledge)
├── bootstrap.js       Memilih implementasi konkret dari environment
├── composition.js     Composition root: merakit use case, controller, server
└── main.js            Entry point
```

Mengganti komponen cukup menulis adapter baru dan mengubah `bootstrap.js` — use case tidak tersentuh.

## Pengujian

```bash
npm test                                                   # 17 tes; 4 tes PostgreSQL otomatis dilewati
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/ragtest npm test   # + tes PostgreSQL/pgvector
```

`TEST_DATABASE_URL` harus menunjuk ke database **khusus tes** (tabel `knowledge_*` di-drop). LLM/embedding diganti server palsu OpenAI-compatible (`test/helpers/fake-llm.js`).

## Keterbatasan saat ini
- Satu token admin bersama, tanpa pembatasan percobaan login; letakkan di belakang HTTPS/reverse proxy untuk produksi.
- Riwayat chat di memori (hilang saat restart).
- Unggah hanya `.md`/`.txt` (PDF/DOCX belum didukung; bisa lewat n8n).
- Belum ada reranking/hybrid search; kualitas bergantung pada model embedding dan `MIN_SCORE`.
