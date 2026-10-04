/** Potongan teks dari sebuah dokumen — unit yang diindeks & diambil (retrieval). */
export function createChunk({ documentId, title, index, text }) {
  if (!text || !text.trim()) throw new Error('Chunk tidak boleh kosong');
  return Object.freeze({ id: `${documentId}#${index}`, documentId, title, index, text: text.trim() });
}

/**
 * Paragraf yang jauh lebih panjang dari `maxChars` (umum pada hasil PDF yang tanpa baris kosong) dipecah di batas
 * baris, lalu kalimat, lalu kata, supaya satu chunk tidak menjadi blok raksasa yang membuat pencarian kurang tepat.
 */
function splitLong(paragraph, maxChars) {
  const limit = Math.round(maxChars * 1.5);
  if (paragraph.length <= limit) return [paragraph];
  const pieces = paragraph.split(/\n/).flatMap((line) => line.split(/(?<=[.!?])\s+/));
  const parts = [];
  let current = '';
  for (const piece of pieces) {
    if (piece.length > limit) {
      if (current) { parts.push(current); current = ''; }
      for (let i = 0; i < piece.length; i += maxChars) parts.push(piece.slice(i, i + maxChars));
      continue;
    }
    if (current && current.length + piece.length + 1 > maxChars) { parts.push(current); current = ''; }
    current = current ? `${current} ${piece}` : piece;
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Aturan domain: memecah dokumen menjadi chunk per paragraf,
 * digabung sampai mendekati `maxChars`.
 */
export function chunkDocument(doc, maxChars = 600) {
  const paragraphs = doc.content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).flatMap((p) => splitLong(p, maxChars));
  const chunks = [];
  let buffer = '';
  const flush = () => {
    if (buffer) chunks.push(createChunk({ documentId: doc.id, title: doc.title, index: chunks.length, text: buffer }));
    buffer = '';
  };
  for (const p of paragraphs) {
    if (buffer && buffer.length + p.length > maxChars) flush();
    buffer = buffer ? `${buffer}\n\n${p}` : p;
  }
  flush();
  return chunks;
}
