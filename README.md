# RAG-project

Chatbot Retrieval-Augmented Generation (RAG) dengan antarmuka web, dibangun dengan **Clean Architecture**. Menjawab pertanyaan berdasarkan dokumen di folder `knowledge/`.

## Menjalankan

```bash
npm start            # http://localhost:3000
npm test
```

Tanpa konfigurasi, bot memakai jawaban *ekstraktif* offline. Untuk jawaban LLM, salin `.env.example`, isi `ANTHROPIC_API_KEY`, lalu jalankan `node --env-file=.env src/main.js`.

Tambah pengetahuan dengan menaruh file `.md`/`.txt` ke `knowledge/` lalu restart.

## Arsitektur

Dependensi hanya mengarah ke dalam: `interface → application → domain`; `infrastructure` mengimplementasikan port milik `application`.

```
src/
├── domain/            Entitas & aturan murni (Chunk, Message, tokenisasi) — tanpa I/O
├── application/       Use case (AskQuestion, IngestKnowledge, riwayat) + ports.js (kontrak)
├── infrastructure/    Adapter: TF-IDF retriever, generator ekstraktif/Claude,
│                      sumber dokumen file, riwayat in-memory
├── interface/
│   ├── http/          Server & controller
│   └── web/           Frontend (HTML/CSS/JS)
└── main.js            Composition root — satu-satunya tempat merakit implementasi
```

Mengganti komponen cukup menulis adapter baru dan mengubah `main.js` (mis. vector DB sebagai Retriever, PostgreSQL sebagai riwayat), tanpa menyentuh use case.
