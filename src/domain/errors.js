export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}

export class NotFoundError extends Error {
  constructor(message = 'Data tidak ditemukan') { super(message); this.name = 'NotFoundError'; }
}

/** Layanan luar (LLM lokal, embedding) tidak tersedia / membalas error. */
export class UpstreamError extends Error {
  constructor(message) { super(message); this.name = 'UpstreamError'; }
}

/** Kredensial salah / sesi tidak valid. */
export class AuthenticationError extends Error {
  constructor(message = 'Username atau password salah') { super(message); this.name = 'AuthenticationError'; }
}

/** Data bertabrakan dengan yang sudah ada (mis. username kembar). */
export class ConflictError extends Error {
  constructor(message) { super(message); this.name = 'ConflictError'; }
}

/** Terlalu banyak percobaan login; coba lagi setelah `retryAfterSeconds`. */
export class TooManyAttemptsError extends Error {
  constructor(retryAfterSeconds) {
    super('Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.');
    this.name = 'TooManyAttemptsError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
