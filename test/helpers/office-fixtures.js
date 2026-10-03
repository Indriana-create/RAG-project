import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Membuat arsip ZIP di memori (untuk DOCX/PPTX uji). `flags` mengatur bit enkripsi untuk menguji penolakan. */
export function makeZip(files, { deflate = true, flags = 0 } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = deflate ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(deflate ? 8 : 0, 10); central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** DOCX uji. Blok: string = paragraf; {table: [[sel, ...], ...]} = tabel; {raw: xml} = XML mentah. */
export function makeDocx(blocks) {
  const paragraph = (text) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${String(text).split('\t').map((part, i) => `${i ? '<w:r><w:tab/></w:r>' : ''}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(part)}</w:t></w:r>`).join('')}</w:p>`;
  const body = blocks.map((b) => {
    if (typeof b === 'string') return paragraph(b);
    if (b.raw) return b.raw;
    return `<w:tbl><w:tblPr><w:tblW w:w="0"/></w:tblPr>${b.table.map((row) => `<w:tr><w:trPr/>${row.map((cell) => `<w:tc><w:tcPr/>${paragraph(cell)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
  }).join('');
  return makeZip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`,
  });
}

/**
 * PPTX uji. `slides[i] = { paras: [...], notes: [...] }` disimpan sebagai slide{i+1}.xml;
 * `order` (nomor 1-based) menentukan urutan di presentation.xml (bawaan: urut).
 */
export function makePptx(slides, { order = slides.map((_, i) => i + 1) } = {}) {
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const shape = (paras) => `<p:sp><p:txBody>${paras.map((t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'ppt/presentation.xml': `<p:presentation ${A}><p:sldIdLst>${order.map((n, i) => `<p:sldId id="${256 + i}" r:id="rId${n}"/>`).join('')}</p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<Relationships>${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`,
  };
  slides.forEach((slide, i) => {
    const n = i + 1;
    files[`ppt/slides/slide${n}.xml`] = `<p:sld ${A}><p:cSld><p:spTree>${shape(slide.paras ?? [])}<p:sp><p:txBody><a:p><a:fld id="{1}" type="slidenum"><a:t>‹#›</a:t></a:fld></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    if (slide.notes?.length) {
      files[`ppt/notesSlides/notesSlide${n + 10}.xml`] = `<p:notes ${A}><p:cSld><p:spTree>${shape(slide.notes)}${shape([String(n)])}</p:spTree></p:cSld></p:notes>`;
      files[`ppt/slides/_rels/slide${n}.xml.rels`] = `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${n + 10}.xml"/></Relationships>`;
    }
  });
  return makeZip(files);
}

/** PDF uji berisi teks (font standar Helvetica). `pages[i]` = baris; `null` = jarak antarparagraf. */
export function makePdf(pages) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PLACEHOLDER'); // diganti setelah daftar halaman diketahui
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (const lines of pages) {
    let stream = 'BT /F1 12 Tf 72 740 Td 14 TL\n';
    for (const line of lines) stream += line === null ? '0 -26 Td\n' : `(${String(line).replace(/([\\()])/g, '\\$1')}) Tj 0 -14 Td\n`;
    stream += 'ET';
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
