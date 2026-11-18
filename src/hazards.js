// Rare stage hazards: a fallen tree across the road, or a landslide of rocks
// spilling over one side. Picked from the stage seed, so they're the same on
// every attempt. Some are already lying there at the start; others happen
// mid-stage as you approach (a tree topples, rocks tumble down the slope),
// and they happen at the same spot every time you restart.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

export const HAZARD_DEBUG = { force: null };   // e.g. [{ kind: 'tree', mid: true }] for tests

const ease = (t) => t * t;                          // gravity: slow start, fast finish
const clamp01 = (t) => Math.max(0, Math.min(1, t));

// Which hazards a stage gets (usually none).
// Special days with hand-picked events.
const FORCED = {
  20261012: [{ kind: 'tree', mid: true }, { kind: 'slide', mid: true }],
  20261013: [{ kind: 'tree', mid: true }, { kind: 'slide', mid: true }],
};

function pickHazards(seed, theme) {
  if (HAZARD_DEBUG.force) return HAZARD_DEBUG.force.map((h) => ({ ...h }));
  if (FORCED[seed]) return FORCED[seed].map((h) => ({ ...h }));
  const r = mulberry32(((seed * 2654435761) ^ 0x7f4a7c15) >>> 0);
  const out = [];
  const treeChance = theme.id === 'desert' ? 0 : 0.2;
  const slideChance = theme.id === 'alpine' || theme.id === 'desert' ? 0.2 : 0.1;
  if (r() < treeChance) out.push({ kind: 'tree', mid: r() < 0.5 });
  if (r() < slideChance) out.push({ kind: 'slide', mid: r() < 0.5 });
  return out;
}

// A spot on a straight-ish bit of road away from jumps, sharp corners,
// checkpoints and other hazards.
function pickSpot(road, rnd, { start, finish, cps, corners, taken }) {
  for (let tries = 0; tries < 60; tries++) {
    const a = start + 150 + rnd() * Math.max(1, finish - start - 280);
    if ((road.bumps || []).some((b) => Math.abs(b.at - a) < 70)) continue;
    if (corners.some((c) => a > c.entry - 60 && a < c.exit + 20)) continue;
    if (cps.some((c) => Math.abs(c - a) < 40)) continue;
    if (taken.some((t) => Math.abs(t - a) < 160)) continue;
    return a;
  }
  return null;
}

// World position at distance `along` and sideways offset `lat` (left positive).
function roadPoint(road, along, lat) {
  const i = road.indexAt(along);
  const lx = road.tz[i], lz = -road.tx[i];
  return { x: road.px[i] + lx * lat, z: road.pz[i] + lz * lat, y: road.py[i], i };
}

export function buildHazards(road, { seed, theme, groundY, start, finish, cps, corners }) {
  const group = new THREE.Group();
  const list = [];
  const rnd = mulberry32(((seed * 1597334677) ^ 0x2c1b3c6d) >>> 0);
  const taken = [];
  for (const h of pickHazards(seed, theme)) {
    const at = h.at ?? pickSpot(road, rnd, { start, finish, cps, corners, taken });
    if (at == null) continue;
    taken.push(at);
    const hz = h.kind === 'tree' ? fallenTree(road, rnd, at, h.mid, theme, groundY) : landslide(road, rnd, at, h.mid, theme, groundY);
    group.add(hz.root);
    list.push(hz);
  }

  return {
    group,
    list,
    // Obstacles the car can currently hit.
    obstacles() {
      const out = [];
      for (const h of list) for (const o of h.obstacles) if (o.on) out.push(o);
      return out;
    },
    // Is (x, z) on landslide rubble? (rough, slow ground)
    rubbleAt(x, z) {
      for (const h of list) {
        if (h.kind !== 'slide' || h.progress < 0.6) continue;
        for (const m of h.mounds) if ((x - m.x) ** 2 + (z - m.z) ** 2 < m.r * m.r) return true;
      }
      return false;
    },
    reset() { for (const h of list) h.set(h.mid ? 0 : 1); for (const h of list) { h.fired = !h.mid; h.timer = 0; } },
    // along: car's distance along the road. fx: { dust(x,y,z,vx,vy,vz,size,life,col), thud(v), toast(msg) }
    update(dt, along, fx) {
      for (const h of list) {
        if (!h.fired && along > h.at - h.trigger) {
          h.fired = true; h.timer = 0;
          // Came in past it (respawn, shortcut): it's already happened.
          if (along > h.at + 20) { h.set(1); continue; }
          h.onStart?.(fx);
        }
        if (h.fired && h.progress < 1) {
          h.timer += dt;
          h.set(clamp01(h.timer / h.duration), fx);
        }
      }
    },
  };
}

