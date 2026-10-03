import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dictionaries, t } from '../src/interface/web/i18n.js';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/interface/web');
const read = (file) => readFile(path.join(web, file), 'utf8');

/** Semua kunci yang dipakai halaman (atribut data-i18n* dan pemanggilan t('...')). */
async function usedKeys() {
  const keys = new Set();
  for (const file of ['index.html', 'admin.html']) {
    for (const m of (await read(file)).matchAll(/data-(?:i18n|i18n-html|i18n-placeholder|i18n-aria-label|title-key)="([\w.]+)"/g)) keys.add(m[1]);
  }
  for (const file of ['app.js', 'api.js', 'admin.js', 'admin-api.js']) {
    for (const m of (await read(file)).matchAll(/\bt\('([\w.]+)'/g)) keys.add(m[1]);
  }
  return keys;
}

test('i18n: Indonesia dan English punya kunci yang sama persis dan tidak ada yang kosong', () => {
  const id = Object.keys(dictionaries.id).sort();
  const en = Object.keys(dictionaries.en).sort();
  assert.deepEqual(en, id);
  for (const lang of ['id', 'en']) {
    for (const [key, value] of Object.entries(dictionaries[lang])) assert.ok(value.trim(), `${lang}:${key} kosong`);
  }
});

test('i18n: setiap kunci yang dipakai halaman ada di kedua bahasa, dan tidak ada kunci yatim', async () => {
  const used = await usedKeys();
  assert.ok(used.size > 60);
  for (const key of used) {
    assert.ok(key in dictionaries.id, `kunci tidak ada di id: ${key}`);
    assert.ok(key in dictionaries.en, `kunci tidak ada di en: ${key}`);
  }
  const defined = Object.keys(dictionaries.id);
  const orphans = defined.filter((k) => !used.has(k));
  assert.deepEqual(orphans, [], `kunci terdefinisi tetapi tidak dipakai: ${orphans.join(', ')}`);
});

test('i18n: parameter {nama} pada kedua bahasa sama, dan t() mengisi parameter', () => {
  const params = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(dictionaries.id)) assert.deepEqual(params(dictionaries.en[key]), params(dictionaries.id[key]), key);
  assert.equal(t('panel.summary', { active: 2, total: 5 }).includes('2'), true);
  assert.equal(t('kunci.tidak.ada'), 'kunci.tidak.ada');
});

test('i18n: tidak ada teks Indonesia yang tertinggal di atribut statis halaman (tanpa data-i18n)', async () => {
  const admin = await read('admin.html');
  // Setiap <label>, <button>, <h2>, <h3>, <summary> bertulisan harus punya data-i18n (atau berisi elemen bertanda).
  for (const m of admin.matchAll(/<(label|button|h2|h3|small)\b([^>]*)>([^<]+)</g)) {
    const [, tag, attrs, text] = m;
    if (!text.trim() || /data-lang=/.test(attrs)) continue; // nama bahasa (ID/EN) memang tidak diterjemahkan
    assert.match(attrs, /data-i18n/, `<${tag}> tanpa data-i18n: "${text.trim()}"`);
  }
});
