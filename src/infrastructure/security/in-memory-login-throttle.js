const DEFAULT_RULES = {
  u: { max: 5, windowMs: 5 * 60_000, lockMs: 5 * 60_000 },   // per akun
  ip: { max: 30, windowMs: 5 * 60_000, lockMs: 5 * 60_000 }, // per alamat IP
};

/** Adapter LoginThrottle di memori. Kunci berawalan `u:` (akun) atau `ip:` (alamat). */
export class InMemoryLoginThrottle {
  #entries = new Map();

  constructor({ rules = DEFAULT_RULES, now = () => Date.now() } = {}) { Object.assign(this, { rules, now }); }

  #rule(key) { return this.rules[key.split(':', 1)[0]]; }

  retryAfter(keys) {
    const now = this.now();
    let wait = 0;
    for (const key of keys) {
      const entry = this.#entries.get(key);
      if (entry && entry.lockedUntil > now) wait = Math.max(wait, Math.ceil((entry.lockedUntil - now) / 1000));
    }
    return wait;
  }

  recordFailure(keys) {
    const now = this.now();
    this.#prune(now);
    for (const key of keys) {
      const rule = this.#rule(key);
      if (!rule) continue;
      let entry = this.#entries.get(key);
      if (!entry || now - entry.first > rule.windowMs) entry = { count: 0, first: now, lockedUntil: 0 };
      entry.count += 1;
      if (entry.count >= rule.max) entry.lockedUntil = now + rule.lockMs;
      this.#entries.set(key, entry);
    }
  }

  reset(keys) { for (const key of keys) this.#entries.delete(key); }

  #prune(now) {
    if (this.#entries.size < 5000) return;
    for (const [key, entry] of this.#entries) {
      const rule = this.#rule(key);
      if (!rule || (entry.lockedUntil <= now && now - entry.first > rule.windowMs)) this.#entries.delete(key);
    }
  }
}