// ---------- Fallen tree ----------
function fallenTree(road, rnd, at, mid, theme, groundY) {
  const w = road.width;
  const side = rnd() < 0.5 ? 1 : -1;
  const rootP = roadPoint(road, at, side * (w / 2 + 4.2));
  const topP = roadPoint(road, at + (rnd() - 0.5) * 8, -side * (0.3 + rnd() * 1.0));
  const rootY = groundY(rootP.x, rootP.z) + 0.25;
  const top = new THREE.Vector3(topP.x, topP.y + 0.38, topP.z);
  const root = new THREE.Vector3(rootP.x, rootY, rootP.z);
  const v = top.clone().sub(root);
  const L = v.length() + 1.5;                         // a bit of tip past the last obstacle
  const axis = new THREE.Vector3(v.z, 0, -v.x).normalize();
  const finalAngle = Math.acos(v.y / v.length());

  // Built standing up along +Y from the root; rotated about `axis` to fall.
  const g = new THREE.Group();
  g.position.copy(root);
  const bark = new THREE.MeshStandardMaterial({ color: 0x5a4330, flatShading: true, roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0xc9a77a, flatShading: true });
  const dirt = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, flatShading: true, roughness: 1 });
  const leafCol = theme.id === 'autumn' ? 0xb8642a : theme.id === 'snow' ? 0x3d5a40 : 0x3f5a2a;
  const leaf = new THREE.MeshStandardMaterial({ color: leafCol, flatShading: true, roughness: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.36, L, 7), bark);
  trunk.position.y = L / 2; trunk.castShadow = true;
  g.add(trunk);
  // Broken branch stubs.
  for (let k = 0; k < 6; k++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, 1.2 + rnd(), 4), bark);
    const yy = L * (0.35 + rnd() * 0.4), a = rnd() * Math.PI * 2;
    b.position.set(Math.cos(a) * 0.4, yy, Math.sin(a) * 0.4);
    b.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    g.add(b);
  }
  // Crown near the top.
  const broad = theme.id === 'autumn';
  for (let k = 0; k < 5; k++) {
    const s = 0.9 + rnd() * 0.6;
    const m = broad ? new THREE.Mesh(new THREE.IcosahedronGeometry(s * 1.1, 0), leaf) : new THREE.Mesh(new THREE.ConeGeometry(s, s * 2.2, 6), leaf);
    m.position.set((rnd() - 0.5) * 0.6, L * (0.62 + k * 0.08), (rnd() - 0.5) * 0.6);
    m.castShadow = true;
    g.add(m);
  }
  // Root plate (torn up out of the ground) and a sawn-looking ring.
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.1, 0.5, 8), dirt);
  plate.position.y = -0.1;
  g.add(plate);
  const ring = new THREE.Mesh(new THREE.CircleGeometry(0.33, 7), wood);
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.36;
  g.add(ring);

  // Collision: circles along the lying trunk, bigger round the crown.
  const obstacles = [];
  const dir = v.clone().normalize();
  const tl = v.length();
  for (let s = 0; s <= tl + 0.01; s += 0.7) {
    const p = root.clone().addScaledVector(dir, s);
    obstacles.push({ x: p.x, z: p.z, r: s > tl * 0.62 ? 0.75 : 0.45, on: false });
  }

  const q = new THREE.Quaternion();
  const hz = {
    kind: 'tree', at, mid, root: g, obstacles, progress: 1,
    trigger: 50 + rnd() * 30, duration: 1.7, fired: !mid, timer: 0,
    set(t, fx) {
      const was = this.progress;
      this.progress = t;
      // Fall with gravity, then a little bounce as it hits.
      let ang = finalAngle * ease(clamp01(t / 0.82));
      if (t > 0.82) ang = finalAngle - Math.sin(((t - 0.82) / 0.18) * Math.PI) * 0.06;
      q.setFromAxisAngle(axis, ang);
      g.quaternion.copy(q);
      plate.visible = ring.visible = t > 0.05;
      for (const o of obstacles) o.on = t >= 0.8;
      if (fx && was < 0.8 && t >= 0.8) {
        fx.thud(1);
        fx.shake?.(0.35);
        for (let n = 0; n < 50; n++) {
          const p = root.clone().addScaledVector(dir, tl * (0.4 + rnd() * 0.6));
          const a = rnd() * Math.PI * 2, sp = 1 + rnd() * 4;
          fx.dust(p.x, p.y + 0.3, p.z, Math.cos(a) * sp, 0.6 + rnd() * 2, Math.sin(a) * sp, 1.4, 1.8, theme.road.dust);
        }
      }
    },
    onStart(fx) { fx.creak?.(); },
  };
  hz.set(mid ? 0 : 1);
  return hz;
}

