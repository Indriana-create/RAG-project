export const SESSION_COOKIE = 'rag_session';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name && !(name in cookies)) {
      try { cookies[name] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* cookie rusak: abaikan */ }
    }
  }
  return cookies;
}

const firstValue = (header) => String(header ?? '').split(',')[0].trim();

/** Alamat klien. Header proxy (Cloudflare) hanya dipercaya bila `trustProxy` aktif. */
export function clientIp(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const forwarded = firstValue(req.headers['cf-connecting-ip']) || firstValue(req.headers['x-forwarded-for']);
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Cookie `Secure` hanya bila koneksi memang HTTPS (langsung, atau lewat proxy terpercaya). */
export function isSecureRequest(req, { trustProxy = false, cookieSecure = 'auto' } = {}) {
  if (cookieSecure === 'true') return true;
  if (cookieSecure === 'false') return false;
  if (req.socket.encrypted) return true;
  return trustProxy && firstValue(req.headers['x-forwarded-proto']).toLowerCase() === 'https';
}

export function sessionCookie(token, { secure, maxAgeSeconds }) {
  const attrs = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export const clearedSessionCookie = ({ secure }) => sessionCookie('', { secure, maxAgeSeconds: 0 });

/**
 * Proteksi CSRF untuk permintaan yang mengubah data. Browser menyertakan `Sec-Fetch-Site`; hanya
 * `same-origin`/`none` diterima (subdomain lain = `same-site` ikut ditolak). Tanpa header itu, `Origin`
 * dibandingkan dengan Host. Klien non-browser (curl, n8n) tidak mengirim keduanya dan tidak membawa cookie korban.
 */
export function isCrossSiteWrite(req, { trustProxy = false } = {}) {
  if (!UNSAFE.has(req.method)) return false;
  const site = req.headers['sec-fetch-site'];
  if (site) return !(site === 'same-origin' || site === 'none');
  const origin = req.headers.origin;
  if (!origin) return false;
  const hosts = [req.headers.host, trustProxy ? firstValue(req.headers['x-forwarded-host']) : undefined].filter(Boolean);
  try { return !hosts.includes(new URL(origin).host); } catch { return true; }
}
