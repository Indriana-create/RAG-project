const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Membaca berkas pertanyaan: baris "+ ..." (harus ketemu), "- ..." (tidak boleh ketemu); "#" dan baris kosong diabaikan. */
export function parseQuestions(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line, i) => {
    const match = /^([+-])\s*(.+)$/.exec(line);
    if (!match) throw new Error(`Baris ${i + 1} harus diawali "+" atau "-": ${line}`);
    return { relevant: match[1] === '+', question: match[2] };
  });
}

/**
 * Menentukan ambang MIN_SCORE dari skor teratas tiap pertanyaan.
 * Biaya: pertanyaan sah yang ditolak (FN) dihitung 2x lebih mahal daripada pertanyaan tak relevan yang lolos (FP),
 * karena LLM masih bisa menolak informasi yang tidak nyambung, tetapi tidak bisa menjawab yang tidak pernah sampai kepadanya.
 */
export function analyze(rows) {
  const positives = rows.filter((r) => r.relevant);
  const negatives = rows.filter((r) => !r.relevant);
  if (!positives.length || !negatives.length) throw new Error('Butuh minimal satu pertanyaan "+" dan satu pertanyaan "-".');

  const scores = [...new Set(rows.map((r) => r.top))].sort((a, b) => a - b);
  const candidates = [scores[0] - 0.01, ...scores.slice(1).map((s, i) => (scores[i] + s) / 2), scores.at(-1) + 0.01];
  const evaluate = (threshold) => {
    const missed = positives.filter((r) => r.top < threshold);
    const leaked = negatives.filter((r) => r.top >= threshold);
    return { threshold, missed, leaked, cost: missed.length * 2 + leaked.length };
  };
  const evaluated = candidates.map(evaluate);
  const best = Math.min(...evaluated.map((e) => e.cost));
  const ties = evaluated.filter((e) => e.cost === best);
  const chosen = ties[Math.floor(ties.length / 2)]; // tengah dari semua ambang yang sama baiknya (paling jauh dari tepi)

  const minPositive = Math.min(...positives.map((r) => r.top));
  const maxNegative = Math.max(...negatives.map((r) => r.top));
  return {
    threshold: Math.round(chosen.threshold * 100) / 100,
    separable: minPositive > maxNegative,
    margin: Math.round((minPositive - maxNegative) * 1000) / 1000,
    missed: chosen.missed,
    leaked: chosen.leaked,
    positive: { min: minPositive, median: median(positives.map((r) => r.top)) },
    negative: { max: maxNegative, median: median(negatives.map((r) => r.top)) },
  };
}
