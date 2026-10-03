const MAX_TOPICS = 20;
const MAX_TITLE = 80;

/** Judul topik untuk ditampilkan/dimasukkan ke prompt: dirapikan, dibatasi, dan tanpa baris baru. */
export const cleanTopics = (titles = []) =>
  [...new Set(titles.map((t) => String(t).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE)).filter(Boolean))].slice(0, MAX_TOPICS);

/** Jawaban bila tidak ada informasi yang cocok dan LLM tidak tersedia / tidak dipakai. */
export function noAnswerMessage(topics = []) {
  const list = cleanTopics(topics);
  return list.length
    ? `Maaf, saya tidak menemukan informasi tentang itu. Saya bisa membantu seputar: ${list.join(', ')}.`
    : 'Maaf, saya tidak menemukan informasi tentang itu. Coba ubah pertanyaan Anda.';
}
