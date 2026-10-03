import { ValidationError } from '../../domain/errors.js';
import { decodeXml } from './xml.js';
import { openZip } from './zip.js';

// Token yang kita pedulikan di word/document.xml: tabel/baris/sel/paragraf, teks, tab, dan pindah baris.
const TOKEN = /<(\/?)w:(tbl|tr|tc|p)\b[^>]*?(\/?)>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\b[^>]*\/>/g;

/** Teks dari DOCX: paragraf dipisah baris kosong; baris tabel menjadi "sel | sel | sel". */
export function extractDocx(buffer) {
  const zip = openZip(buffer);
  const xml = zip.read('word/document.xml');
  if (!xml) throw new ValidationError('File ini bukan DOCX yang valid (word/document.xml tidak ada).');

  const doc = [];                         // blok tingkat atas
  const stack = [{ kind: 'doc', blocks: doc }];
  let paragraph = null;
  const container = () => stack[stack.length - 1];
  const push = (block) => {
    const top = container();
    if (top.kind === 'cell') top.parts.push(block); else if (top.kind === 'doc') top.blocks.push(block);
  };

  for (const m of xml.toString('utf8').matchAll(TOKEN)) {
    const [token, closing, tag, selfClosing, text] = m;
    if (text !== undefined) { if (paragraph !== null) paragraph += decodeXml(text); continue; }
    if (!tag) { if (paragraph !== null) paragraph += token.startsWith('<w:tab') ? '\t' : '\n'; continue; }

    if (tag === 'p') {
      if (closing) { if (paragraph !== null) { push(paragraph.trim()); paragraph = null; } } else if (!selfClosing) paragraph = '';
    } else if (tag === 'tbl') {
      if (closing) { const t = stack.pop(); if (t?.kind === 'table') push(t.rows.join('\n')); } else stack.push({ kind: 'table', rows: [] });
    } else if (tag === 'tr') {
      if (closing) { const r = stack.pop(); if (r?.kind === 'row') { const line = r.cells.join(' | ').trim(); if (line.replace(/[|\s]/g, '')) stack[stack.length - 1].rows?.push(line); } } else stack.push({ kind: 'row', cells: [] });
    } else if (tag === 'tc') {
      if (closing) { const c = stack.pop(); if (c?.kind === 'cell') stack[stack.length - 1].cells?.push(c.parts.filter(Boolean).join(' ')); } else stack.push({ kind: 'cell', parts: [] });
    }
  }
  return { text: doc.filter(Boolean).join('\n\n') };
}
