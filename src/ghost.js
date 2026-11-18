// Ghost replays: record the current run at 20 Hz, save it when it's a new
// best, and play the best run back as a translucent car on later attempts.

const HZ = 20;
const KEY = (seed) => `sideways.ghost.${seed}`;
const INDEX = 'sideways.ghosts';
const MAX_GHOSTS = 40;

export class GhostRecorder {
  constructor() { this.reset(); }
  reset() { this.samples = []; this.nextT = 0; }
  // t = run clock (s). Records position, yaw and body pitch/roll.
  record(t, car) {
    if (t + 1e-6 < this.nextT) return;
    this.nextT = t + 1 / HZ;
    this.samples.push([t, car.x, car.y ?? 0, car.z, car.yaw, car.groundPitch || 0, car.groundRoll || 0]);
  }
}

// Compact storage: fixed-point ints, delta-encoded.
const SCALE = [100, 20, 20, 20, 1000, 1000, 1000];
function encode(samples) {
  const out = [];
  const prev = SCALE.map(() => 0);
  for (const s of samples) {
    for (let k = 0; k < SCALE.length; k++) {
      const v = Math.round(s[k] * SCALE[k]);
      out.push(v - prev[k]);
      prev[k] = v;
    }
  }
  return out;
}
function decode(arr) {
  const n = SCALE.length, samples = [];
  const prev = SCALE.map(() => 0);
  for (let i = 0; i + n <= arr.length; i += n) {
    const s = [];
    for (let k = 0; k < n; k++) { prev[k] += arr[i + k]; s.push(prev[k] / SCALE[k]); }
    samples.push(s);
  }
  return samples;
}

// For sharing: half the sample rate (10 Hz) keeps long stages small, and
// the result is plain numbers so it can be checked when read back.
export function packGhost(samples) { return encode(samples.filter((_, i) => i % 2 === 0)); }
export function unpackGhost(d) {
  if (!Array.isArray(d) || d.length > 200000 || d.length % SCALE.length) return null;
  if (!d.every((v) => Number.isFinite(v) && Math.abs(v) < 1e7)) return null;
  const samples = decode(d);
  return samples.length > 10 ? samples : null;
}

export function saveGhost(seed, { car, color, time, samples }) {
  try {
    localStorage.setItem(KEY(seed), JSON.stringify({ v: 1, car, color, time, d: encode(samples) }));
    // Keep an LRU list so old stages' ghosts get cleared out.
    let list = JSON.parse(localStorage.getItem(INDEX) || '[]').filter((s) => s !== seed);
    list.push(seed);
    while (list.length > MAX_GHOSTS) localStorage.removeItem(KEY(list.shift()));
    localStorage.setItem(INDEX, JSON.stringify(list));
    return true;
  } catch { return false; }   // storage full or blocked: run still counts, just no ghost
}

export function loadGhost(seed) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(seed)) || 'null');
    if (!raw || raw.v !== 1) return null;
    return { car: raw.car, color: raw.color, time: raw.time, samples: decode(raw.d) };
  } catch { return null; }
}

// Pose at time t (linear interpolation; yaw takes the short way round).
export function samplePose(samples, t, out) {
  if (!samples.length) return null;
  if (t <= samples[0][0]) { setPose(out, samples[0], samples[0], 0); return out; }
  const last = samples[samples.length - 1];
  if (t >= last[0]) { setPose(out, last, last, 0); out.done = true; return out; }
  // Binary search for the bracketing samples.
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid][0] <= t) lo = mid; else hi = mid; }
  const a = samples[lo], b = samples[hi];
  const span = b[0] - a[0];
  // A gap (e.g. a respawn penalty) jumps rather than sliding across the map.
  const f = span > 0.5 ? 0 : (t - a[0]) / (span || 1);
  setPose(out, a, b, f);
  out.done = false;
  return out;
}
function setPose(out, a, b, f) {
  out.x = a[1] + (b[1] - a[1]) * f;
  out.y = a[2] + (b[2] - a[2]) * f;
  out.z = a[3] + (b[3] - a[3]) * f;
  let dy = b[4] - a[4];
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  out.yaw = a[4] + dy * f;
  out.pitch = a[5] + (b[5] - a[5]) * f;
  out.roll = a[6] + (b[6] - a[6]) * f;
}
