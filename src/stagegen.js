// Seeded point-to-point stage generator.
//
// A "turtle" walks the road 2 m at a time, laying down segments (straights,
// sweepers, corners, hairpins, chicanes, esses). Each candidate segment is
// checked against everything already laid using a spatial hash; if it would
// come too close to earlier road, it is re-rolled, and if that keeps failing
// the generator backtracks. Elevation comes from a seeded terrain field that
// the scenery also uses, smoothed along the road and grade-limited.
import { mulberry32 } from './rng.js';
import { pickTheme, specialOf, CUSTOM_STAGES } from './themes.js';

const DS = 2;              // metres per sample
const CLEAR = 34;          // min distance between non-neighbouring road parts
const NEIGHBOUR = 48;      // samples (~96 m) that count as "the same bit of road"
const CELL = 24;

// ---------- Seeded 2D value noise (stateless hash, so any point is cheap) ----------
function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sz; // 0..1
}

// Broad landform height (metres). Shared by the road and the terrain.
export function makeBaseHeight(seed, amp = 1) {
  const s = seed | 0;
  return (x, z) => amp * (
    (valueNoise(x / 420, z / 420, s) - 0.5) * 64 +
    (valueNoise(x / 170, z / 170, s + 17) - 0.5) * 22
  );
}

// Rolling hills away from the road (always >= 0 so the road sits in valleys).
export function makeHillHeight(seed, amp = 1) {
  const s = (seed | 0) + 101;
  return (x, z) => {
    const n = valueNoise(x / 120, z / 120, s) * 0.65 + valueNoise(x / 45, z / 45, s + 9) * 0.35;
    return Math.max(0, n - 0.3) * 40 * amp;
  };
}

// ---------- Names ----------
const NAME_A = ['Kar', 'Vel', 'Ost', 'Mira', 'Tal', 'Bru', 'Sen', 'Alt', 'Kor', 'Lun', 'Fen', 'Var', 'Hol', 'Rav', 'Esk', 'Dun', 'Sol', 'Mar', 'Tor', 'Ash'];
const NAME_B = ['vik', 'berg', 'dal', 'moor', 'by', 'wald', 'stad', 'ford', 'heim', 'holt', 'mere', 'lund', 'ness', 'rock'];
export function stageName(seed) {
  if (CUSTOM_STAGES.has(seed)) return CUSTOM_STAGES.get(seed).name || 'Custom stage';
  const r = mulberry32((seed * 2654435761) >>> 0);
  const { theme } = pickTheme(seed);
  return `${r.pick(NAME_A)}${r.pick(NAME_B)} ${r.pick(theme.names)}`;
}

// ---------- Segment library ----------
// Each returns an array of curvatures (1/m, + = left), one per 2 m sample.
function arc(R, angleDeg, dir) {
  const n = Math.max(2, Math.round((R * angleDeg * Math.PI / 180) / DS));
  const ease = Math.min(6, Math.floor(n / 3));
  const out = [];
  for (let i = 0; i < n; i++) {
    let k = dir / R;
    if (i < ease) k *= (i + 1) / (ease + 1);
    else if (i >= n - ease) k *= (n - i) / (ease + 1);
    out.push(k);
  }
  return out;
}
const straight = (len) => new Array(Math.max(1, Math.round(len / DS))).fill(0);

function makeSegment(rand, type, dir) {
  switch (type) {
    case 'straight': return { type, ks: straight(rand.range(30, 110)) };
    // Long straights leave room for a jump with a safe landing.
    case 'longstraight': return { type: 'straight', ks: straight(rand.range(110, 150)) };
    case 'sweeper': return { type, ks: arc(rand.range(70, 160), rand.range(25, 70), dir) };
    case 'corner': return { type, ks: arc(rand.range(26, 48), rand.range(50, 105), dir) };
    case 'hairpin': return { type, ks: [...straight(rand.range(50, 80)), ...arc(rand.range(11, 15), rand.range(160, 185), dir), ...straight(rand.range(16, 30))] };
    case 'chicane': {
      const R = rand.range(24, 38), A = rand.range(35, 55);
      return { type, ks: [...arc(R, A, dir), ...straight(rand.range(4, 12)), ...arc(R, A, -dir)] };
    }
    case 'esses': {
      const ks = [];
      for (let i = 0; i < 3; i++) ks.push(...arc(rand.range(40, 70), rand.range(35, 60), i % 2 ? -dir : dir));
      return { type, ks };
    }
  }
}
const TYPES = [['straight', 0.13], ['longstraight', 0.08], ['sweeper', 0.23], ['corner', 0.22], ['hairpin', 0.1], ['chicane', 0.12], ['esses', 0.12]];
function pickType(rand, prev) {
  for (;;) {
    let r = rand(), t = TYPES[0][0];
    for (const [name, w] of TYPES) { if ((r -= w) <= 0) { t = name; break; } }
    if (t === prev && (t === 'hairpin' || t === 'straight' || t === 'longstraight')) continue;   // no back-to-back
    return t;
  }
}

