import { inflateRawSync } from 'node:zlib';
import { ValidationError } from '../../domain/errors.js';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const bad = () => new ValidationError('File rusak atau bukan arsip Office yang valid (DOCX/PPTX).');

/**
 * Pembaca ZIP minimal (cukup untuk DOCX/PPTX): metode simpan/deflate, tanpa enkripsi dan ZIP64.
 * `maxEntryBytes` / `maxTotalBytes` melindungi dari "zip bomb": ukuran hasil dekompresi dibatasi saat dibaca,
 * bukan berdasarkan angka yang diklaim di header.
 */
export function openZip(buffer, { maxEntryBytes = 20 * 1024 * 1024, maxTotalBytes = 60 * 1024 * 1024 } = {}) {
  if (buffer.length < 22) throw bad();
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw bad();
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new ValidationError('Arsip ZIP64 tidak didukung.');

  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL) throw bad();
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (flags & 1) throw new ValidationError('File dilindungi password; buka dulu lalu simpan tanpa password.');
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  let total = 0;
  return {
    has: (name) => entries.has(name),
    names: () => [...entries.keys()],
    /** Isi satu berkas di dalam arsip sebagai Buffer (undefined bila tidak ada). */
    read(name) {
      const entry = entries.get(name);
      if (!entry) return undefined;
      const { method, compressedSize, localOffset } = entry;
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL) throw bad();
      const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
      const raw = buffer.subarray(start, start + compressedSize);
      if (raw.length !== compressedSize) throw bad();
      let data;
      if (method === 0) data = raw;
      else if (method === 8) {
        try {
          data = inflateRawSync(raw, { maxOutputLength: maxEntryBytes });
        } catch (err) {
          if (err.code === 'ERR_BUFFER_TOO_LARGE') throw new ValidationError('Isi file terlalu besar setelah dibuka (kemungkinan file tidak wajar).');
          throw bad();
        }
      } else throw bad();
      if (data.length > maxEntryBytes) throw new ValidationError('Isi file terlalu besar setelah dibuka (kemungkinan file tidak wajar).');
      total += data.length;
      if (total > maxTotalBytes) throw new ValidationError('Isi file terlalu besar setelah dibuka (kemungkinan file tidak wajar).');
      return data;
    },
  };
}
