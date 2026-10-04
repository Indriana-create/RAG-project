import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { ValidationError } from '../../domain/errors.js';
import { parseWebUrl } from '../../domain/web-url.js';
import { PERMISSIVE_POLICY, STRICT_POLICY } from './address-policy.js';

const USER_AGENT = 'LumiAssistBot/1.0 (impor knowledge oleh admin)';
const MAX_REDIRECTS = 5;

/**
 * Pengambil halaman web yang aman dari SSRF:
 *  - alamat tujuan diperiksa PADA SAAT KONEKSI (lookup kustom), jadi tidak ada celah DNS-rebinding;
 *  - setiap pengalihan (redirect) diperiksa ulang dari awal (skema, port, alamat);
 *  - ukuran (termasuk setelah dekompresi) dan waktu dibatasi; tanpa cookie/kredensial dan tanpa keep-alive.
 */
export class SafeFetcher {
  constructor({ allowPrivate = false, policy, maxBytes = 10 * 1024 * 1024, timeoutMs = 10_000, lookup = dns.lookup } = {}) {
    Object.assign(this, { policy: policy ?? (allowPrivate ? PERMISSIVE_POLICY : STRICT_POLICY), maxBytes, timeoutMs, lookup });
  }

  /** @returns {Promise<{url: string, status: number, contentType: string, body: Buffer}>} url = alamat akhir setelah redirect */
  async fetch(input, { signal } = {}) {
    let url = parseWebUrl(input);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const res = await this.#once(url, signal);
      if (res.status >= 300 && res.status < 400 && res.location) {
        res.discard();
        try { url = parseWebUrl(new URL(res.location, url).toString()); } catch { throw new ValidationError('Situs mengalihkan ke alamat yang tidak valid'); }
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        res.discard();
        throw new ValidationError(`Halaman tidak bisa dibuka (status ${res.status})`);
      }
      return { url: url.toString(), status: res.status, contentType: res.contentType, body: await res.read() };
    }
    throw new ValidationError('Terlalu banyak pengalihan (redirect)');
  }

  #checkTarget(url) {
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
    if (!this.policy.port(port)) throw new ValidationError('Port alamat ini tidak diizinkan (gunakan port 80/443)');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !this.policy.address(host)) throw new ValidationError('Alamat ini tidak diizinkan (jaringan internal/privat)');
  }

  /** `lookup` untuk koneksi: hanya mengembalikan alamat yang lolos kebijakan, sehingga koneksi tidak bisa ke tempat lain. */
  #guardedLookup = (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? {} : options;
    this.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return done(err);
      const allowed = addresses.filter((a) => this.policy.address(a.address));
      if (!allowed.length) return done(Object.assign(new Error('blocked'), { code: 'ERR_BLOCKED_ADDRESS' }));
      return opts.all ? done(null, allowed) : done(null, allowed[0].address, allowed[0].family);
    });
  };

  #once(url, signal) {
    this.#checkTarget(url);
    const transport = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const fail = (err) => {
        if (err instanceof ValidationError) return reject(err);
        if (err?.code === 'ERR_BLOCKED_ADDRESS') return reject(new ValidationError('Alamat ini tidak diizinkan (jaringan internal/privat)'));
        if (signal?.aborted) return reject(Object.assign(new Error('Dibatalkan'), { name: 'AbortError' }));
        if (err?.code === 'ENOTFOUND' || err?.code === 'EAI_AGAIN') return reject(new ValidationError('Nama situs tidak ditemukan'));
        if (err?.code === 'ETIMEDOUT' || err?.message === 'timeout') return reject(new ValidationError('Situs terlalu lama membalas'));
        return reject(new ValidationError('Situs tidak bisa dijangkau'));
      };
      const req = transport.request(url, {
        method: 'GET',
        agent: false,
        lookup: this.#guardedLookup,
        timeout: this.timeoutMs,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain,application/pdf;q=0.8,*/*;q=0.5', 'accept-encoding': 'gzip, deflate, br', 'accept-language': 'id,en;q=0.8' },
        signal,
      });
      const deadline = setTimeout(() => req.destroy(new Error('timeout')), this.timeoutMs * 2);
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (err) => { clearTimeout(deadline); fail(err); });
      req.on('response', (res) => {
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase().trim();
        const location = typeof res.headers.location === 'string' ? res.headers.location : undefined;
        resolve({
          status: res.statusCode,
          location,
          contentType: String(res.headers['content-type'] ?? '').toLowerCase(),
          discard: () => { clearTimeout(deadline); res.destroy(); },
          read: async () => {
            let overflow = false;
            try {
              const declared = Number(res.headers['content-length']);
              if (Number.isFinite(declared) && declared > this.maxBytes && !encoding) throw tooBig(this.maxBytes);
              const decoder = { gzip: createGunzip, 'x-gzip': createGunzip, deflate: createInflate, br: createBrotliDecompress }[encoding];
              if (encoding && encoding !== 'identity' && !decoder) throw new ValidationError('Situs memakai pengkodean isi yang tidak didukung');
              const chunks = [];
              let size = 0;
              const counter = async function* count(source, max) {
                for await (const chunk of source) {
                  size += chunk.length;
                  if (size > max) { overflow = true; throw tooBig(max); }
                  chunks.push(chunk);
                  yield chunk;
                }
              };
              const stages = [res, ...(decoder ? [decoder()] : []), (source) => counter(source, this.maxBytes), async (source) => { for await (const _ of source) { /* dikumpulkan di counter */ } }];
              await pipeline(...stages);
              return Buffer.concat(chunks);
            } catch (err) {
              res.destroy();
              if (overflow) throw tooBig(this.maxBytes); // pipeline bisa melaporkan galat lain (AbortError) setelah aliran dihentikan
              if (err instanceof ValidationError) throw err;
              if (err?.name === 'AbortError' || signal?.aborted) throw Object.assign(new Error('Dibatalkan'), { name: 'AbortError' });
              throw new ValidationError('Isi halaman tidak bisa dibaca sampai selesai');
            } finally { clearTimeout(deadline); }
          },
        });
      });
      req.end();
    });
  }
}

const tooBig = (max) => new ValidationError(`Halaman terlalu besar (maksimal ${Math.round(max / 1024 / 1024)} MB)`);
