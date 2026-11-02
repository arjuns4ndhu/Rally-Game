// Street circuits and tunnels. A street stage runs through a harbour town:
// steel barriers along both edges (you can't leave the road), a wide
// promenade with palms and street lamps, apartment blocks and hotels with
// lit windows at night, banners strung across the road, and a long curving
// tunnel. Tarmac stages get a shorter tunnel through a rocky hillside.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { facet } from './retro.js';

export const BARRIER_GAP = 0.55;          // barrier face, metres beyond the road edge

// Merge plain geometries (positions, normals, uvs, optional colours) into one.
export function merge(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const n = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    if (!parts.every((g) => g.attributes[name])) continue;
    const size = parts[0].attributes[name].itemSize, arr = new Float32Array(n * size);
    let o = 0;
    for (const g of parts) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

// Point at distance `along` and lateral offset `lat` (left +).
export function at(road, along, lat) {
  const i = road.indexAt(Math.max(0, Math.min(road.length - 0.01, along)));
  return { x: road.px[i] + road.tz[i] * lat, y: road.py[i], z: road.pz[i] - road.tx[i] * lat, i };
}
const inTunnel = (tunnels, a, pad = 0) => tunnels.some((t) => a > t.from - pad && a < t.to + pad);

// A strip following the road at lateral `lat`, from height y0 to y1.
export function wallStrip(road, from, to, lat, y0, y1, step = 2) {
  const pos = [], uv = [];
  let prev = null;
  for (let a = from; a <= to + 0.01; a += step) {
    const p = at(road, a, lat);
    if (prev) {
      const q = prev;
      pos.push(q.x, q.y + y0, q.z, p.x, p.y + y0, p.z, p.x, p.y + y1, p.z, q.x, q.y + y0, q.z, p.x, p.y + y1, p.z, q.x, q.y + y1, q.z);
      const u0 = (a - step) / 4, u1 = a / 4;
      uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
    }
    prev = p;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Tunnels ----------
// The tube: walls on the barrier line and an arched roof, lit by a row of
// ceiling lamps. Street tunnels are concrete with a building on top;
// tarmac ones are cut through a pile of rock.
export function buildTunnels(road, tunnels, { rock = false, seed = 1 } = {}) {
  const group = new THREE.Group();
  if (!tunnels.length) return group;
  const W = road.width / 2 + BARRIER_GAP;
  // Walls run down below the road so nothing shows underneath on a ledge.
  const prof = [[-W, -3], [-W, 4.4], [-W * 0.72, 5.6], [0, 6.1], [W * 0.72, 5.6], [W, 4.4], [W, -3]];
  const inner = new THREE.MeshStandardMaterial({ color: rock ? 0x6d655c : 0xb9b4aa, roughness: 0.95, side: THREE.DoubleSide, flatShading: true });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6, side: THREE.DoubleSide });
  const lamps = [];
  const rnd = mulberry32((seed * 9301 + 49297) >>> 0);
  for (const t of tunnels) {
    // Tube, built ring by ring.
    const pos = [];
    let prev = null;
    for (let a = t.from; a <= t.to + 0.01; a += 2) {
      const ring = prof.map(([l, h]) => { const p = at(road, a, l); return [p.x, p.y + h, p.z]; });
      if (prev) for (let k = 0; k < prof.length - 1; k++) pos.push(...prev[k], ...ring[k], ...ring[k + 1], ...prev[k], ...ring[k + 1], ...prev[k + 1]);
      prev = ring;
      if (Math.round(a) % 8 === 0) { const p = at(road, a, 0); lamps.push([p.x, p.y + 6.0, p.z, Math.atan2(road.tx[p.i], road.tz[p.i])]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const tube = new THREE.Mesh(g, inner);
    tube.castShadow = true; tube.receiveShadow = true;
    group.add(tube);
    // Kerbed walkways from the road edge to each wall (no gap at the sides).
    for (const sd of [-1, 1]) {
      const pos2 = [];
      let pv = null;
      for (let a = t.from; a <= t.to + 0.01; a += 2) {
        const p0 = at(road, a, sd * (road.width / 2 - 0.05)), p1 = at(road, a, sd * W);
        const cur = [[p0.x, p0.y + 0.05, p0.z], [p1.x, p1.y + 0.18, p1.z]];
        if (pv) pos2.push(...pv[0], ...cur[0], ...cur[1], ...pv[0], ...cur[1], ...pv[1]);
        pv = cur;
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3));
      fg.computeVertexNormals();
      group.add(Object.assign(new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.95, side: THREE.DoubleSide })), { receiveShadow: true }));
    }
    // Yellow and black hazard band along the bottom of each wall.
    for (const s of [-1, 1]) group.add(new THREE.Mesh(wallStrip(road, t.from, t.to, s * (W - 0.02), 0.2, 0.9), stripeMat));
    // Portals: a thick frame at each end.
    for (const a of [t.from, t.to]) {
      const p = at(road, a, 0), yaw = Math.atan2(road.tx[p.i], road.tz[p.i]);
      const frame = new THREE.Group();
      const m = rock ? new THREE.MeshStandardMaterial({ color: 0x8a8378, flatShading: true }) : new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.8 });
      for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(1.4, 7.4, 1.6), m); post.position.set(s * (W + 0.7), 3.7, 0); frame.add(post); }
      const top = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 2.8, 1.8, 1.6), m); top.position.y = 7.1; frame.add(top);
      frame.position.set(p.x, p.y, p.z); frame.rotation.y = yaw;
      frame.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      group.add(frame);
    }
    if (rock) {
      // A rocky hill over the top, kept clear of the inside of the tube.
      const rockGeo = facet(new THREE.DodecahedronGeometry(1, 0), 0.2);
      const rm = new THREE.MeshStandardMaterial({ color: 0x8c8274, flatShading: true, roughness: 1 });
      for (let a = t.from - 6; a <= t.to + 6; a += 9) {
        for (const [l, h, r] of [[0, 15, 9], [-(W + 9), 6, 8], [W + 9, 6, 8], [-(W + 18), 3, 9], [W + 18, 3, 9]]) {
          const p = at(road, a + (rnd() - 0.5) * 4, l), sc = r * (0.8 + rnd() * 0.4);
          const m = new THREE.Mesh(rockGeo, rm);
          m.position.set(p.x, p.y + h + rnd() * 2, p.z); m.scale.set(sc, sc * 0.8, sc); m.rotation.set(rnd(), rnd() * 6, rnd());
          m.castShadow = true;
          group.add(m);
        }
      }
    } else {
      // A long block of flats sitting on top of the tunnel.
      const cover = [];
      for (let a = t.from; a < t.to - 8; a += 24) {
        const p = at(road, a + 12, 0), yaw = Math.atan2(road.tx[p.i], road.tz[p.i]);
        const b = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 6, 3.2, 26), new THREE.MeshStandardMaterial({ color: 0xd9cfbd, roughness: 0.9 }));
        b.position.set(p.x, p.y + 7.6, p.z); b.rotation.y = yaw; b.castShadow = true;
        cover.push(b);
      }
      cover.forEach((b) => group.add(b));
    }
  }
  // Ceiling lamps: one instanced mesh for every tunnel.
  const lampGeo = new THREE.BoxGeometry(0.5, 0.12, 2.4);
  const im = new THREE.InstancedMesh(lampGeo, lampMat, Math.max(1, lamps.length));
  im.count = lamps.length;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  lamps.forEach(([x, y, z, yaw], k) => im.setMatrixAt(k, m4.compose(v.set(x, y, z), q.setFromAxisAngle(up, yaw), one)));
  group.add(im);
  return group;
}

