// Countryside lanes and mountain-edge roads.
// Country: a narrow lane boxed in by dry-stone walls and hedgerows, with
// cottages in little villages, a church spire, sheep in the fields and
// telegraph poles. Mountain edge: a road on a ledge, a stone parapet and
// guardrail on the drop side, a kerb along the rock face.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { facet } from './retro.js';
import { merge, at, wallStrip, canvasTex } from './street.js';

// A thick wall along the road: inner face, outer face and a top.
// y0: how far below road level the faces start (deep for walls on a slope).
function thickWall(road, from, to, lat, side, h, t, step = 2, y0 = 0) {
  const inner = wallStrip(road, from, to, side * lat, y0, h, step);
  const outer = wallStrip(road, from, to, side * (lat + t), y0, h, step);
  const top = [], uv = [];
  let prev = null;
  for (let a = from; a <= to + 0.01; a += step) {
    const p0 = at(road, a, side * lat), p1 = at(road, a, side * (lat + t));
    if (prev) {
      top.push(prev[0].x, prev[0].y + h, prev[0].z, p0.x, p0.y + h, p0.z, p1.x, p1.y + h, p1.z, prev[0].x, prev[0].y + h, prev[0].z, p1.x, p1.y + h, p1.z, prev[1].x, prev[1].y + h, prev[1].z);
      uv.push(0, 0, 1, 0, 1, 0.3, 0, 0, 1, 0.3, 0, 0.3);
    }
    prev = [p0, p1];
  }
  // End caps: close off both ends of the wall.
  for (const a of [from, to]) {
    const p0 = at(road, a, side * lat), p1 = at(road, a, side * (lat + t));
    top.push(p0.x, p0.y + y0, p0.z, p1.x, p1.y + y0, p1.z, p1.x, p1.y + h, p1.z, p0.x, p0.y + y0, p0.z, p1.x, p1.y + h, p1.z, p0.x, p0.y + h, p0.z);
    uv.push(0, 0, 0.3, 0, 0.3, 1, 0, 0, 0.3, 1, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  // Walls are built ground-up from the road height; sink them a little.
  return merge([inner, outer, g]).translate(0, -0.25, 0);
}

const stoneTex = () => canvasTex(64, 32, (g, W, H) => {
  g.fillStyle = '#8d877a'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 6) for (let x = (y / 6) % 2 ? -6 : 0; x < W; x += 12) {
    const l = 100 + Math.floor(Math.random() * 60);
    g.fillStyle = `rgb(${l},${l - 4},${l - 14})`; g.fillRect(x + 1, y + 1, 10, 4);
  }
});

const instance = (group, geo, mat, list, mk) => {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  im.count = list.length;
  list.forEach((it, k) => im.setMatrixAt(k, mk(it)));
  im.castShadow = true; im.receiveShadow = true;
  group.add(im);
  return im;
};

// ---------- Countryside ----------
export const LANE_WALL = 0.5;    // walls stand this far beyond the road edge

export function buildCountry(road, { seed = 1, start = 0, finish = road.length, groundY }) {
  const rnd = mulberry32((seed * 1103515245 + 12345) >>> 0);
  const group = new THREE.Group();
  const w = road.width / 2, L = w + LANE_WALL;
  const clearOf = (x, z, d) => road.nearest(x, z).dist > d;

  // --- Boundaries: stretches of dry-stone wall and hedgerow on each side.
  const walls = [], hedges = [];
  for (const s of [-1, 1]) {
    for (let a = 0; a < road.length;) {
      const len = 30 + rnd() * 70;
      const to = Math.min(road.length, a + len);
      (rnd() < 0.55 ? walls : hedges).push([a, to, s]);
      a = to;
    }
  }
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: 1, side: THREE.DoubleSide });
  if (walls.length) group.add(Object.assign(new THREE.Mesh(merge(walls.map(([f, t, s]) => thickWall(road, f, t, L, s, 1.25, 0.55))), stone), { castShadow: true, receiveShadow: true }));
  const hedgeTex = canvasTex(32, 32, (g, W, H) => {
    g.fillStyle = '#2f5a24'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 160; k++) { const l = Math.random(); g.fillStyle = l < 0.5 ? '#3c6e2c' : l < 0.85 ? '#24481c' : '#5a8a3a'; g.fillRect(Math.random() * W, Math.random() * H, 3, 3); }
  });
  const hedge = new THREE.MeshStandardMaterial({ map: hedgeTex, roughness: 1, side: THREE.DoubleSide, flatShading: true });
  if (hedges.length) group.add(Object.assign(new THREE.Mesh(merge(hedges.map(([f, t, s]) => thickWall(road, f, t, L, s, 2.1, 1.1, 3))), hedge), { castShadow: true, receiveShadow: true }));

  // --- Telegraph poles, leaning a little, along one side.
  const poles = [];
  const pSide = rnd() < 0.5 ? -1 : 1;
  for (let a = start - 30; a < finish + 30; a += 38 + rnd() * 6) {
    const p = at(road, a, pSide * (L + 2.5));
    if (clearOf(p.x, p.z, L + 1.5)) poles.push([p.x, groundY(p.x, p.z), p.z, (rnd() - 0.5) * 0.08]);
  }
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), sv = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
  const poleGeo = merge([new THREE.CylinderGeometry(0.11, 0.15, 8, 6).translate(0, 4, 0), new THREE.BoxGeometry(1.4, 0.12, 0.12).translate(0, 7.3, 0)]);
  instance(group, poleGeo, new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95 }), poles, ([x, y, z, lean]) => m4.compose(v.set(x, y - 0.3, z), q.setFromEuler(e.set(lean, 0, lean)), sv.set(1, 1, 1)));

  // --- Villages: a cluster of cottages near the road, and a church.
  const cottages = [];
  const nVill = 1 + Math.floor(rnd() * 2);
  let church = null;
  for (let vI = 0; vI < nVill; vI++) {
    const centre = start + (finish - start) * (0.2 + 0.6 * rnd());
    for (let k = 0; k < 14; k++) {
      const a = centre + (rnd() - 0.5) * 160, s = rnd() < 0.5 ? -1 : 1;
      const wd = 6 + rnd() * 3, dp = 5 + rnd() * 2, h = 3 + rnd() * 1.5;
      const p = at(road, a, s * (L + 3 + dp / 2 + rnd() * 6));
      if (!clearOf(p.x, p.z, L + 1.6 + Math.max(wd, dp) / 2)) continue;
      if (cottages.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 9)) continue;
      const yaw = Math.atan2(road.tx[p.i], road.tz[p.i]);
      cottages.push({ x: p.x, z: p.z, y: groundY(p.x, p.z) - 0.3, yaw, wd, dp, h, white: rnd() < 0.5 });
    }
    if (!church) {
      for (let tries = 0; tries < 10 && !church; tries++) {
        const s = rnd() < 0.5 ? -1 : 1, p = at(road, centre + (rnd() - 0.5) * 80, s * (L + 18 + rnd() * 10));
        if (clearOf(p.x, p.z, L + 10) && !cottages.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 14)) church = { x: p.x, z: p.z, y: groundY(p.x, p.z) - 0.4, yaw: Math.atan2(road.tx[p.i], road.tz[p.i]) };
      }
    }
  }
  const walls3 = [], roofs = [], chimneys = [];
  for (const c of cottages) {
    const body = new THREE.BoxGeometry(c.wd, c.h, c.dp).translate(0, c.h / 2, 0);
    const col = new THREE.Color(c.white ? 0xf0ebe0 : 0xb7a98e);
    const n = body.attributes.position.count, ca = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) ca.set([col.r, col.g, col.b], k * 3);
    body.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    walls3.push(body.rotateY(c.yaw).translate(c.x, c.y, c.z));
    // Pitched slate roof: a triangular prism along the cottage.
    // A three-sided cylinder lying along the cottage, ridge up.
    const R = c.dp * 0.64;
    const roof = new THREE.CylinderGeometry(R, R, c.wd + 0.6, 3, 1).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 0.75, 1);
    roofs.push(roof.translate(0, c.h + R * 0.5 * 0.75, 0).rotateY(c.yaw).translate(c.x, c.y, c.z));
    chimneys.push(new THREE.BoxGeometry(0.6, 1.6, 0.6).translate(c.wd * 0.35, c.h + 1.2, 0).rotateY(c.yaw).translate(c.x, c.y, c.z));
  }
  if (church) {
    const add = (geo, list, color) => {
      if (color != null) { const col = new THREE.Color(color), n = geo.attributes.position.count, ca = new Float32Array(n * 3); for (let k = 0; k < n; k++) ca.set([col.r, col.g, col.b], k * 3); geo.setAttribute('color', new THREE.BufferAttribute(ca, 3)); }
      list.push(geo.rotateY(church.yaw).translate(church.x, church.y, church.z));
    };
    add(new THREE.BoxGeometry(8, 7, 16).translate(0, 3.5, 0), walls3, 0xa79c86);
    add(new THREE.BoxGeometry(4.6, 15, 4.6).translate(0, 7.5, 10), walls3, 0x9d927c);
    add(new THREE.CylinderGeometry(5.1, 5.1, 16.6, 3, 1).rotateX(-Math.PI / 2).scale(1, 0.7, 1).translate(0, 7 + 5.1 * 0.5 * 0.7, 0), roofs);
    add(new THREE.ConeGeometry(3.1, 11, 4).rotateY(Math.PI / 4).translate(0, 20.5, 10), roofs);
  }
  if (walls3.length) group.add(Object.assign(new THREE.Mesh(merge(walls3), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })), { castShadow: true, receiveShadow: true }));
  if (roofs.length) group.add(Object.assign(new THREE.Mesh(merge(roofs.map((g) => g.toNonIndexed())), new THREE.MeshStandardMaterial({ color: 0x3d434c, roughness: 0.8, flatShading: true })), { castShadow: true }));
  if (chimneys.length) group.add(Object.assign(new THREE.Mesh(merge(chimneys), new THREE.MeshStandardMaterial({ color: 0x8a5a44, roughness: 0.9 })), { castShadow: true }));

  // --- Sheep: little flocks out in the fields.
  const sheep = [];
  for (let f = 0; f < 18; f++) {
    const i = Math.floor(rnd() * road.n), s = rnd() < 0.5 ? -1 : 1;
    const cx = road.px[i] + road.tz[i] * s * (L + 14 + rnd() * 40), cz = road.pz[i] - road.tx[i] * s * (L + 14 + rnd() * 40);
    const n = 4 + Math.floor(rnd() * 10);
    for (let k = 0; k < n; k++) {
      const x = cx + (rnd() - 0.5) * 18, z = cz + (rnd() - 0.5) * 18;
      if (!clearOf(x, z, L + 6)) continue;
      sheep.push([x, groundY(x, z), z, rnd() * Math.PI * 2]);
    }
  }
  const body = facet(new THREE.BoxGeometry(0.7, 0.55, 1.1).translate(0, 0.62, 0), 0.12);
  const head = merge([new THREE.BoxGeometry(0.3, 0.32, 0.36).translate(0, 0.78, 0.66), ...[[-0.2, -0.35], [0.2, -0.35], [-0.2, 0.35], [0.2, 0.35]].map(([x, z]) => new THREE.BoxGeometry(0.1, 0.4, 0.1).translate(x, 0.2, z))]);
  const sheepM = (it) => m4.compose(v.set(it[0], it[1] - 0.05, it[2]), q.setFromEuler(e.set(0, it[3], 0)), sv.set(1, 1, 1));
  instance(group, body, new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 1, flatShading: true }), sheep, sheepM);
  instance(group, head, new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.9 }), sheep, sheepM);

  return { group, barrier: L };
}

