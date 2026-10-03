import { ValidationError } from './errors.js';

export const LIMITS = Object.freeze({ title: 120, content: 500_000, fileBytes: 10 * 1024 * 1024 });

/** Dokumen pengetahuan yang bisa dikelola admin; hanya yang `enabled` yang dipakai chatbot. */
export function createKnowledgeDocument({ id, title, content, enabled = true, createdAt, updatedAt }) {
  const t = typeof title === 'string' ? title.trim() : '';
  const c = typeof content === 'string' ? content.trim() : '';
  if (!id) throw new ValidationError('id wajib diisi');
  if (!t) throw new ValidationError('Judul wajib diisi');
  if (t.length > LIMITS.title) throw new ValidationError(`Judul maksimal ${LIMITS.title} karakter`);
  if (!c) throw new ValidationError('Isi dokumen tidak boleh kosong');
  if (c.length > LIMITS.content) throw new ValidationError(`Isi dokumen maksimal ${LIMITS.content} karakter`);
  if (typeof enabled !== 'boolean') throw new ValidationError('enabled harus berupa true/false');
  return Object.freeze({ id, title: t, content: c, enabled, createdAt, updatedAt });
}

export const summarize = (doc) => ({
  id: doc.id, title: doc.title, enabled: doc.enabled, chars: doc.content.length,
  createdAt: doc.createdAt, updatedAt: doc.updatedAt,
});
