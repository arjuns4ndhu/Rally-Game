// Road geometry: a dense centreline with fast nearest-point queries and a
// ribbon mesh. Stage generation (seeded) builds on this; the hand-made test
// loop below is used for driving practice.
import * as THREE from 'three';

export const SURFACES = {
  gravel: { name: 'gravel', grip: 1.0, drag: 0.0, dust: [0.74, 0.64, 0.5] },
  verge: { name: 'verge', grip: 0.85, drag: 0.12, dust: [0.62, 0.55, 0.42] },
  grass: { name: 'grass', grip: 0.62, drag: 0.55, dust: [0.45, 0.42, 0.3] },
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

  surfaceAt(lateralAbs) {
    if (lateralAbs < this.width / 2) return SURFACES.gravel;
    if (lateralAbs < this.width / 2 + 1.8) return SURFACES.verge;
    return SURFACES.grass;
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
export function gravelTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#b59c78';
  g.fillRect(0, 0, 256, 512);
  // Ruts
  for (const x of [72, 184]) {
    const grad = g.createLinearGradient(x - 26, 0, x + 26, 0);
    grad.addColorStop(0, 'rgba(70,55,40,0)');
    grad.addColorStop(0.5, 'rgba(70,55,40,0.28)');
    grad.addColorStop(1, 'rgba(70,55,40,0)');
    g.fillStyle = grad;
    g.fillRect(x - 26, 0, 52, 512);
  }
  // Loose gravel ridge in the middle and at the edges
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 256, y = Math.random() * 512;
    const edge = Math.min(x, 256 - x) < 22 || Math.abs(x - 128) < 18;
    const r = Math.random() * (edge ? 2.2 : 1.4) + 0.4;
    const l = 90 + Math.random() * 110;
    g.fillStyle = `rgba(${l + 25},${l + 10},${l - 15},${edge ? 0.75 : 0.45})`;
    g.fillRect(x, y, r, r);
  }
  // Edge darkening
  const eg = g.createLinearGradient(0, 0, 256, 0);
  eg.addColorStop(0, 'rgba(60,70,40,0.55)');
  eg.addColorStop(0.07, 'rgba(60,70,40,0)');
  eg.addColorStop(0.93, 'rgba(60,70,40,0)');
  eg.addColorStop(1, 'rgba(60,70,40,0.55)');
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