// ---------- Landslide ----------
function landslide(road, rnd, at, mid, theme, groundY) {
  const w = road.width;
  // Rocks come down from the uphill side.
  const L = roadPoint(road, at, 14), R = roadPoint(road, at, -14);
  const side = groundY(L.x, L.z) >= groundY(R.x, R.z) ? 1 : -1;
  const g = new THREE.Group();
  const rc = theme.ground.rock;
  const rockMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(rc[0] * 1.1, rc[1] * 1.1, rc[2] * 1.1, THREE.SRGBColorSpace), flatShading: true, roughness: 1 });
  const dc = theme.road.dust;
  const dirtMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(dc[0] * 0.55, dc[1] * 0.5, dc[2] * 0.45, THREE.SRGBColorSpace), flatShading: true, roughness: 1 });

  // Reach: how far across the road the slide comes (leaves the far side open).
  const reach = w / 2 - (1.6 + rnd() * 1.4);        // lateral (towards -side) where it stops
  const rocks = [];
  const nRocks = 7 + Math.floor(rnd() * 4);
  for (let k = 0; k < nRocks; k++) {
    const lat = side * (w / 2 + 2.5 - rnd() * (w / 2 + 2.5 + reach - 0.6));
    const along = at + (rnd() - 0.5) * 12;
    const p = roadPoint(road, along, lat);
    const r = 0.45 + rnd() * 0.75;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
    m.scale.set(1, 0.75 + rnd() * 0.3, 1 + rnd() * 0.3);
    m.castShadow = true;
    g.add(m);
    const fy = groundY(p.x, p.z) + r * 0.6;
    const from = roadPoint(road, along + (rnd() - 0.5) * 6, lat + side * (18 + rnd() * 14));
    rocks.push({
      mesh: m, r, end: new THREE.Vector3(p.x, fy, p.z),
      from: new THREE.Vector3(from.x, groundY(from.x, from.z) + r, from.z),
      delay: rnd() * 0.35, spin: new THREE.Vector3(rnd() * 8, rnd() * 4, rnd() * 8), rot0: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6),
      landed: false,
    });
  }
  // Low dirt mounds you can drive over (slowly).
  const mounds = [];
  for (let k = 0; k < 4; k++) {
    const p = roadPoint(road, at + (k - 1.5) * 4 + (rnd() - 0.5) * 2, side * (w / 2 - 0.5 - rnd() * (w / 2 - 1 + reach * 0.4)));
    const r = 2.4 + rnd() * 1.4;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), dirtMat);
    m.position.set(p.x, groundY(p.x, p.z) - 0.05, p.z);
    m.rotation.y = rnd() * 6;
    m.userData.s = [r, 0.35 + rnd() * 0.15, r * (0.8 + rnd() * 0.4)];
    m.receiveShadow = true;
    g.add(m);
    mounds.push({ x: p.x, z: p.z, r: r * 0.9, mesh: m });
  }
  const obstacles = rocks.map((k) => ({ x: k.end.x, z: k.end.z, r: k.r * 0.95, on: false }));

  const hz = {
    kind: 'slide', at, mid, root: g, obstacles, mounds, progress: 1,
    trigger: 60 + rnd() * 30, duration: 2.6, fired: !mid, timer: 0, dustAcc: 0,
    set(t, fx) {
      const dt = Math.max(0, t - this.progress) * this.duration;
      this.progress = t;
      const time = t * this.duration;
      rocks.forEach((k, idx) => {
        const u = clamp01((time - k.delay) / (this.duration - 0.4 - k.delay));
        const pu = ease(Math.min(1, u * 1.15)) * 0.6 + u * 0.4;   // speeds up downhill
        k.mesh.position.lerpVectors(k.from, k.end, Math.min(1, pu));
        // Follow the ground on the way down, with shrinking bounces.
        const gy = groundY(k.mesh.position.x, k.mesh.position.z) + k.r * 0.6;
        k.mesh.position.y = u >= 1 ? k.end.y : gy + Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) * 1.6;
        k.mesh.rotation.set(k.rot0.x + k.spin.x * u, k.rot0.y + k.spin.y * u, k.rot0.z + k.spin.z * u);
        k.mesh.visible = t > 0 || !mid;
        const landed = u >= 1;
        obstacles[idx].on = landed;
        if (fx && landed && !k.landed) fx.thud(0.3 + k.r * 0.4);
        k.landed = landed;
        if (fx && u > 0 && u < 1 && rnd() < dt * 20) {
          const p = k.mesh.position;
          fx.dust(p.x, p.y, p.z, (rnd() - 0.5) * 2, 0.5 + rnd(), (rnd() - 0.5) * 2, 1.2 + rnd(), 1.6, dc);
        }
      });
      const s = ease(clamp01((time - 0.6) / (this.duration - 0.6)));
      for (const m of mounds) {
        const [a, b, c] = m.mesh.userData.s;
        m.mesh.scale.set(a * Math.max(0.01, s), b * Math.max(0.01, s), c * Math.max(0.01, s));
        m.mesh.visible = s > 0.01;
      }
    },
    onStart(fx) { fx.rumble?.(); fx.shake?.(0.2); },
  };
  hz.set(mid ? 0 : 1);
  return hz;
}