// ---------- Generator ----------
// Endurance stages (codes 3000000-3999999) run 5-8 km instead of 2-3 km.
export const isEndurance = (seed) => seed >= 3e6 && seed < 4e6;
function tryGenerate(seed, salt) {
  const rand = mulberry32((seed * 7919 + salt * 104729 + 1) >>> 0);
  const target = isEndurance(seed) ? 5000 + rand() * 3000 : 2000 + rand() * 1000;
  const xs = [0], zs = [0], hs = [0];
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const addToGrid = (i) => {
    const k = key(xs[i], zs[i]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  };
  addToGrid(0);

  // Would a point at (x, z) placed as sample `idx` clash with earlier road?
  const clashes = (x, z, idx) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const list = grid.get(`${cx + dx},${cz + dz}`);
      if (!list) continue;
      for (const j of list) {
        if (idx - j < NEIGHBOUR) continue;
        if (Math.hypot(xs[j] - x, zs[j] - z) < CLEAR) return true;
      }
    }
    return false;
  };

  const segs = [];       // {type, start} so we can backtrack
  let goal = 0;          // wandering goal heading keeps the stage from spiralling
  let prevType = 'straight';
  let failures = 0;

  const lay = (ks) => {
    // Simulate first; commit only if clear.
    let x = xs[xs.length - 1], z = zs[zs.length - 1], h = hs[hs.length - 1];
    const nx = [], nz = [], nh = [];
    const base = xs.length;
    for (let i = 0; i < ks.length; i++) {
      h += ks[i] * DS;
      x += Math.sin(h) * DS; z += Math.cos(h) * DS;
      if (clashes(x, z, base + i)) return false;
      // Also check against this segment's own earlier points.
      for (let j = 0; j < i - NEIGHBOUR; j++) if (Math.hypot(nx[j] - x, nz[j] - z) < CLEAR) return false;
      nx.push(x); nz.push(z); nh.push(h);
    }
    for (let i = 0; i < nx.length; i++) { xs.push(nx[i]); zs.push(nz[i]); hs.push(nh[i]); addToGrid(xs.length - 1); }
    return true;
  };
  const removeFrom = (start) => {
    xs.length = zs.length = hs.length = start;
    grid.clear();
    for (let i = 0; i < xs.length; i++) addToGrid(i);
  };

  lay(straight(60));
  segs.push({ type: 'straight', start: 1 });
  while ((xs.length - 1) * DS < target) {
    goal += (rand() - 0.5) * 0.9;
    const h = hs[hs.length - 1];
    const towardGoal = Math.sign(((goal - h + Math.PI * 3) % (Math.PI * 2)) - Math.PI) || 1;
    let placed = false;
    for (let attempt = 0; attempt < 8 && !placed; attempt++) {
      const type = pickType(rand, prevType);
      const dir = rand() < 0.68 ? towardGoal : -towardGoal;
      const seg = makeSegment(rand, type, attempt % 2 ? -dir : dir);
      const start = xs.length;
      if (lay(seg.ks)) { segs.push({ type: seg.type, start }); prevType = type; placed = true; }
    }
    if (!placed) {
      if (++failures > 60 || segs.length < 2) return null;
      const last = segs.pop();
      removeFrom(last.start);
      prevType = segs[segs.length - 1].type;
    }
  }
  if (!lay(straight(70))) return null;   // run-out past the finish

  return { xs, zs, segs };
}

