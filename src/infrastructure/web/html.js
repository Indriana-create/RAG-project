/**
 * Pengubah HTML → teks tanpa dependensi, untuk halaman situs biasa (company profile, FAQ, blog).
 * Strategi: buang skrip/gaya, utamakan <main>/<article>, buang navigasi/footer/form, lalu ubah struktur
 * (judul, daftar, tabel, paragraf) menjadi teks bergaya Markdown agar pemecah paragraf bekerja baik.
 * Batasan: halaman yang kontennya dibuat lewat JavaScript (SPA) tidak terbaca.
 */
const NAMED = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', bull: '•', middot: '·', euro: '€',
  pound: '£', yen: '¥', deg: '°', times: '×', eacute: 'é', egrave: 'è', agrave: 'à', aacute: 'á', iacute: 'í', oacute: 'ó',
  uacute: 'ú', ccedil: 'ç', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß',
};

export function decodeHtml(text) {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g, (whole, dec, hex, name) => {
    if (name) return NAMED[name] ?? NAMED[name.toLowerCase()] ?? whole;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const DROP_BLOCKS = /<(script|style|noscript|svg|template|iframe|object|embed|canvas|head|dialog)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BOILERPLATE = /<(nav|footer|aside|form|select|button|menu)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BREAK = '\u0001';      // satu baris baru
const PARAGRAPH = '\u0002';  // baris kosong
const CELL = '\u0003';       // pemisah sel tabel

const BLOCK_PARAGRAPH = new Set(['p', 'ul', 'ol', 'table', 'blockquote', 'pre', 'section', 'article', 'main', 'header', 'figure', 'details', 'dl', 'address', 'hr']);
const BLOCK_BREAK = new Set(['div', 'li', 'tr', 'dt', 'dd', 'figcaption', 'summary', 'caption', 'fieldset', 'legend', 'br', 'thead', 'tbody', 'tfoot']);

function textOf(fragment) {
  const out = fragment.replace(TAG, (_, closing, rawName) => {
    const name = rawName.toLowerCase();
    const heading = /^h([1-6])$/.exec(name);
    if (heading) return closing ? PARAGRAPH : `${PARAGRAPH}${'#'.repeat(Number(heading[1]))} `;
    if (name === 'li') return closing ? BREAK : `${BREAK}- `;
    if (name === 'td' || name === 'th') return closing ? CELL : '';
    if (BLOCK_PARAGRAPH.has(name)) return PARAGRAPH;
    if (BLOCK_BREAK.has(name)) return BREAK;
    return '';
  });
  return decodeHtml(out)
    .replace(/[ \t\r\n\f ]+/g, ' ')
    .replace(new RegExp(` ?${CELL} ?`, 'g'), ' | ')
    .replace(new RegExp(` ?\\| ?(?=[${BREAK}${PARAGRAPH}]|$)`, 'g'), '')
    .replace(new RegExp(` ?${PARAGRAPH}[${BREAK}${PARAGRAPH} ]*`, 'g'), '\n\n')
    .replace(new RegExp(` ?${BREAK}[${BREAK} ]*`, 'g'), '\n')
    .split('\n').map((line) => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstMatch(html, regex) {
  const m = regex.exec(html);
  return m ? decodeHtml(textOf(m[1])).trim() : '';
}

function pageTitle(html) {
  const og = /<meta\b[^>]*\bproperty\s*=\s*["']og:title["'][^>]*\bcontent\s*=\s*"([^"]*)"|<meta\b[^>]*\bcontent\s*=\s*"([^"]*)"[^>]*\bproperty\s*=\s*["']og:title["']/i.exec(html);
  const fromOg = og ? decodeHtml(og[1] ?? og[2] ?? '').trim() : '';
  return fromOg || firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i) || firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
}

/** Semua tautan <a href> pada halaman, sudah diubah menjadi alamat absolut. */
export function extractLinks(html, pageUrl) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const base = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(clean)?.[1];
  let root = pageUrl;
  try { if (base) root = new URL(decodeHtml(base), pageUrl).toString(); } catch { /* base rusak: abaikan */ }
  const links = [];
  for (const m of clean.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = decodeHtml((m[1] ?? m[2] ?? m[3] ?? '').trim());
    if (!href || href.startsWith('#') || /^(?:javascript|mailto|tel|sms|data):/i.test(href)) continue;
    try { links.push(new URL(href, root).toString()); } catch { /* tautan rusak: lewati */ }
  }
  return links;
}

/** @returns {{title: string, text: string}} */
export function htmlToText(html) {
  const source = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const title = pageTitle(source);
  const body = source.replace(DROP_BLOCKS, '');
  const bodyOnly = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(body)?.[1] ?? body;

  // Utamakan area isi utama bila cukup panjang; jika tidak, pakai seluruh badan halaman tanpa navigasi/footer.
  const regions = [...bodyOnly.matchAll(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map((m) => textOf(m[2].replace(BOILERPLATE, '')));
  const main = regions.join('\n\n').trim();
  const text = main.length >= 200 ? main : textOf(bodyOnly.replace(BOILERPLATE, ''));
  return { title, text };
}
