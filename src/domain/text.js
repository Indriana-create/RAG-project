const STOPWORDS = new Set(
  ('yang dan di ke dari untuk dengan pada adalah ini itu atau apa siapa bagaimana kapan dimana mana ' +
    'saya kamu kami kita anda ada akan bisa dapat juga tidak sudah the a an of to in is are and or for on with how what ' +
    // basa-basi percakapan: bukan kata kunci pencarian
    'halo hai hi hello selamat pagi siang sore malam terima kasih makasih terimakasih thanks thank oke ok baik tolong mohon dong ya nih deh sih kak kakak min admin').split(' ')
);

/** Normalisasi & tokenisasi teks (huruf kecil, tanpa stopword). */
export function tokenize(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function splitSentences(text) {
  return text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}
