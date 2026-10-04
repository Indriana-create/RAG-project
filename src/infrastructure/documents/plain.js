import { ValidationError } from '../../domain/errors.js';

/** Teks polos (.txt/.md/.csv): UTF-8, atau UTF-16 bila ada BOM. File biner ditolak. */
export function extractPlain(buffer) {
  let text;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.toString('utf16le', 2);
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) text = Buffer.from(buffer.subarray(2, 2 + ((buffer.length - 2) & ~1))).swap16().toString('utf16le');
  else {
    if (buffer.includes(0)) throw new ValidationError('File ini tampaknya bukan teks (berisi data biner).');
    text = buffer.toString('utf8');
  }
  return { text: text.replace(/^﻿/, '') };
}
