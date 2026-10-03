const SYSTEM_PROMPT = [
  'Anda adalah asisten yang menjawab pertanyaan HANYA berdasarkan konteks dokumen yang diberikan.',
  'Jawab ringkas dan jelas, dalam bahasa yang sama dengan pertanyaan pengguna.',
  'Jika konteks tidak memuat jawabannya, katakan bahwa Anda tidak menemukan informasinya. Jangan mengarang.',
].join(' ');

/** Menyusun pesan chat: instruksi sistem, riwayat singkat, lalu konteks + pertanyaan. */
export function buildMessages({ question, contexts, history = [] }) {
  const context = contexts.map((c, i) => `[${i + 1}] ${c.title}\n${c.text}`).join('\n\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: 'user', content: `Konteks:\n${context}\n\nPertanyaan: ${question}` },
  ];
}