// A player-made stage: its pieces laid end to end, with fixed sizes (no
// randomness, so the same code is always the same road). Jumps and crests
// sit in the middle of their own straights.
const PIECE_KS = {
  s: () => straight(60), S: () => straight(130),
  l: () => arc(110, 50, 1), r: () => arc(110, 50, -1), L: () => arc(36, 80, 1), R: () => arc(36, 80, -1),
  h: () => [...straight(40), ...arc(13, 178, 1), ...straight(20)], H: () => [...straight(40), ...arc(13, 178, -1), ...straight(20)],
  c: () => [...arc(30, 45, 1), ...straight(8), ...arc(30, 45, -1)], C: () => [...arc(30, 45, -1), ...straight(8), ...arc(30, 45, 1)],
  e: () => [...arc(55, 45, 1), ...arc(55, 45, -1), ...arc(55, 45, 1)], E: () => [...arc(55, 45, -1), ...arc(55, 45, 1), ...arc(55, 45, -1)],
  j: () => straight(110), k: () => straight(80),
};
export function layPieces(pieces) {
  const xs = [0], zs = [0], segs = [{ type: 'straight', start: 1 }], marks = [];
  let h = 0;
  const lay = (ks) => { for (const k of ks) { h += k * DS; xs.push(xs[xs.length - 1] + Math.sin(h) * DS); zs.push(zs[zs.length - 1] + Math.cos(h) * DS); } };
  lay(straight(60));
  for (const p of pieces) {
    const start = xs.length, ks = (PIECE_KS[p] || PIECE_KS.s)();
    segs.push({ type: p === 'S' || p === 's' || p === 'j' || p === 'k' ? 'straight' : 'corner', start });
    lay(ks);
    if (p === 'j') marks.push({ kind: 'jump', at: (start + 22) * DS });
    if (p === 'k') marks.push({ kind: 'crest', at: (start + 20) * DS });
  }
  lay(straight(70));
  return { xs, zs, segs, marks };
}
// Does a laid road cross or brush itself? (index pairs far apart along it)
export function selfCrossing(xs, zs) {
  for (let i = 0; i < xs.length; i += 3) for (let j = i + NEIGHBOUR; j < xs.length; j += 3) {
    if (Math.hypot(xs[i] - xs[j], zs[i] - zs[j]) < 22) return true;
  }
  return false;
}