// ---------- Street dressing ----------
export function buildStreet(road, { seed = 1, tunnels = [], start = 0, finish = road.length, groundY, night = 0, harbour = null }) {
  const rnd = mulberry32((seed * 2654435761 ^ 0x9e3779b9) >>> 0);
  const group = new THREE.Group();
  const w = road.width / 2, B = w + BARRIER_GAP;
  const from = 0, to = road.length;
  // Is a spot well clear of every bit of road (hairpins fold back)?
  const clearOf = (x, z, d) => road.nearest(x, z).dist > d;

  // --- Barriers: steel rails on posts, painted red and white on corners.
  const railTex = canvasTex(64, 16, (g, W, H) => {
    g.fillStyle = '#c9ccd1'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#8e939b'; g.fillRect(0, H * 0.45, W, H * 0.12);
    g.fillStyle = '#e8eaee'; g.fillRect(0, H * 0.1, W, H * 0.15);
  });
  const railMat = new THREE.MeshStandardMaterial({ map: railTex, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide });
  const runs = [];       // barrier stretches, split around tunnels
  let a0 = from;
  for (const t of tunnels) { runs.push([a0, t.from]); a0 = t.to; }
  runs.push([a0, to]);
  const rails = [], posts = [];
  for (const [f, t] of runs) {
    if (t - f < 2) continue;
    for (const s of [-1, 1]) {
      rails.push(wallStrip(road, f, t, s * B, 0.35, 0.95));
      for (let a = f; a < t; a += 4) { const p = at(road, a, s * (B + 0.12)); posts.push([p.x, p.y, p.z]); }
    }
  }
  if (rails.length) { const m = new THREE.Mesh(merge(rails), railMat); m.receiveShadow = true; group.add(m); }
  const postGeo = new THREE.BoxGeometry(0.14, 1.0, 0.14).translate(0, 0.5, 0);
  const pim = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x6a6e75, roughness: 0.6 }), Math.max(1, posts.length));
  pim.count = posts.length;
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), sv = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  posts.forEach(([x, y, z], k) => pim.setMatrixAt(k, m4.makeTranslation(x, y, z)));
  group.add(pim);

  // --- Promenade: a pale paved strip between the barrier and the buildings.
  const paveTex = canvasTex(32, 32, (g, W, H) => {
    g.fillStyle = '#cfc6b4'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#b6ad9a'; g.lineWidth = 1;
    for (let k = 0; k <= W; k += 8) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, H); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(W, k); g.stroke(); }
  });
  const pave = [];
  for (const s of [-1, 1]) {
    const pos = [], uv = [];
    let prev = null;
    for (let a = from; a <= to; a += 3) {
      const p0 = at(road, a, s * (B + 0.3)), p1 = at(road, a, s * (B + 12));
      const y1 = Math.max(p1.y, groundY(p1.x, p1.z));
      const cur = [p0.x, p0.y + 0.12, p0.z, p1.x, y1 + 0.12, p1.z];
      if (prev) {
        pos.push(prev[0], prev[1], prev[2], cur[0], cur[1], cur[2], cur[3], cur[4], cur[5], prev[0], prev[1], prev[2], cur[3], cur[4], cur[5], prev[3], prev[4], prev[5]);
        uv.push(0, (a - 3) / 3, 0, a / 3, 4, a / 3, 0, (a - 3) / 3, 4, a / 3, 4, (a - 3) / 3);
      }
      prev = cur;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    pave.push(g);
  }
  const pm = new THREE.Mesh(merge(pave), new THREE.MeshStandardMaterial({ map: paveTex, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
  pm.receiveShadow = true;
  group.add(pm);

  // --- Buildings: blocks along both sides, facades of windows. Lit windows
  // glow at dusk and night.
  const WIN = 8;
  const facade = canvasTex(64, 64, (g, W, H) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2b3442';
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) g.fillRect(6 + x * 32, 8 + y * 32, 20, 18);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 30, W, 3); g.fillRect(0, 62, W, 2);
  });
  const glow = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (let x = 0; x < WIN; x++) for (let y = 0; y < WIN; y++) {
      if (rnd() < 0.42) { g.fillStyle = rnd() < 0.7 ? '#ffd28a' : '#cfe3ff'; g.fillRect(6 + x * 32, 8 + y * 32, 20, 18); }
    }
  });
  glow.repeat.set(1 / 4, 1 / 4);
  const PALETTE = [0xf1e3c8, 0xe8c9a4, 0xf4d6c2, 0xd9e2e4, 0xf2efe6, 0xe6b8a2, 0xf6e7b0, 0xcfd9c4];
  const blocks = [];
  for (const s of [-1, 1]) {
    for (let a = start - 60; a < finish + 60;) {
      const len = 12 + rnd() * 16, gap = 2 + rnd() * 6;
      const mid = a + len / 2;
      if (!inTunnel(tunnels, mid, len / 2 + 6) && rnd() < 0.86) {
        const depth = 10 + rnd() * 10, h = 9 + Math.pow(rnd(), 1.6) * 30;
        const off = B + 13 + depth / 2 + rnd() * 3;
        const p = at(road, mid, s * off);
        // Every corner of the footprint must be clear of all the road.
        const yaw = Math.atan2(road.tx[p.i], road.tz[p.i]);
        const cs = Math.cos(yaw), sn = Math.sin(yaw);
        const corners = [[-depth / 2, -len / 2], [depth / 2, -len / 2], [-depth / 2, len / 2], [depth / 2, len / 2]].map(([lx, lz]) => [p.x + lx * cs + lz * sn, p.z - lx * sn + lz * cs]);
        const wet = harbour && (inHarbour(harbour, p.x, p.z, 6) || corners.some(([x, z]) => inHarbour(harbour, x, z, 6)));
        if (!wet && corners.every(([x, z]) => clearOf(x, z, B + 12)) && clearOf(p.x, p.z, B + 12)) {
          const y0 = Math.min(...corners.map(([x, z]) => groundY(x, z)), groundY(p.x, p.z)) - 0.5;
          blocks.push({ x: p.x, z: p.z, y0, yaw, wd: depth, ln: len, h: h + (p.y - y0) * 0.3, col: PALETTE[Math.floor(rnd() * PALETTE.length)] });
        }
      }
      a += len + gap;
    }
  }
  const geos = blocks.map((b) => {
    const g = new THREE.BoxGeometry(b.wd, b.h, b.ln);
    // Window grid in metres: 4 m per tile across, 3.4 m per storey.
    const uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const across = f < 2 ? b.ln : f < 4 ? 0 : b.wd, up = f < 2 || f >= 4 ? b.h : 0;
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, uv.getX(i) * across / 8, uv.getY(i) * up / 6.8);
      }
    }
    g.rotateY(b.yaw).translate(b.x, b.y0 + b.h / 2, b.z);
    const c = new THREE.Color(b.col), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) col.set([c.r, c.g, c.b], k * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const bmat = new THREE.MeshStandardMaterial({ map: facade, vertexColors: true, roughness: 0.85, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: night });
  // Facade texture repeats every 2 x 2 windows, the glow map every 8 x 8.
  facade.repeat.set(1, 1);
  if (geos.length) { const bm = new THREE.Mesh(merge(geos), bmat); bm.castShadow = true; bm.receiveShadow = true; group.add(bm); }
  // Roofs: a darker cap on top of each block.
  const roofs = blocks.map((b) => new THREE.BoxGeometry(b.wd + 0.6, 0.6, b.ln + 0.6).rotateY(b.yaw).translate(b.x, b.y0 + b.h + 0.3, b.z));
  if (roofs.length) group.add(new THREE.Mesh(merge(roofs), new THREE.MeshStandardMaterial({ color: 0x9a5a42, roughness: 0.9 })));

  // --- Palms and street lamps along the promenade.
  const palms = [], lamps = [];
  for (const s of [-1, 1]) {
    for (let a = start - 20; a < finish + 20; a += 14 + rnd() * 6) {
      if (inTunnel(tunnels, a, 10)) continue;
      const p = at(road, a, s * (B + 6.5 + rnd() * 3));
      if (!clearOf(p.x, p.z, B + 4) || (harbour && inHarbour(harbour, p.x, p.z, 2))) continue;
      palms.push([p.x, groundY(p.x, p.z), p.z, rnd() * 6, 0.85 + rnd() * 0.4]);
    }
    for (let a = start - 10; a < finish + 10; a += 26) {
      if (inTunnel(tunnels, a, 6)) continue;
      const p = at(road, a, s * (B + 1.4));
      if (!clearOf(p.x, p.z, B + 0.8)) continue;
      lamps.push([p.x, Math.max(p.y, groundY(p.x, p.z)), p.z, Math.atan2(road.tx[p.i], road.tz[p.i]) + (s > 0 ? Math.PI / 2 : -Math.PI / 2)]);
    }
  }
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 7, 6).translate(0, 3.5, 0);
  const frond = new THREE.ConeGeometry(0.5, 3.4, 4).rotateZ(Math.PI / 2).translate(1.7, 0, 0);
  const fronds = merge(Array.from({ length: 7 }, (_, k) => frond.clone().rotateZ(-0.35).rotateY(k * Math.PI * 2 / 7).translate(0, 7.1, 0)));
  const addInst = (geo, mat, list, mk) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    im.count = list.length; list.forEach((it, k) => im.setMatrixAt(k, mk(it)));
    im.castShadow = true; group.add(im); return im;
  };
  addInst(facet(trunk, 0.1), new THREE.MeshStandardMaterial({ color: 0x8a6a48, flatShading: true }), palms, ([x, y, z, r, sc]) => m4.compose(v.set(x, y - 0.2, z), q.setFromAxisAngle(up, r), sv.set(sc, sc, sc)));
  addInst(fronds, new THREE.MeshStandardMaterial({ color: 0x3f8a3a, flatShading: true, side: THREE.DoubleSide }), palms, ([x, y, z, r, sc]) => m4.compose(v.set(x, y - 0.2, z), q.setFromAxisAngle(up, r), sv.set(sc, sc, sc)));
  const pole = merge([new THREE.CylinderGeometry(0.07, 0.1, 6.2, 6).translate(0, 3.1, 0), new THREE.BoxGeometry(0.1, 0.1, 1.6).translate(0, 6.1, 0.75)]);
  addInst(pole, new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5 }), lamps, ([x, y, z, yaw]) => m4.compose(v.set(x, y, z), q.setFromAxisAngle(up, yaw), sv.set(1, 1, 1)));
  const head = new THREE.BoxGeometry(0.35, 0.16, 0.6).translate(0, 6.0, 1.5);
  addInst(head, new THREE.MeshBasicMaterial({ color: night > 0.3 ? 0xffe6b0 : 0xd8d8d0 }), lamps, ([x, y, z, yaw]) => m4.compose(v.set(x, y, z), q.setFromAxisAngle(up, yaw), sv.set(1, 1, 1)));

  // --- Banners across the road on gantries, and strings of flags.
  const bannerTex = canvasTex(256, 48, (g, W, H) => {
    g.fillStyle = '#c4162a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f1ede2'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SIDEWAYS GRAND PRIX', W / 2, H / 2 + 1);
  });
  bannerTex.wrapS = THREE.ClampToEdgeWrapping;
  const flagCols = [0xc4162a, 0xf1ede2, 0xf2c230, 0x2a6fd8, 0x1f9e5a];
  for (let a = start + 140; a < finish - 60; a += 260 + rnd() * 120) {
    if (inTunnel(tunnels, a, 20)) continue;
    const p = at(road, a, 0), yaw = Math.atan2(road.tx[p.i], road.tz[p.i]);
    const gnt = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.5 });
    for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7.5, 0.3), metal); post.position.set(s * (B + 1.0), 3.75, 0); gnt.add(post); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(B * 2 + 2, 0.3, 0.3), metal); beam.position.y = 7.4; gnt.add(beam);
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(B * 1.6, 1.4), new THREE.MeshStandardMaterial({ map: bannerTex, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: night * 0.6 }));
    ban.position.y = 6.5; gnt.add(ban);
    // Bunting: little triangles from the beam's ends to the lamp posts.
    for (let k = 0; k < 18; k++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 3).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: flagCols[k % flagCols.length], flatShading: true }));
      const u = k / 17;
      f.position.set((u - 0.5) * (B * 2 + 2), 7.1 - Math.sin(u * Math.PI) * 0.6, 0.5);
      gnt.add(f);
    }
    gnt.position.set(p.x, p.y, p.z); gnt.rotation.y = yaw;
    gnt.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(gnt);
  }

  return { group, nightMaterials: [bmat], barrier: B };
}

