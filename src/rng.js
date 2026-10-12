// Seeded randomness. Everything stage-related must use this, never Math.random.

export function mulberry32(seed) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rand.range = (lo, hi) => lo + (hi - lo) * rand();
  rand.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * rand());
  rand.pick = (arr) => arr[Math.floor(rand() * arr.length)];
  rand.sign = () => (rand() < 0.5 ? -1 : 1);
  return rand;
}

// YYYYMMDD as a number, in the player's local time zone.
export function dateSeed(d = new Date()) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

export function seedToDate(seed) {
  const y = Math.floor(seed / 10000), m = Math.floor(seed / 100) % 100, d = seed % 100;
  return new Date(y, m - 1, d);
}

// Smooth 1D value noise from a seed, used for elevation.
export function noise1D(rand, count = 64) {
  const v = Array.from({ length: count }, () => rand() * 2 - 1);
  return (x) => {
    const i = Math.floor(x), f = x - i;
    const a = v[((i % count) + count) % count], b = v[(((i + 1) % count) + count) % count];
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };
}
