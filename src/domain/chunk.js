/** Potongan teks dari sebuah dokumen — unit yang diindeks & diambil (retrieval). */
export function createChunk({ documentId, title, index, text }) {
  if (!text || !text.trim()) throw new Error('Chunk tidak boleh kosong');
  return Object.freeze({ id: `${documentId}#${index}`, documentId, title, index, text: text.trim() });
}

/**
 * Aturan domain: memecah dokumen menjadi chunk per paragraf,
 * digabung sampai mendekati `maxChars`.
 */
export function chunkDocument(doc, maxChars = 600) {
  const paragraphs = doc.content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
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
