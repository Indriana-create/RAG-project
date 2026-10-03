const OPEN = '<think>';
const CLOSE = '</think>';

/** Panjang akhiran `text` yang merupakan awalan (belum lengkap) dari `tag`. */
function partialSuffixLength(text, tag) {
  for (let k = Math.min(tag.length - 1, text.length); k > 0; k--) {
    if (text.endsWith(tag.slice(0, k))) return k;
  }
  return 0;
}

/** Untuk jawaban utuh: buang blok `<think>…</think>` (blok yang tidak ditutup juga dibuang). */
export const stripThinking = (text) => text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim();

/**
 * Penyaring streaming: membuang blok `<think>…</think>` dari potongan teks, termasuk tag
 * yang terpotong di antara dua potongan. Spasi di awal jawaban dibuang.
 */
export class ThinkFilter {
  #inThink = false;
  #leading = true;
  #buffer = '';

  push(text) {
    this.#buffer += text;
    let out = '';
    for (;;) {
      if (this.#inThink) {
        const end = this.#buffer.indexOf(CLOSE);
        if (end < 0) {
          this.#buffer = this.#buffer.slice(this.#buffer.length - partialSuffixLength(this.#buffer, CLOSE));
          return out;
        }
        this.#buffer = this.#buffer.slice(end + CLOSE.length);
        this.#inThink = false;
        continue;
      }
      const start = this.#buffer.indexOf(OPEN);
      if (start < 0) {
        const keep = partialSuffixLength(this.#buffer, OPEN);
        out += this.#buffer.slice(0, this.#buffer.length - keep);
        this.#buffer = this.#buffer.slice(this.#buffer.length - keep);
        return this.#emit(out);
      }
      out += this.#buffer.slice(0, start);
      this.#buffer = this.#buffer.slice(start + OPEN.length);
      this.#inThink = true;
    }
  }

  /** Sisa teks di akhir stream (potongan yang ternyata bukan tag). */
  flush() {
    const rest = this.#inThink ? '' : this.#buffer;
    this.#buffer = '';
    return this.#emit(rest);
  }

  #emit(text) {
    if (!this.#leading) return text;
    const trimmed = text.trimStart();
    if (trimmed) this.#leading = false;
    return trimmed;
  }
}
