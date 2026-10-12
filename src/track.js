// Road geometry: a dense centreline with fast nearest-point queries and a
// ribbon mesh. Stage generation (seeded) builds on this; the hand-made test
// loop below is used for driving practice.
import * as THREE from 'three';

export const SURFACES = {
  gravel: { name: 'gravel', grip: 1.0, drag: 0.0, dust: [0.74, 0.64, 0.5] },
  verge: { name: 'verge', grip: 0.92, drag: 0.04, dust: [0.62, 0.55, 0.42] },
  grass: { name: 'grass', grip: 0.8, drag: 0.15, dust: [0.45, 0.42, 0.3] },
};

export class Road {
  // pts: array of [x, y, z]; resampled to ~`spacing` metres.
  constructor(pts, { width = 8, closed = false, spacing = 2 } = {}) {
    this.width = width;
    this.closed = closed;
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed, 'centripetal');
    const approxLen = curve.getLength();
    const n = Math.max(8, Math.round(approxLen / spacing));
    const sampled = curve.getSpacedPoints(closed ? n : n - 1);
    if (closed) sampled.pop();
    this.n = sampled.length;
    this.px = new Float32Array(this.n); this.py = new Float32Array(this.n); this.pz = new Float32Array(this.n);
    this.tx = new Float32Array(this.n); this.tz = new Float32Array(this.n);
    this.cum = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.px[i] = sampled[i].x; this.py[i] = sampled[i].y; this.pz[i] = sampled[i].z;
    }
    let total = 0;
    for (let i = 0; i < this.n; i++) {
      const j = this.closed ? (i + 1) % this.n : Math.min(i + 1, this.n - 1);
      const k = this.closed ? (i - 1 + this.n) % this.n : Math.max(i - 1, 0);
      let dx = this.px[j] - this.px[k], dz = this.pz[j] - this.pz[k];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
      if (i > 0) total += Math.hypot(this.px[i] - this.px[i - 1], this.pz[i] - this.pz[i - 1]);
      this.cum[i] = total;
    }
    this.length = total + (closed ? Math.hypot(this.px[0] - this.px[this.n - 1], this.pz[0] - this.pz[this.n - 1]) : 0);
    // Query result, reused to avoid allocations.
    this.q = { i: 0, along: 0, lateral: 0, y: 0, tx: 0, tz: 1, dist: 0 };
  }

  // Shoulders: strips from the road edge sloping down (or up) to the real
  // ground on each side, so the road sits in the landscape instead of on a
  // ledge. heightAt(x, z) gives the ground height.
  buildShoulders(heightAt, inner, outer, material) {
    const n = this.n + (this.closed ? 1 : 0);
    const pos = new Float32Array(n * 4 * 3), uv = new Float32Array(n * 4 * 2);
    for (let k = 0; k < n; k++) {
      const i = k % this.n;
      const lx = this.tz[i], lz = -this.tx[i];
      const v = (k === this.n ? this.length : this.cum[i]) / 10;
      let o = 0;
      for (const side of [1, -1]) {
        const ix = this.px[i] + lx * inner * side, iz = this.pz[i] + lz * inner * side;
        const ox = this.px[i] + lx * outer * side, oz = this.pz[i] + lz * outer * side;
        pos.set([ix, this.py[i] + 0.012, iz, ox, heightAt(ox, oz) - 0.03, oz], k * 12 + o * 6);
        uv.set([0, v, 1, v], k * 8 + o * 4);
        o++;
      }
    }
    const idx = [];
    for (let k = 0; k < n - 1; k++) {
      const a = k * 4, b = (k + 1) * 4;
      // left side: inner a, outer a+1 ; right side: inner a+2, outer a+3
      idx.push(a, b, a + 1, a + 1, b, b + 1);
      idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  // Reshape the road's height profile with jumps and crests.
  //   jump:  a ramp up to a lip, then a short sharp drop (kicker)
  //   crest: a smooth symmetric hump that lifts the car at speed
  applyBumps(bumps) {
    this.bumps = bumps;
    for (let i = 0; i < this.n; i++) {
      const a = this.cum[i];
      let dy = 0;
      for (const b of bumps) {
        const rel = a - b.at;
        if (b.kind === 'jump') {
          const up = b.up || 20, down = b.down || 9;
          if (rel > -up && rel <= 0) { const t = 1 + rel / up; dy += b.h * t * t; }
          else if (rel > 0 && rel < down) { const u = rel / down; dy += b.h * (1 - u * u * (3 - 2 * u)); }
        } else if (Math.abs(rel) < b.len / 2) {
          dy += b.h * 0.5 * (1 + Math.cos(Math.PI * rel / (b.len / 2)));
        }
      }
      this.py[i] += dy;
    }
  }

  // Find the really sharp corners (hairpin-tight). Returns
  // [{ entry, apex, exit (distances along), dir (+1 left / -1 right), radius, angle }].
  findSharpCorners({ maxRadius = 17, minAngle = 1.2 } = {}) {
    const n = this.n, W = 4;
    const head = (i) => Math.atan2(this.tx[i], this.tz[i]);
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const R = new Float32Array(n), turn = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.idx(i - W), b = this.idx(i + W);
      const d = wrap(head(b) - head(a));
      R[i] = (2 * W * 2) / Math.max(1e-4, Math.abs(d));
      turn[i] = wrap(head(this.idx(i + 1)) - head(i));
    }
    const corners = [];
    let i = 0;
    while (i < n) {
      if (R[i] > maxRadius * 2.2) { i++; continue; }
      // Grow a region of strong curvature in one direction.
      const dir = Math.sign(turn[i]) || 1;
      let s = i, e = i, minR = R[i], apex = i, total = 0;
      while (e < n && R[e] < maxRadius * 2.2 && Math.sign(turn[e] || dir) === dir) {
        total += turn[e];
        if (R[e] < minR) { minR = R[e]; apex = e; }
        e++;
      }
      if (minR <= maxRadius && Math.abs(total) >= minAngle) {
        corners.push({ entry: this.cum[s], apex: this.cum[apex], exit: this.cum[Math.min(e, n - 1)], dir, radius: minR, angle: Math.abs(total) });
      }
      i = Math.max(e, i + 1);
    }
    return corners;
  }

  // Sample index at a distance along the road (binary search).
  indexAt(along) {
    let lo = 0, hi = this.n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.cum[mid] < along) lo = mid + 1; else hi = mid; }
    return lo;
  }

  idx(i) { return this.closed ? ((i % this.n) + this.n) % this.n : Math.max(0, Math.min(this.n - 1, i)); }

  // Nearest centreline point. `hint` is the last known index (or -1).
  nearest(x, z, hint = -1) {
    let best = -1, bestD = Infinity;
    const scan = (from, to) => {
      for (let k = from; k <= to; k++) {
        const i = this.idx(k);
        const dx = x - this.px[i], dz = z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    };
    if (hint >= 0) scan(hint - 40, hint + 40);
    if (hint < 0 || bestD > 40 * 40) { bestD = Infinity; scan(0, this.n - 1); }

    // Refine on the better of the two adjacent segments.
    const q = this.q;
    let segA = best, segB = this.idx(best + 1);
    if (!this.closed && best === this.n - 1) { segA = best - 1; segB = best; }
    const prev = this.idx(best - 1);
    const projT = (a, b) => {
      const ex = this.px[b] - this.px[a], ez = this.pz[b] - this.pz[a];
      const l2 = ex * ex + ez * ez || 1;
      return ((x - this.px[a]) * ex + (z - this.pz[a]) * ez) / l2;
    };
    let t = projT(segA, segB);
    if (t < 0 && (this.closed || best > 0)) { segA = prev; segB = best; t = projT(segA, segB); }
    t = Math.max(0, Math.min(1, t));
    const cx = this.px[segA] + (this.px[segB] - this.px[segA]) * t;
    const cz = this.pz[segA] + (this.pz[segB] - this.pz[segA]) * t;
    const tx = this.tx[segA] + (this.tx[segB] - this.tx[segA]) * t;
    const tz = this.tz[segA] + (this.tz[segB] - this.tz[segA]) * t;
    const tl = Math.hypot(tx, tz) || 1;
    q.tx = tx / tl; q.tz = tz / tl;
    // left = (tz, -tx)
    q.lateral = (x - cx) * q.tz - (z - cz) * q.tx;
    q.dist = Math.hypot(x - cx, z - cz);
    const segLen = Math.hypot(this.px[segB] - this.px[segA], this.pz[segB] - this.pz[segA]);
    q.along = this.cum[segA] + segLen * t;
    q.y = this.py[segA] + (this.py[segB] - this.py[segA]) * t;
    q.i = best;
    return q;
  }

  // Racing line as a lateral offset per sample (left positive). Found by
  // relaxing the line toward the midpoint of its neighbours, which minimises
  // curvature: it cuts to the inside of corners and runs wide on entry/exit.
  computeRacingLine(margin = 1.3) {
    const n = this.n, lim = this.width / 2 - margin;
    const off = new Float32Array(n), next = new Float32Array(n);
    const lx = (i) => this.tz[i], lz = (i) => -this.tx[i];
    for (const [k, iters] of [[12, 220], [5, 160], [2, 80]]) {
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < n; i++) {
          if (!this.closed && (i < k || i >= n - k)) { next[i] = off[i] * 0.5; continue; }
          const a = this.idx(i - k), b = this.idx(i + k);
          const mx = (this.px[a] + lx(a) * off[a] + this.px[b] + lx(b) * off[b]) / 2;
          const mz = (this.pz[a] + lz(a) * off[a] + this.pz[b] + lz(b) * off[b]) / 2;
          const want = (mx - this.px[i]) * lx(i) + (mz - this.pz[i]) * lz(i);
          next[i] = Math.max(-lim, Math.min(lim, off[i] + (want - off[i]) * 0.5));
        }
        off.set(next);
      }
    }
    // Smooth out kinks where the line touches the road-edge limit.
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let d = -3; d <= 3; d++) s += off[this.idx(i + d)];
        next[i] = s / 7;
      }
      off.set(next);
    }
    this.racing = off;
    return off;
  }

  // Racing-line offset at a query result (interpolated between samples).
  racingAt(q) {
    if (!this.racing) return 0;
    const i = q.i, j = this.idx(i + 1);
    const segLen = (this.cum[j] - this.cum[i]) || 2;
    const t = Math.max(0, Math.min(1, (q.along - this.cum[i]) / segLen));
    return this.racing[i] + (this.racing[j] - this.racing[i]) * t;
  }

  // A strip of `width` metres running along the road at a lateral offset
  // (left positive) given per sample by `offsetAt(i)`. Used for tyre tracks.
  buildOffsetStrip(offsetAt, width, yOffset, material, uvScale = 1 / 4, from = 0, to = -1) {
    const first = Math.max(0, from);
    const n = (to < 0 ? this.n + (this.closed ? 1 : 0) : Math.min(to, this.n)) - first;
    const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4);
    const h = width / 2;
    let dist = 0, px = 0, pz = 0;
    for (let k = 0; k < n; k++) {
      const i = (k + first) % this.n;
      const lx = this.tz[i], lz = -this.tx[i];
      const o = offsetAt(i);
      const cx = this.px[i] + lx * o, cz = this.pz[i] + lz * o;
      if (k > 0) dist += Math.hypot(cx - px, cz - pz);
      px = cx; pz = cz;
      const y = this.py[i] + yOffset;
      pos.set([cx + lx * h, y, cz + lz * h, cx - lx * h, y, cz - lz * h], k * 6);
      uv.set([0, dist * uvScale, 1, dist * uvScale], k * 4);
    }
    const idx = [];
    for (let k = 0; k < n - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    // Unlit decal strip: no shadow receiving (it made the road under it vanish).
    return new THREE.Mesh(geo, material);
  }

  surfaceAt(lateralAbs) {
    const S = this.surfaces || SURFACES;
    if (lateralAbs < this.width / 2) return S.gravel;
    if (lateralAbs < this.width / 2 + 1.8) return S.verge;
    return S.grass;
  }

  // Ribbon mesh following the centreline; `extra` widens it (for verges).
  buildRibbon(width, yOffset, material, uvScale = 1 / 10) {
    const n = this.n + (this.closed ? 1 : 0);
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    for (let k = 0; k < n; k++) {
      const i = k % this.n;
      const lx = this.tz[i], lz = -this.tx[i];
      const y = this.py[i] + yOffset;
      const h = width / 2;
      pos.set([this.px[i] + lx * h, y, this.pz[i] + lz * h, this.px[i] - lx * h, y, this.pz[i] - lz * h], k * 6);
      const v = (k === this.n ? this.length : this.cum[i]) * uvScale;
      uv.set([0, v, 1, v], k * 4);
    }
    const idx = [];
    for (let k = 0; k < n - 1; k++) {
      const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    return mesh;
  }
}