// ---------- Harbour ----------
// A marina beside a straight bit of a street circuit: a rectangular basin
// behind the promenade, quay walls, jetties and yachts at their moorings.
// The ground is carved down so the water sits in it.
export function planHarbour(road, { seed = 1, start = 0, finish = road.length, tunnels = [] }) {
  const rnd = mulberry32((seed * 69069 + 777) >>> 0);
  const B = road.width / 2 + BARRIER_GAP, L = 190, D = 80;
  const head = (a) => { const i = road.indexAt(a); return Math.atan2(road.tx[i], road.tz[i]); };
  const tries = [];
  for (let a = start + 120; a < finish - L - 60; a += 25) tries.push(a);
  for (let k = tries.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [tries[k], tries[j]] = [tries[j], tries[k]]; }
  for (const a of tries) {
    if (inTunnel(tunnels, a + L / 2, L / 2 + 20)) continue;
    const dh = Math.atan2(Math.sin(head(a + L) - head(a)), Math.cos(head(a + L) - head(a)));
    if (Math.abs(dh) > 0.3) continue;
    for (const s of rnd() < 0.5 ? [1, -1] : [-1, 1]) {
      const mid = a + L / 2, c = at(road, mid, s * (B + 14 + D / 2)), yaw = head(mid);
      const h = { cx: c.x, cz: c.z, yaw, L, D, y: road.py[c.i] - 1.2, side: s };
      // Nothing of the road may run through the basin (or too close to it).
      let ok = true;
      for (let u = -0.5; u <= 0.5 && ok; u += 0.125) for (let v = -0.5; v <= 0.5 && ok; v += 0.25) {
        const p = toWorld(h, u * L, v * D);
        if (road.nearest(p[0], p[1]).dist < B + 12) ok = false;
      }
      if (ok) return h;
    }
  }
  return null;
}
// Harbour local (u along the road, v across) to world, and back.
function toWorld(h, u, v) {
  const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
  return [h.cx + fx * u + fz * v, h.cz + fz * u - fx * v];
}
function toLocal(h, x, z) {
  const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw), dx = x - h.cx, dz = z - h.cz;
  return [dx * fx + dz * fz, dx * fz - dz * fx];
}
export const inHarbour = (h, x, z, pad = 0) => { const [u, v] = toLocal(h, x, z); return Math.abs(u) < h.L / 2 + pad && Math.abs(v) < h.D / 2 + pad; };
// Ground inside the basin goes down below the water.
export function harbourCarve(h) {
  return (x, z, ht) => {
    const [u, v] = toLocal(h, x, z);
    const out = Math.max(Math.abs(u) - h.L / 2, Math.abs(v) - h.D / 2);
    if (out > 10) return ht;
    const floor = h.y - 3;
    if (out <= 0) return Math.min(ht, floor);
    return Math.min(ht, floor + (Math.max(ht, h.y + 1.2) - floor) * (out / 10));
  };
}

