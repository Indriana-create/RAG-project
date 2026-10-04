import { UpstreamError } from '../../domain/errors.js';

export const joinUrl = (base, path) => `${base.replace(/\/+$/, '')}${path}`;

/** POST JSON ke layanan OpenAI-compatible; error jaringan/HTTP dibungkus UpstreamError. */
export async function postJson(url, { headers = {}, body, signal, timeoutMs, fetchImpl = fetch, what }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (err) {
    if (signal?.aborted) throw err; // klien memutus koneksi: bukan kesalahan layanan
    const reason = err.name === 'TimeoutError' ? `melebihi batas waktu ${timeoutMs} ms` : (err.cause?.code ?? err.message);
    throw new UpstreamError(`${what} tidak dapat dihubungi di ${url}: ${reason}`);
  }
  if (!res.ok) throw new UpstreamError(`${what} membalas ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res;
}

export const authHeaders = (apiKey) => (apiKey ? { authorization: `Bearer ${apiKey}` } : {});
