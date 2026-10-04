#!/usr/bin/env node
// Menentukan MIN_SCORE dari pertanyaan contoh Anda, memakai pencarian pada aplikasi yang SEDANG BERJALAN.
//
//   ADMIN_TOKEN=... node scripts/calibrate.mjs http://127.0.0.1:3100 scripts/calibration-questions.txt
//
// Tanpa Node di server (jalankan lewat Docker, jaringan host agar 127.0.0.1 terjangkau):
//   docker run --rm --network host -v "$PWD":/app -w /app -e ADMIN_TOKEN="$(grep '^ADMIN_TOKEN=' .env | cut -d= -f2-)" \
//     node:24-slim node scripts/calibrate.mjs http://127.0.0.1:3100 scripts/calibration-questions.txt
import { readFile } from 'node:fs/promises';
import { analyze, parseQuestions } from './lib/calibration.js';

const [baseUrl, file] = process.argv.slice(2);
const token = process.env.ADMIN_TOKEN;
if (!baseUrl || !file || !token) {
  console.error('Pemakaian: ADMIN_TOKEN=... node scripts/calibrate.mjs <alamat-aplikasi> <berkas-pertanyaan>');
  process.exit(2);
}

const rows = [];
for (const item of parseQuestions(await readFile(file, 'utf8'))) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/admin/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: item.question }),
  });
  if (!res.ok) {
    console.error(`Gagal (${res.status}) untuk "${item.question}": ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const { hits } = await res.json();
  rows.push({ ...item, top: hits[0]?.score ?? 0, title: hits[0]?.title ?? '(tidak ada hasil)' });
}

const fmt = (n) => n.toFixed(3);
console.log('\nSkor teratas tiap pertanyaan (+ = harus ketemu, - = tidak boleh ketemu):\n');
for (const r of [...rows].sort((a, b) => b.top - a.top)) {
  console.log(`  ${r.relevant ? '+' : '-'}  ${fmt(r.top)}  ${r.question.slice(0, 60).padEnd(60)} → ${r.title}`);
}

const result = analyze(rows);
console.log(`\nPertanyaan "+": skor terendah ${fmt(result.positive.min)}, median ${fmt(result.positive.median)}`);
console.log(`Pertanyaan "-": skor tertinggi ${fmt(result.negative.max)}, median ${fmt(result.negative.median)}`);
if (result.separable) console.log(`Terpisah dengan jelas, selisih (margin) ${fmt(result.margin)}.`);
else console.log('PERHATIAN: skor kedua kelompok saling tumpang tindih; tidak ada ambang yang sempurna.');

console.log(`\nRekomendasi:  MIN_SCORE=${result.threshold}`);
if (result.missed.length) console.log(`  Pertanyaan "+" yang akan ditolak: ${result.missed.map((r) => `"${r.question}"`).join(', ')}`);
if (result.leaked.length) console.log(`  Pertanyaan "-" yang masih lolos : ${result.leaked.map((r) => `"${r.question}"`).join(', ')}`);
if (!result.separable) console.log('  Saran: tambah knowledge untuk topik yang ditolak, atau pakai pertanyaan contoh yang lebih representatif.');
if (result.separable && result.margin < 0.03) console.log('  Catatan: margin sangat tipis; tambah lebih banyak pertanyaan contoh sebelum mempercayai angka ini.');
