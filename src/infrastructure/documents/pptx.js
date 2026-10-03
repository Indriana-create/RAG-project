import { ValidationError } from '../../domain/errors.js';
import { decodeXml } from './xml.js';
import { openZip } from './zip.js';

const FIELD = /<a:fld\b[^>]*>[\s\S]*?<\/a:fld>/g; // nomor slide, tanggal otomatis: bukan isi
const PARAGRAPH = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
const RUN = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<a:br\s*\/>/g;

function paragraphs(xml) {
  const out = [];
  for (const p of xml.replace(FIELD, '').matchAll(PARAGRAPH)) {
    let line = '';
    for (const r of p[1].matchAll(RUN)) line += r[1] === undefined ? '\n' : decodeXml(r[1]);
    if (line.trim()) out.push(line.trim());
  }
  return out;
}

const relationships = (zip, name) => {
  const xml = zip.read(name)?.toString('utf8') ?? '';
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => ({
    id: /\bId="([^"]*)"/.exec(m[0])?.[1],
    type: /\bType="([^"]*)"/.exec(m[0])?.[1] ?? '',
    target: /\bTarget="([^"]*)"/.exec(m[0])?.[1],
  }));
};

/** Urutan slide sesuai presentation.xml (bukan nomor berkas); cadangan: urut nomor berkas. */
function slideOrder(zip) {
  const ordered = [];
  const presentation = zip.read('ppt/presentation.xml')?.toString('utf8');
  if (presentation) {
    const rels = new Map(relationships(zip, 'ppt/_rels/presentation.xml.rels').map((r) => [r.id, r.target]));
    for (const m of presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]*)"/g)) {
      const target = rels.get(m[1]);
      if (target) ordered.push(`ppt/${target.replace(/^\/?(ppt\/)?/, '')}`);
    }
  }
  const found = ordered.filter((n) => zip.has(n));
  if (found.length) return found;
  return zip.names().filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)) - Number(b.match(/\d+/)));
}

/** Teks dari PPTX: tiap slide diberi judul "Slide N"; catatan pembicara ikut diambil. */
export function extractPptx(buffer) {
  const zip = openZip(buffer);
  const slides = slideOrder(zip);
  if (!slides.length) throw new ValidationError('File ini bukan PPTX yang valid (tidak ada slide).');

  const blocks = [];
  slides.forEach((name, index) => {
    const body = paragraphs(zip.read(name).toString('utf8'));
    const relsName = name.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
    const notesRel = relationships(zip, relsName).find((r) => r.type.endsWith('/notesSlide'));
    const notesFile = notesRel?.target && `ppt/${notesRel.target.replace(/^(\.\.\/)+/, '')}`;
    const notes = notesFile && zip.has(notesFile) ? paragraphs(zip.read(notesFile).toString('utf8')).filter((l) => !/^\d+$/.test(l)) : [];
    if (!body.length && !notes.length) return;
    blocks.push([`## Slide ${index + 1}`, ...body, ...(notes.length ? ['Catatan pembicara:', ...notes] : [])].join('\n'));
  });
  return { text: blocks.join('\n\n'), slides: slides.length };
}
