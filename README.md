# RAG-project

Chatbot Retrieval-Augmented Generation (RAG) dengan antarmuka web dan **halaman admin** untuk mengelola knowledge, dibangun dengan **Clean Architecture**.

## Menjalankan

```bash
ADMIN_TOKEN=rahasia npm start     # http://localhost:3000
npm test
```

- Chat: `http://localhost:3000`
- Admin: `http://localhost:3000/admin.html` (login dengan `ADMIN_TOKEN`; bila tidak diset, token acak dicetak di log saat start)

Tanpa konfigurasi lain, bot memakai jawaban *ekstraktif* offline. Untuk jawaban LLM, isi `ANTHROPIC_API_KEY` (lihat `.env.example`) lalu jalankan `node --env-file=.env src/main.js`.

### Dengan Docker

```bash
ADMIN_TOKEN=rahasia docker compose up --build    # http://localhost:3000
```

PowerShell: `$env:ADMIN_TOKEN="rahasia"; docker compose up --build`. Knowledge disimpan di volume `rag-data` sehingga bertahan antar restart.

## Mengelola knowledge

Di `/admin.html` admin dapat **menambah, mengedit, menghapus, mengunggah file `.md`/`.txt`, dan mengaktifkan/menonaktifkan** knowledge. Hanya knowledge **aktif** yang dipakai chatbot, dan perubahan langsung berlaku (indeks dibangun ulang otomatis, tanpa restart).

Folder `knowledge/` hanyalah **dokumen awal**: diimpor sekali saat penyimpanan (`data/knowledge.json`) masih kosong. Setelah itu sumber kebenarannya adalah penyimpanan, bukan folder tersebut.

### API admin (untuk otomasi, mis. n8n)

Semua endpoint butuh header `Authorization: Bearer <ADMIN_TOKEN>`.

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/admin/knowledge` | daftar (ringkas) |
| GET | `/api/admin/knowledge/:id` | detail + isi |
| POST | `/api/admin/knowledge` | buat `{title, content, enabled?}` |
| PUT/PATCH | `/api/admin/knowledge/:id` | ubah sebagian `{title?, content?, enabled?}` |
| DELETE | `/api/admin/knowledge/:id` | hapus |

Contoh impor dari alur otomasi:
```bash
curl -X POST http://localhost:3000/api/admin/knowledge \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Garansi","content":"Garansi berlaku 24 bulan."}'
```

## Arsitektur

Dependensi hanya mengarah ke dalam: `interface → application → domain`; `infrastructure` mengimplementasikan port milik `application`.

```
src/
├── domain/            Entitas & aturan murni (Chunk, Message, KnowledgeDocument, error)
├── application/       Use case (AskQuestion, Reindex/Seed/Save/Delete/ListKnowledge, riwayat) + ports.js
├── infrastructure/    Adapter: TF-IDF retriever, generator ekstraktif/Claude,
│                      repository knowledge file JSON, sumber dokumen awal, riwayat in-memory
├── interface/
│   ├── http/          Server, controller chat & admin, autentikasi token
│   └── web/           Frontend (index = chat, admin.html = kelola knowledge)
├── composition.js     Composition root: merakit semua implementasi konkret
└── main.js            Entry point: membaca env lalu menjalankan server
```

Mengganti komponen cukup menulis adapter baru dan mengubah `composition.js` (mis. vector DB sebagai Retriever, PostgreSQL sebagai KnowledgeRepository), tanpa menyentuh use case.

## Keterbatasan saat ini
- Pencarian TF-IDF mencocokkan kata, bukan makna (belum embedding).
- Satu token admin bersama, tanpa pembatasan percobaan login; letakkan di belakang HTTPS/reverse proxy untuk produksi.
- Riwayat chat di memori (hilang saat restart).
- Unggah hanya `.md`/`.txt` (PDF/DOCX belum didukung).