export function buildHarbour(h, { seed = 1 }) {
  const rnd = mulberry32((seed * 31337 + 4242) >>> 0);
  const group = new THREE.Group();
  const place = (obj, u, v, y, yaw = 0) => { const [x, z] = toWorld(h, u, v); obj.position.set(x, y, z); obj.rotation.y = h.yaw + yaw; group.add(obj); return obj; };
  // Water.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(h.D + 2, h.L + 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1f6f95, roughness: 0.15, metalness: 0.25, transparent: true, opacity: 0.92 }));
  place(water, 0, 0, h.y);
  // Quay walls around the edge.
  const quay = new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 0.9 });
  for (const [u, v, w, d] of [[0, h.D / 2, h.L + 3, 1.5], [0, -h.D / 2, h.L + 3, 1.5], [h.L / 2, 0, 1.5, h.D + 3], [-h.L / 2, 0, 1.5, h.D + 3]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(d, 4.4, w), quay);
    wall.castShadow = wall.receiveShadow = true;
    place(wall, u, v, h.y - 0.9);
  }
  // Jetties out from the town-side quay, yachts moored either side.
  const roadSide = -h.side;                      // the quay nearest the road
  const jettyMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.95 });
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.4 });
  const trimMat = [0x16365c, 0x1f9e5a, 0xc4162a, 0x16181d, 0xb9aa5c].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
  const glass = new THREE.MeshStandardMaterial({ color: 0x24303e, roughness: 0.2, metalness: 0.4 });
  const mastMat = new THREE.MeshStandardMaterial({ color: 0xd9d9d9, roughness: 0.4 });
  const hullGeo = (len, wd) => {
    // A box hull with a pointed bow.
    const g = new THREE.CylinderGeometry(wd / 2, wd / 2, len, 4, 1).rotateY(Math.PI / 4).rotateX(Math.PI / 2).scale(1, 0.6, 1);
    return g;
  };
  for (let u = -h.L / 2 + 16; u < h.L / 2 - 10; u += 26) {
    const len = h.D * 0.62;
    const jetty = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, len), jettyMat);
    place(jetty, u, roadSide * (h.D / 2 - len / 2), h.y + 0.5, Math.PI / 2);
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        if (rnd() < 0.2) continue;
        const L = 9 + rnd() * 9, W = 3 + rnd() * 1.5, sail = rnd() < 0.5;
        const yacht = new THREE.Group();
        const hull = new THREE.Mesh(hullGeo(L, W), hullMat); hull.position.y = 0.3; yacht.add(hull);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(W * 0.72, 0.18, L * 0.7), trimMat[Math.floor(rnd() * trimMat.length)]); stripe.position.y = 0.55; yacht.add(stripe);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.55, 1.2, L * 0.35), hullMat); cabin.position.set(0, 1.3, -L * 0.08); yacht.add(cabin);
        const win = new THREE.Mesh(new THREE.BoxGeometry(W * 0.57, 0.4, L * 0.3), glass); win.position.set(0, 1.5, -L * 0.08); yacht.add(win);
        if (sail) { const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, L * 1.2, 5), mastMat); mast.position.set(0, L * 0.6 + 0.8, L * 0.05); yacht.add(mast); }
        else { const fly = new THREE.Mesh(new THREE.BoxGeometry(W * 0.4, 0.8, L * 0.2), hullMat); fly.position.set(0, 2.3, -L * 0.05); yacht.add(fly); }
        yacht.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        // Moored at right angles to the jetty, bow out.
        const vAlong = roadSide * (h.D / 2 - 6 - k * (len / 3.2));
        place(yacht, u + side * (W / 2 + 1.6), vAlong, h.y, side > 0 ? 0 : Math.PI);
        yacht.userData.bob = rnd() * 6;
      }
    }
  }
  return {
    group,
    update(t) { for (const o of group.children) if (o.userData.bob != null) { o.position.y = h.y + Math.sin(t * 0.9 + o.userData.bob) * 0.08; o.rotation.z = Math.sin(t * 0.7 + o.userData.bob) * 0.02; } },
  };
}

