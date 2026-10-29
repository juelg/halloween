// localStorage wrapped so private mode / blocked storage never crashes the robot.
export const store = {
  get(k, dflt) {
    try {
      const v = localStorage.getItem('robot.' + k);
      return v === null ? dflt : JSON.parse(v);
    } catch {
      return dflt;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('robot.' + k, JSON.stringify(v));
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem('robot.' + k);
    } catch {}
  },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function randomId(len = 24) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

export function weightedPick(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) if ((r -= w) <= 0) return k;
  return entries[entries.length - 1][0];
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Sliding-window rate limiter.
export class RateLimit {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = [];
  }
  take() {
    const now = Date.now();
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length >= this.max) return false;
    this.hits.push(now);
    return true;
  }
}
