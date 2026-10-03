import { UpstreamError } from '../../domain/errors.js';

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Mengulang `fn` hanya untuk kegagalan layanan luar (UpstreamError); kesalahan konfigurasi/logika langsung dilempar. */
export async function retryUpstream(fn, { attempts = 1, delayMs = 1000, onRetry, sleep = sleepMs } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof UpstreamError) || attempt >= attempts) throw err;
      onRetry?.(err, attempt);
      await sleep(delayMs);
    }
  }
}
