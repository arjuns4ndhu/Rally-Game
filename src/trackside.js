// Trackside life: crowds behind tape at hairpins, jumps, the start and the
// finish, hay bales on the outside of sharp corners, and a TV helicopter
// over the finish. Spectators hop and step back as the car comes past.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { facet } from './retro.js';

const SHIRTS = [0xd8432b, 0x2a6fd8, 0xf2c230, 0x1f9e5a, 0xf1ede2, 0x7a3fd1, 0xff8a1c, 0x16181d, 0x3fc6d1];
const SKIN = [0xf1c6a0, 0xd9a47c, 0xa8724f, 0x7a4e33, 0xeac0a0];

function lateralPoint(road, along, lat) {
  const i = road.indexAt(Math.max(0, Math.min(road.length - 0.1, along)));
  return { x: road.px[i] + road.tz[i] * lat, z: road.pz[i] - road.tx[i] * lat, i };
}

export function buildTrackside(road, { seed, corners, start, finish, groundY }) {
  const rnd = mulberry32(((seed * 2246822519) ^ 0x68e31da4) >>> 0);
  const group = new THREE.Group();
  const people = [];           // { x, z, y, nx, nz, phase, h }
  const solid = [];            // hay bales the car can hit
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c4, roughness: 0.9 });
  const hayMat = new THREE.MeshStandardMaterial({ color: 0xd8b25a, flatShading: true, roughness: 1, vertexColors: true });
  const postGeo = new THREE.BoxGeometry(0.06, 1.0, 0.06);
  const hayGeo = facet(new THREE.CylinderGeometry(0.55, 0.55, 1.2, 8).rotateZ(Math.PI / 2), 0.15);

  // Tape line between posts, red/white stripes from vertex colours.
  const tapeLine = (pts) => {
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(p.x, p.y + 0.5, p.z);
      group.add(post);
      if (k === 0) continue;
      const q = pts[k - 1], dx = p.x - q.x, dz = p.z - q.z, len = Math.hypot(dx, dz);
      const tape = new THREE.BoxGeometry(len, 0.07, 0.015, 8, 1, 1);
      const col = new Float32Array(tape.attributes.position.count * 3);
      for (let v = 0; v < tape.attributes.position.count; v++) {
        const red = Math.floor((tape.attributes.position.getX(v) / len + 0.5) * 8) % 2 === 0;
        col.set(red ? [0.85, 0.12, 0.1] : [1, 1, 1], v * 3);
      }
      tape.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.Mesh(tape, tapeMat);
      m.position.set((p.x + q.x) / 2, (p.y + q.y) / 2 + 0.85, (p.z + q.z) / 2);
      m.rotation.y = -Math.atan2(dz, dx);
      group.add(m);
    }
  };

  // A crowd spot: tape along the road at `lat`, people standing behind it.
  const crowd = (from, to, side, lat, n) => {
    const pts = [];
    for (let a = from; a <= to; a += 4) {
      const p = lateralPoint(road, a, side * lat);
      pts.push({ x: p.x, z: p.z, y: groundY(p.x, p.z) });
    }
    if (pts.length > 1) tapeLine(pts);
    for (let k = 0; k < n; k++) {
      const a = from + rnd() * (to - from), l = side * (lat + 1 + rnd() * 3.5);
      const p = lateralPoint(road, a, l);
      people.push({ x: p.x, z: p.z, y: groundY(p.x, p.z), nx: road.tz[p.i] * side, nz: -road.tx[p.i] * side, phase: rnd() * 6, h: 0.9 + rnd() * 0.25, shirt: SHIRTS[Math.floor(rnd() * SHIRTS.length)], skin: SKIN[Math.floor(rnd() * SKIN.length)], yaw: Math.atan2(-road.tz[p.i] * side, road.tx[p.i] * side) });
    }
  };

  const w = road.width / 2;
  for (const c of corners) {
    const outside = -c.dir;
    // Hay bales on the outside of the apex.
    for (let k = -2; k <= 2; k++) {
      const p = lateralPoint(road, c.apex + k * 1.4, outside * (w + 2.2));
      const m = new THREE.Mesh(hayGeo, hayMat);
      const yaw = Math.atan2(road.tx[p.i], road.tz[p.i]);
      m.position.set(p.x, groundY(p.x, p.z) + 0.5, p.z);
      m.rotation.y = yaw + Math.PI / 2;
      m.castShadow = true;
      group.add(m);
      solid.push({ x: p.x, z: p.z, r: 0.55 });
    }
    // Crowd on the inside of the hairpin (the safe side) for most corners.
    if (rnd() < 0.75) crowd(c.entry - 6, c.exit + 6, c.dir, w + 7, 8 + Math.floor(rnd() * 10));
  }
  for (const b of road.bumps || []) {
    if (b.kind !== 'jump') continue;
    const side = rnd() < 0.5 ? 1 : -1;
    crowd(b.at - 8, b.at + 22, side, w + 8, 10 + Math.floor(rnd() * 10));
  }
  crowd(start - 30, start - 4, 1, w + 6, 14);
  crowd(start - 30, start - 4, -1, w + 6, 10);
  crowd(finish + 4, finish + 34, 1, w + 6, 12);

  // People: two instanced meshes (shirts and heads) built from small boxes.
  const bodyGeo = facet(new THREE.BoxGeometry(0.42, 0.62, 0.26).translate(0, 0.31, 0), 0.15);
  const legGeo = facet(new THREE.BoxGeometry(0.36, 0.7, 0.22).translate(0, -0.35, 0), 0.15);
  const headGeo = facet(new THREE.BoxGeometry(0.24, 0.26, 0.24).translate(0, 0.77, 0), 0.15);
  const mk = (geo, color) => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9, vertexColors: true }), Math.max(1, people.length));
    m.count = people.length;
    if (color) people.forEach((p, i) => m.setColorAt(i, new THREE.Color(color(p))));
    m.frustumCulled = false;
    group.add(m);
    return m;
  };
  const bodies = mk(bodyGeo, (p) => p.shirt), legs = mk(legGeo, () => 0x2b3140), heads = mk(headGeo, (p) => p.skin);

  // TV helicopter circling over the finish.
  const heli = new THREE.Group();
  const hb = new THREE.MeshStandardMaterial({ color: 0x1c2a44, flatShading: true });
  heli.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 3.0), hb));
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 3.2), hb); tail.position.set(0, 0.2, -2.8); heli.add(tail);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(7, 0.05, 0.25), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  rotor.position.y = 0.75; heli.add(rotor);
  const fp = lateralPoint(road, finish, 0);
  const heliBase = new THREE.Vector3(fp.x, road.py[fp.i] + 28, fp.z);
  group.add(heli);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let t = 0;
  const pose = (carX, carZ) => {
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const d = carX == null ? 99 : Math.hypot(carX - p.x, carZ - p.z);
      const near = Math.max(0, 1 - d / 26);
      // Cheer (hop) and step back as the car passes.
      const hop = near > 0 ? Math.abs(Math.sin(t * 9 + p.phase)) * 0.25 * near : Math.abs(Math.sin(t * 2 + p.phase)) * 0.03;
      const back = near * 1.6;
      v.set(p.x + p.nx * back, p.y + 0.7 * p.h + hop, p.z + p.nz * back);
      q.setFromAxisAngle(up, p.yaw + Math.sin(t * 1.3 + p.phase) * 0.2);
      s.setScalar(p.h);
      m4.compose(v, q, s);
      bodies.setMatrixAt(i, m4); legs.setMatrixAt(i, m4); heads.setMatrixAt(i, m4);
    }
    bodies.instanceMatrix.needsUpdate = legs.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
  };
  pose();

  return {
    group, obstacles: solid, count: people.length,
    update(dt, carX, carZ) {
      t += dt;
      pose(carX, carZ);
      rotor.rotation.y += dt * 30;
      heli.position.set(heliBase.x + Math.cos(t * 0.15) * 30, heliBase.y + Math.sin(t * 0.7) * 1.5, heliBase.z + Math.sin(t * 0.15) * 30);
      heli.rotation.y = -t * 0.15;
      heli.rotation.z = 0.12;
    },
  };
}