// Procedural gravel texture: speckled stones, two darker wheel ruts, soft edges.
// pal: { base, rut: [r,g,b], edge: [r,g,b], stone: [dr,dg,db] } from the stage theme.
export function gravelTexture(pal = { base: '#b59c78', rut: [70, 55, 40], edge: [60, 70, 40], stone: [25, 10, -15] }) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  const [rr, rg, rb] = pal.rut, [er, eg0, eb] = pal.edge, [sr, sg, sb] = pal.stone;
  g.fillStyle = pal.base;
  g.fillRect(0, 0, 256, 512);
  // Ruts
  for (const x of [72, 184]) {
    const grad = g.createLinearGradient(x - 26, 0, x + 26, 0);
    grad.addColorStop(0, `rgba(${rr},${rg},${rb},0)`);
    grad.addColorStop(0.5, `rgba(${rr},${rg},${rb},0.28)`);
    grad.addColorStop(1, `rgba(${rr},${rg},${rb},0)`);
    g.fillStyle = grad;
    g.fillRect(x - 26, 0, 52, 512);
  }
  // Loose gravel ridge in the middle and at the edges
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 256, y = Math.random() * 512;
    const edge = Math.min(x, 256 - x) < 22 || Math.abs(x - 128) < 18;
    const r = Math.random() * (edge ? 2.2 : 1.4) + 0.4;
    const l = 90 + Math.random() * 110;
    g.fillStyle = `rgba(${l + sr},${l + sg},${l + sb},${edge ? 0.75 : 0.45})`;
    g.fillRect(x, y, r, r);
  }
  // Edge darkening
  const eg = g.createLinearGradient(0, 0, 256, 0);
  eg.addColorStop(0, `rgba(${er},${eg0},${eb},0.55)`);
  eg.addColorStop(0.07, `rgba(${er},${eg0},${eb},0)`);
  eg.addColorStop(0.93, `rgba(${er},${eg0},${eb},0)`);
  eg.addColorStop(1, `rgba(${er},${eg0},${eb},0.55)`);
  g.fillStyle = eg; g.fillRect(0, 0, 256, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Hand-made practice loop (~2 km): hairpins, sweepers, a chicane and straights.
export function createTestRoad() {
  const P = [
    [0, -60], [0, 60], [6, 120], [30, 165], [75, 190], [125, 185], [150, 160],
    [145, 128], [115, 118], [100, 95], [112, 70], [140, 62], [168, 40],
    [175, 5], [160, -30], [178, -62], [205, -85], [215, -125], [195, -160],
    [158, -168], [130, -150], [118, -118], [92, -105], [66, -126], [52, -168],
    [28, -186], [4, -170], [-4, -130],
  ];
  return new Road(P.map(([x, z]) => [x, 0, z]), { width: 8, closed: true, spacing: 2 });
}

// ---------- Shortcuts ----------
// Find places where two bits of the stage come close (e.g. across a hairpin)
// and a rough dirt track could cut across. Rules: saves at least 70 m, never
// skips a checkpoint, and doesn't pass near any other part of the road.
// Returns [{ a, b, pts: [[x, z], ...] }] in road order.
export function findShortcuts(road, { checkpoints = [], start = 0, finish = road.length, max = 2 } = {}) {
  const n = road.n, step = 3;
  const cands = [];
  for (let i = 0; i < n; i += step) {
    const a = road.cum[i];
    if (a < start + 60) continue;
    for (let j = i + 20; j < n; j += step) {
      const b = road.cum[j];
      if (b > finish - 40) break;
      const gain = b - a;
      if (gain < 70) continue;
      const dx = road.px[j] - road.px[i], dz = road.pz[j] - road.pz[i];
      const d = Math.hypot(dx, dz);
      if (d < 22 || d > 90 || gain / d < 1.8) continue;
      if (Math.abs(road.py[j] - road.py[i]) / d > 0.12) continue;
      if (checkpoints.some((c) => c > a - 10 && c < b + 10)) continue;
      cands.push({ i, j, a, b, d, score: gain - d });
    }
  }
  cands.sort((p, q) => q.score - p.score);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= max) break;
    if (picked.some((p) => Math.abs(p.a - c.a) < 250 && Math.abs(p.b - c.b) < 250)) continue;
    // Gentle S-bend so it reads as a track, not a ruler line.
    const ax = road.px[c.i], az = road.pz[c.i], bx = road.px[c.j], bz = road.pz[c.j];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const nx = -(bz - az) / c.d, nz = (bx - ax) / c.d;
    const bend = (c.d * 0.12) * (c.i % 2 ? 1 : -1);
    const pts = [];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20, w = 2 * t * (1 - t) * 2;   // quadratic bulge, 0 at the ends
      pts.push([ax + (bx - ax) * t + nx * bend * w, az + (bz - az) * t + nz * bend * w]);
    }
    // Must stay clear of the rest of the road in its middle section.
    let ok = true;
    for (let k = 4; k <= 16 && ok; k++) {
      const [x, z] = pts[k];
      for (let s = 0; s < n; s += 2) {
        if (road.cum[s] > c.a - 15 && road.cum[s] < c.a + 15) continue;
        if (road.cum[s] > c.b - 15 && road.cum[s] < c.b + 15) continue;
        if (Math.hypot(road.px[s] - x, road.pz[s] - z) < road.width / 2 + 4) { ok = false; break; }
      }
    }
    if (ok) picked.push({ ...c, pts });
  }
  return picked.sort((p, q) => p.a - q.a);
}

export function distToPolyline(pts, x, z) {
  let best = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    best = Math.min(best, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
  }
  return best;
}