// ---------- Mountain edge ----------
// side(i): + when the ground climbs on the road's left (the drop is right).
export const LEDGE = 1.0;

// steep(i): 0..1, how sheer the mountain is there; only sheer stretches get
// a retaining wall on the uphill side.
export function buildLedge(road, { side, steep = () => 1, tunnels = [] }) {
  const group = new THREE.Group();
  const w = road.width / 2, B = w + LEDGE;
  // Split the road into runs by which side the drop is on; tunnels have their own walls.
  const runs = [];
  let cur = null;
  for (let a = 0; a < road.length; a += 2) {
    const i = road.indexAt(a), sg = side(i);
    const inT = tunnels.some((t) => a > t.from && a < t.to);
    const drop = inT ? 0 : Math.abs(sg) < 0.15 ? 2 : sg > 0 ? -1 : 1;    // 2 = both sides
    const wall = drop !== 2 && drop !== 0 && steep(i) > 0.5;
    if (!cur || cur.drop !== drop || cur.wall !== wall) { cur = { drop, wall, from: a, to: a }; runs.push(cur); }
    cur.to = a + 2;
  }
  const parapet = [], kerbs = [], rails = [], posts = [];
  for (const r of runs) {
    if (!r.drop || r.to - r.from < 2) continue;
    for (const s of r.drop === 2 ? [-1, 1] : [r.drop]) {
      parapet.push(thickWall(road, r.from, r.to, B, s, 0.95, 0.5, 2, -4));
      rails.push(wallStrip(road, r.from, r.to, s * (B - 0.02), 1.0, 1.35));
      for (let a = r.from; a < r.to; a += 3) { const p = at(road, a, s * (B + 0.25)); posts.push([p.x, p.y, p.z]); }
    }
    // Where the mountain crowds the road: a masonry retaining wall holding
    // the slope back. Elsewhere the uphill side is an open bank.
    if (r.wall) kerbs.push(thickWall(road, Math.max(0, r.from - 2), Math.min(road.length, r.to + 2), B, -r.drop, 6.5, 3.5, 2, -1.5));
  }
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: 1, side: THREE.DoubleSide });
  if (parapet.length) group.add(Object.assign(new THREE.Mesh(merge(parapet), stone), { castShadow: true, receiveShadow: true }));
  const wallTex = stoneTex(); wallTex.repeat.set(1, 4);
  if (kerbs.length) group.add(Object.assign(new THREE.Mesh(merge(kerbs), new THREE.MeshStandardMaterial({ map: wallTex, color: 0xd8cfbe, roughness: 1, side: THREE.DoubleSide })), { castShadow: true, receiveShadow: true }));
  const railTex = canvasTex(64, 8, (g, W, H) => { for (let x = 0; x < W; x += 16) { g.fillStyle = '#f2f2ee'; g.fillRect(x, 0, 8, H); g.fillStyle = '#c4162a'; g.fillRect(x + 8, 0, 8, H); } });
  if (rails.length) group.add(new THREE.Mesh(merge(rails), new THREE.MeshStandardMaterial({ map: railTex, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide })));
  const m4 = new THREE.Matrix4();
  instance(group, new THREE.BoxGeometry(0.1, 1.4, 0.1).translate(0, 0.7, 0), new THREE.MeshStandardMaterial({ color: 0xdedbd2 }), posts, ([x, y, z]) => m4.makeTranslation(x, y, z));
  // Which sides stop the car: the drop side always (the parapet), the
  // uphill side only where there's a retaining wall.
  const wallSide = (i, s) => {
    const sg = side(i), drop = Math.abs(sg) < 0.15 ? 2 : sg > 0 ? -1 : 1;
    return drop === 2 || s === drop || steep(i) > 0.5 || tunnels.some((t) => road.cum[i] > t.from && road.cum[i] < t.to);
  };
  return { group, barrier: B, wallSide };
}
