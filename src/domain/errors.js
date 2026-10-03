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
