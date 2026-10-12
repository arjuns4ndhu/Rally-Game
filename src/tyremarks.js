// Tyre marks: dark worn tracks along the racing line, and the lighter scuffs
// your own car leaves on the gravel.
import * as THREE from 'three';

// Soft-edged, broken-up track texture (white; tinted by material colour).
function trackTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(32, 256);
  for (let y = 0; y < 256; y++) {
    // Slow variation along the track so it reads as worn, not painted.
    const along = 0.75 + 0.25 * Math.sin(y * 0.07) * Math.sin(y * 0.023 + 1.3);
    for (let x = 0; x < 32; x++) {
      const u = (x + 0.5) / 32;
      const edge = Math.min(1, Math.sin(u * Math.PI) * 1.6);   // soft edges
      const grain = 0.65 + Math.random() * 0.35;
      const a = Math.max(0, edge * along * grain);
      const i = (y * 32 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Two dark wheel tracks following the racing line.
export function buildRacingMarks(road, trackWidth = 1.6) {
  const mat = new THREE.MeshBasicMaterial({
    map: trackTexture(), color: 0x33241a, transparent: true, opacity: 0.75,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const group = new THREE.Group();
  for (const side of [-1, 1]) {
    group.add(road.buildOffsetStrip((i) => road.racing[i] + side * trackWidth / 2, 0.42, 0.05, mat, 1 / 6));
  }
  return group;
}

// Ring buffer of quads laid behind each wheel as the car moves.
const MAX_SEG = 12000;
const SEG_LEN = 0.6;      // metres between mark points
const MARK_W = 0.3;

export class TyreMarks {
  constructor(scene) {
    this.pos = new Float32Array(MAX_SEG * 4 * 3);
    this.col = new Float32Array(MAX_SEG * 4 * 4);
    const idx = new Uint32Array(MAX_SEG * 6);
    for (let s = 0; s < MAX_SEG; s++) {
      const v = s * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], s * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.cursor = 0;
    this.wheels = [];       // last point per wheel: {x, y, z, lx, lz, a} or null
    this.dirtyLo = Infinity; this.dirtyHi = -1;
  }

  // Break every trail (after a reset/teleport) without erasing old marks.
  cut() { this.wheels = []; }

  clear() { this.col.fill(0); this.cut(); this.dirtyLo = 0; this.dirtyHi = MAX_SEG - 1; }

  // Feed one wheel's ground contact. `on` = wheel is on the gravel road.
  // `strength` 0..1 controls opacity (sliding wheels mark harder).
  track(w, x, y, z, on, strength) {
    const last = this.wheels[w];
    if (!on) { this.wheels[w] = null; return; }
    if (!last) { this.wheels[w] = { x, y, z, lx: 0, lz: 0, a: 0, fresh: true }; return; }
    const dx = x - last.x, dz = z - last.z;
    const d = Math.hypot(dx, dz);
    if (d < SEG_LEN) return;
    if (d > 6) { this.wheels[w] = { x, y, z, lx: 0, lz: 0, a: 0, fresh: true }; return; }
    // Perpendicular to the direction of travel.
    const lx = -dz / d * MARK_W / 2, lz = dx / d * MARK_W / 2;
    const a = 0.16 + strength * 0.42;
    if (last.fresh) { last.lx = lx; last.lz = lz; last.a = a; last.fresh = false; }
    const s = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_SEG;
    const p = this.pos, c = this.col, v = s * 12, k = s * 16;
    const yy = y + 0.075, ly = last.y + 0.075;
    p[v] = last.x + last.lx; p[v + 1] = ly; p[v + 2] = last.z + last.lz;
    p[v + 3] = last.x - last.lx; p[v + 4] = ly; p[v + 5] = last.z - last.lz;
    p[v + 6] = x + lx; p[v + 7] = yy; p[v + 8] = z + lz;
    p[v + 9] = x - lx; p[v + 10] = yy; p[v + 11] = z - lz;
    // Light, dusty scuff colour.
    for (let q = 0; q < 4; q++) {
      const alpha = q < 2 ? last.a : a;
      c[k + q * 4] = 0.93; c[k + q * 4 + 1] = 0.86; c[k + q * 4 + 2] = 0.72; c[k + q * 4 + 3] = alpha;
    }
    this.dirtyLo = Math.min(this.dirtyLo, s); this.dirtyHi = Math.max(this.dirtyHi, s);
    last.x = x; last.y = y; last.z = z; last.lx = lx; last.lz = lz; last.a = a;
  }

  flush() {
    if (this.dirtyHi < 0) return;
    const lo = this.dirtyLo, hi = this.dirtyHi;
    for (const [attr, size] of [[this.posAttr, 12], [this.colAttr, 16]]) {
      if (attr.addUpdateRange) { attr.clearUpdateRanges?.(); attr.addUpdateRange(lo * size, (hi - lo + 1) * size); }
      attr.needsUpdate = true;
    }
    this.dirtyLo = Infinity; this.dirtyHi = -1;
  }
}
