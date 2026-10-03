import { ValidationError } from './errors.js';

export const MAX_URL_LENGTH = 2048;
export const CRAWL_LIMITS = Object.freeze({ defaultPages: 10, maxPages: 20 });

const SKIPPED_EXTENSIONS = /\.(?:jpe?g|png|gif|webp|svg|ico|bmp|avif|mp[34]|webm|mov|avi|zip|gz|tar|rar|7z|css|js|mjs|json|xml|rss|woff2?|ttf|eot|exe|dmg|apk|pdf|docx?|pptx?|xlsx?)$/i;
const SKIPPED_PATHS = /\/(?:wp-admin|wp-login|login|logout|signin|signup|register|cart|checkout|account|feed)(?:\/|$)/i;

/** Alamat web yang boleh diambil: http/https, tanpa kredensial. Tanpa skema dianggap https. */
export function parseWebUrl(input) {
  let text = typeof input === 'string' ? input.trim() : '';
  if (!text) throw new ValidationError('Alamat web (URL) wajib diisi');
  if (text.length > MAX_URL_LENGTH) throw new ValidationError(`URL maksimal ${MAX_URL_LENGTH} karakter`);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url;
  try { url = new URL(text); } catch { throw new ValidationError('URL tidak valid'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ValidationError('Hanya alamat http:// atau https:// yang didukung');
  if (url.username || url.password) throw new ValidationError('URL tidak boleh memuat username/password');
  if (!url.hostname) throw new ValidationError('URL tidak valid');
  url.hash = '';
  return url;
}

const siteKey = (url) => url.hostname.toLowerCase().replace(/^www\./, '');

/** Kunci untuk membuang duplikat: tanpa fragmen dan tanpa garis miring penutup. */
export const pageKey = (url) => `${siteKey(url)}${url.pathname.replace(/\/+$/, '') || '/'}${url.search}`;

/**
 * Memilih tautan yang layak dijelajahi dari sebuah halaman: situs yang sama (www dianggap sama), bukan berkas
 * media/skrip, bukan halaman akun/keranjang, tanpa duplikat. Urutan kemunculan dipertahankan.
 */
export function pickSiteLinks(links, baseUrl, limit) {
  const base = parseWebUrl(String(baseUrl));
  const seen = new Set([pageKey(base)]);
  const picked = [];
  for (const raw of links) {
    if (picked.length >= limit) break;
    let url;
    try { url = parseWebUrl(raw); } catch { continue; }
    if (siteKey(url) !== siteKey(base)) continue;
    if (SKIPPED_EXTENSIONS.test(url.pathname) || SKIPPED_PATHS.test(url.pathname)) continue;
    const key = pageKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(url.toString());
  }
  return picked;
}