// ---------- Fireworks ----------
// Bursts of coloured sparks over the town after dark: each rises unseen,
// bursts into a sphere of embers that fall and fade, and booms a moment
// later (sound travels slower than light).
export class Fireworks {
  constructor(scene, n = 900) {
    this.n = n; this.next = 0; this.timer = 1;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.base = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.6, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  burst(x, y, z) {
    const PAL = [[1, 0.25, 0.2], [1, 0.8, 0.25], [0.3, 0.6, 1], [0.4, 1, 0.5], [1, 0.4, 0.9], [1, 1, 1]];
    const c = PAL[Math.floor(Math.random() * PAL.length)], sp = 13 + Math.random() * 8;
    for (let k = 0; k < 90; k++) {
      const i = this.next++ % this.n;
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), s = sp * (0.85 + Math.random() * 0.3);
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(a) * r * s, u * s, Math.sin(a) * r * s], i * 3);
      this.base.set(c, i * 3);
      this.life[i] = 1.6 + Math.random() * 0.6;
    }
  }

  // on: fireworks tonight; at: where to set them off around ({x, z, y});
  // boom(volume, delay): sound for a burst.
  update(dt, on, at, boom) {
    if (on) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 0.8 + Math.random() * 2.2;
        const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 120;
        const x = at.x + Math.cos(a) * d, z = at.z + Math.sin(a) * d, y = at.y + 45 + Math.random() * 35;
        this.burst(x, y, z);
        boom?.(Math.max(0.15, 0.6 - d / 400), Math.hypot(d, y - at.y) / 343);
      }
    }
    const col = this.points.geometry.attributes.color;
    let alive = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { col.setXYZ(i, 0, 0, 0); continue; }
      alive = true;
      this.life[i] -= dt;
      const p = i * 3;
      this.vel[p] *= 1 - dt * 1.2; this.vel[p + 2] *= 1 - dt * 1.2; this.vel[p + 1] = this.vel[p + 1] * (1 - dt * 1.2) - 6 * dt;
      this.pos[p] += this.vel[p] * dt; this.pos[p + 1] += this.vel[p + 1] * dt; this.pos[p + 2] += this.vel[p + 2] * dt;
      const f = Math.max(0, Math.min(1, this.life[i] / 1.2)) * (0.75 + Math.random() * 0.25);
      col.setXYZ(i, this.base[p] * f, this.base[p + 1] * f, this.base[p + 2] * f);
    }
    this.points.visible = alive;
    this.points.geometry.attributes.position.needsUpdate = true;
    col.needsUpdate = true;
  }
}