// Public: build a stage definition from a seed.
export function generateStage(seed) {
  const custom = CUSTOM_STAGES.get(seed);
  let raw = custom ? layPieces(custom.pieces) : null;
  for (let salt = 0; salt < 20 && !raw; salt++) raw = tryGenerate(seed, salt);
  if (!raw) throw new Error(`Stage generation failed for seed ${seed}`);
  const { xs, zs, segs } = raw;

  // Elevation from the shared landform, smoothed and grade-limited. The theme
  // and the stage's own hilliness set how much it climbs and falls.
  const { theme, hilliness } = pickTheme(seed);
  const base = makeBaseHeight(seed, theme.heightAmp * hilliness);
  let ys = xs.map((x, i) => base(x, zs[i]));
  for (let pass = 0; pass < 2; pass++) {
    const out = ys.slice();
    for (let i = 0; i < ys.length; i++) {
      let s = 0, c = 0;
      for (let d = -12; d <= 12; d++) { const j = i + d; if (j >= 0 && j < ys.length) { s += ys[j]; c++; } }
      out[i] = s / c;
    }
    ys = out;
  }
  const maxStep = theme.maxGrade * DS;     // steepest allowed grade
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i - 1] - maxStep, Math.min(ys[i - 1] + maxStep, ys[i]));
  for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.max(ys[i + 1] - maxStep, Math.min(ys[i + 1] + maxStep, ys[i]));
  // Round off the kinks the grade limit leaves, so crests are smooth.
  for (let pass = 0; pass < 3; pass++) {
    const out = ys.slice();
    for (let i = 0; i < ys.length; i++) {
      let s = 0, c = 0;
      for (let d = -5; d <= 5; d++) { const j = i + d; if (j >= 0 && j < ys.length) { s += ys[j]; c++; } }
      out[i] = s / c;
    }
    ys = out;
  }

  const pts = xs.map((x, i) => [x, ys[i], zs[i]]);

  // Jumps on straights (not the opening one), crests on fast sweepers.
  const brand = mulberry32((seed * 31 + 7) >>> 0);
  const bumps = [];
  const total = (xs.length - 1) * DS;
  const farFrom = (at, gap) => bumps.every((b) => Math.abs(b.at - at) > gap);
  const straights = segs.filter((sg, k) => k > 0 && sg.type === 'straight');
  const sweepers = segs.filter((sg) => sg.type === 'sweeper' || sg.type === 'esses');
  // Seeded Fisher-Yates (a random sort comparator differs between browsers).
  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(brand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  const segLen = (sg) => { const k = segs.indexOf(sg); const end = k + 1 < segs.length ? segs[k + 1].start : xs.length; return (end - sg.start) * DS; };
  for (const sg of shuffle(straights)) {
    if (bumps.filter((b) => b.kind === 'jump').length >= (isEndurance(seed) ? 6 : 3)) break;
    const len = segLen(sg);
    // Needs a run-up and at least 60 m of straight road to land on.
    if (len < 95) continue;
    const at = sg.start * DS + brand.range(30, len - 62);
    if (at < 120 || at > total - 160 || !farFrom(at, 120)) continue;
    // Not on a steep descent, where the car would fly much too far.
    const iA = Math.round(at / DS), iB = Math.min(ys.length - 1, iA + 25);
    if ((ys[iB] - ys[iA]) / ((iB - iA) * DS || 1) < -0.04) continue;
    bumps.push({ kind: 'jump', at, h: brand.range(1.0, 1.45), up: brand.range(18, 24), down: brand.range(8, 11) });
  }
  for (const sg of shuffle(sweepers)) {
    if (bumps.filter((b) => b.kind === 'crest').length >= (isEndurance(seed) ? 6 : 3)) break;
    const len = segLen(sg);
    if (len < 50) continue;
    const at = sg.start * DS + len * 0.5;
    if (at < 120 || at > total - 160 || !farFrom(at, 110)) continue;
    bumps.push({ kind: 'crest', at, h: brand.range(1.0, 1.6), len: brand.range(26, 34) });
  }
  bumps.sort((a, b) => a.at - b.at);
  // Tarmac stages keep only one jump (they're for sliding, not flying).
  const special = specialOf(seed);
  if (special === 'tarmac') { let j = 0; for (let k = bumps.length - 1; k >= 0; k--) if (bumps[k].kind === 'jump' && j++ >= 1) bumps.splice(k, 1); }
  // Street circuits: no jumps (a car flying in a town is a bad idea) and
  // only gentle crests.
  if (special === 'street' || special === 'cliff') { for (let k = bumps.length - 1; k >= 0; k--) if (bumps[k].kind === 'jump') bumps.splice(k, 1); else bumps[k].h = Math.min(bumps[k].h, 0.8); }
  // Player-made stages: exactly the jumps and crests the player put in.
  if (custom) {
    bumps.length = 0;
    for (const m of raw.marks) bumps.push(m.kind === 'jump' ? { kind: 'jump', at: m.at, h: 1.25, up: 21, down: 9.5 } : { kind: 'crest', at: m.at, h: 1.3, len: 30 });
  }
  // Tunnels: one long curving one on street circuits (plus a short one
  // sometimes), one through a hillside on tarmac stages. Never on a jump or
  // crest, or where a sector gantry stands.
  const tunnels = [];
  if (special === 'street' || special === 'tarmac' || special === 'cliff') {
    const fin = total - 70, gates = [24, fin, ...[1, 2, 3, 4].map((k) => 24 + (fin - 24) * k / 5)];
    const want = special === 'street' ? [[180, 280], ...(brand() < 0.5 ? [[70, 110]] : [])] : special === 'cliff' ? [[60, 120], [50, 90]] : [[80, 150]];
    for (const [lo, hi] of want) {
      for (let tries = 0; tries < 80; tries++) {
        const len = lo + brand() * (hi - lo), from = 90 + brand() * (fin - len - 180), to = from + len;
        const near = (a) => a > from - 30 && a < to + 30;
        if (gates.some(near) || bumps.some((b) => near(b.at)) || tunnels.some((t) => from < t.to + 120 && to > t.from - 120)) continue;
        tunnels.push({ from, to });
        break;
      }
    }
    tunnels.sort((a, b) => a.from - b.from);
  }
  // River stages: two to four fords where a shallow river runs across the
  // road, on straights or gentle bends away from jumps and crests.
  const fords = [];
  if (special === 'river') {
    const n = 2 + Math.floor(brand() * 3);
    for (let tries = 0; tries < 200 && fords.length < n; tries++) {
      const at = 160 + brand() * (total - 340);
      if (bumps.some((b) => Math.abs(b.at - at) < 70) || fords.some((f) => Math.abs(f.at - at) < 220)) continue;
      // Fairly straight here (a river crossing on a hairpin would be cruel).
      const i = Math.round(at / DS);
      const h0 = Math.atan2(xs[i + 8] - xs[i - 8], zs[i + 8] - zs[i - 8]), h1 = Math.atan2(xs[i + 16] - xs[i], zs[i + 16] - zs[i]);
      if (Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0))) > 0.25) continue;
      // Rivers run through the bottom of a valley: gentle ground only, then
      // level the road out either side so the water lies flat across it.
      if (Math.abs(pts[i + 10][1] - pts[i - 10][1]) > 2.2) continue;
      const W = 18, y0 = pts[i][1];
      for (let d = -W; d <= W; d++) {
        const t = 1 - Math.abs(d) / W, k = t * t * (3 - 2 * t);
        pts[i + d][1] += (y0 - pts[i + d][1]) * k;
      }
      fords.push({ at, len: 22 + brand() * 8, h: -(0.7 + brand() * 0.4), width: 8 + brand() * 6 });
    }
    fords.sort((a, b) => a.at - b.at);
  }

  const counts = {};
  segs.forEach((s) => (counts[s.type] = (counts[s.type] || 0) + 1));
  return {
    seed, name: stageName(seed), points: pts, width: special === 'street' ? 9 : special === 'country' ? 6 : 7.5,
    runout: 70,   // metres of road after the finish line
    counts, bumps, fords, tunnels, special, theme: theme.id, hilliness,
  };
}
