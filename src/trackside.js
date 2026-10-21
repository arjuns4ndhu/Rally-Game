// Trackside life: crowds behind tape at hairpins, jumps, the start and the
// finish, little groups of fans all along the stage, marshals in orange at
// the checkpoints, hay bales on the outside of sharp corners, and a TV
// helicopter over the finish. Spectators cheer (arms up, flags waving) and
// step back as the car comes past, duck when it flies over a jump, and run
// if it slides towards them. Photographers at the corners and jumps fire
// their flashes as you pass (you really notice them at night).
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { facet } from './retro.js';

const SHIRTS = [0xd8432b, 0x2a6fd8, 0xf2c230, 0x1f9e5a, 0xf1ede2, 0x7a3fd1, 0xff8a1c, 0x16181d, 0x3fc6d1];
const SKIN = [0xf1c6a0, 0xd9a47c, 0xa8724f, 0x7a4e33, 0xeac0a0];
const FLAGS = [0xd8432b, 0xf2c230, 0x2a6fd8, 0xf1ede2, 0x1f9e5a, 0x16181d];
const VEST = 0xff6a00;

function lateralPoint(road, along, lat) {
  const i = road.indexAt(Math.max(0, Math.min(road.length - 0.1, along)));
  return { x: road.px[i] + road.tz[i] * lat, z: road.pz[i] - road.tx[i] * lat, i };
}

export function buildTrackside(road, { seed, corners, start, finish, cps = [], groundY, detail = 1 }) {
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

  const w = road.width / 2;
  // Never put anyone near any part of the road (hairpins fold the road back
  // on itself, so the nearest bit may not be the one we measured from).
  const safe = (x, z) => road.nearest(x, z).dist > w + 5.5;
  const addPerson = (p, side, extra = {}) => {
    if (!safe(p.x, p.z)) return;
    people.push({
      x: p.x, z: p.z, y: groundY(p.x, p.z), nx: road.tz[p.i] * side, nz: -road.tx[p.i] * side, phase: rnd() * 6, h: 0.9 + rnd() * 0.25,
      shirt: SHIRTS[Math.floor(rnd() * SHIRTS.length)], skin: SKIN[Math.floor(rnd() * SKIN.length)],
      yaw: Math.atan2(-road.tz[p.i] * side, road.tx[p.i] * side),
      flag: rnd() < 0.32 ? FLAGS[Math.floor(rnd() * FLAGS.length)] : null, keen: 0.6 + rnd() * 0.6, ...extra,
    });
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
      // Rows: the front row near the tape, more behind it.
      const a = from + rnd() * (to - from), l = side * (lat + 1 + rnd() * 5);
      addPerson(lateralPoint(road, a, l), side);
    }
  };
  // Photographers: in front of the tape (where they shouldn't be), dark
  // clothes, a camera held up to the face.
  function photographers(at, side, n) {
    for (let k = 0; k < n; k++) addPerson(lateralPoint(road, at + k * 5 + rnd() * 3, side * (w + 6 + rnd() * 1.5)), side, { shirt: 0x2a2d33, flag: null, photo: true, keen: 0.2, flashAt: 0 });
  }
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
    if (rnd() < 0.85) crowd(c.entry - 8, c.exit + 8, c.dir, w + 7, 16 + Math.floor(rnd() * 16));
    photographers(c.apex - 6, c.dir, 1 + Math.floor(rnd() * 2));
  }
  for (const b of road.bumps || []) {
    if (b.kind !== 'jump') continue;
    const side = rnd() < 0.5 ? 1 : -1;
    crowd(b.at - 8, b.at + 22, side, w + 8, 18 + Math.floor(rnd() * 14));
    photographers(b.at + 10, -side, 2);
  }
  crowd(start - 34, start - 4, 1, w + 6, 26);
  crowd(start - 34, start - 4, -1, w + 6, 20);
  // ...and lining the first stretch after the line, where you can see them.
  crowd(start + 8, start + 44, 1, w + 6, 22);
  crowd(start + 8, start + 44, -1, w + 6, 18);
  crowd(finish + 4, finish + 40, 1, w + 6, 24);
  crowd(finish + 4, finish + 40, -1, w + 6, 16);
  // Little groups of fans all along the stage, standing well back.
  for (let a = start + 60; a < finish - 40; a += (120 + rnd() * 80) / Math.max(0.35, detail)) {
    const side = rnd() < 0.5 ? 1 : -1, lat = w + 7 + rnd() * 6, n = 2 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) addPerson(lateralPoint(road, a + (rnd() - 0.5) * 7, side * (lat + rnd() * 2.5)), side);
  }
  // Marshals in orange at each checkpoint, one each side, flags ready.
  for (const at of cps) {
    for (const side of [1, -1]) addPerson(lateralPoint(road, at + 3, side * (w + 6)), side, { shirt: VEST, flag: 0xf2c230, h: 1.05, keen: 0.4, marshal: true });
  }


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
  // Arms (two per person, hanging from the shoulders) and the flags some carry.
  const armGeo = facet(new THREE.BoxGeometry(0.11, 0.5, 0.11).translate(0, -0.25, 0), 0.15);
  const arms = new THREE.InstancedMesh(armGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }), Math.max(1, people.length * 2));
  arms.count = people.length * 2;
  people.forEach((p, i) => { const c = new THREE.Color(p.shirt); arms.setColorAt(i * 2, c); arms.setColorAt(i * 2 + 1, c); });
  arms.frustumCulled = false;
  group.add(arms);
  const flagPeople = people.filter((p) => p.flag != null);
  const flagGeo = new THREE.PlaneGeometry(0.5, 0.34).translate(0.27, -0.12, 0);
  const flags = new THREE.InstancedMesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.9 }), Math.max(1, flagPeople.length));
  flags.count = flagPeople.length;
  flagPeople.forEach((p, i) => { p.flagIdx = i; flags.setColorAt(i, new THREE.Color(p.flag)); });
  flags.frustumCulled = false;
  group.add(flags);

  // Cameras for the photographers, and a few pooled flashes (a bright
  // sprite and one light that jumps to the latest flash at night).
  const photoPeople = people.filter((p) => p.photo);
  const camGeo = new THREE.BoxGeometry(0.2, 0.14, 0.14).translate(0, 0.78, 0.2);
  const cams = new THREE.InstancedMesh(camGeo, new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5 }), Math.max(1, photoPeople.length));
  cams.count = photoPeople.length;
  cams.frustumCulled = false;
  photoPeople.forEach((p, i) => { p.camIdx = i; });
  group.add(cams);
  const flashTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(230,240,255,0.8)'); gr.addColorStop(1, 'rgba(200,220,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const flashes = [];
  for (let k = 0; k < 6; k++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sp.visible = false; sp.life = 0;
    group.add(sp); flashes.push(sp);
  }
  const flashLight = new THREE.PointLight(0xe8f0ff, 0, 22, 1.6);
  group.add(flashLight);
  let nextFlash = 0;
  const fire = (p, dark) => {
    const sp = flashes[nextFlash++ % flashes.length];
    sp.position.set(p.x + p.nx * (p.run || 0) - Math.sin(p.yaw) * 0.25, p.y + 0.78 * p.h + 0.7 * p.h, p.z + p.nz * (p.run || 0) - Math.cos(p.yaw) * 0.25);
    sp.life = 0.09; sp.visible = true;
    sp.scale.setScalar(dark ? 2.6 : 1.1);
    if (dark) { flashLight.position.copy(sp.position); flashLight.intensity = 60; }
  };

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
  const am = new THREE.Matrix4(), rz = new THREE.Matrix4(), rx = new THREE.Matrix4(), sh = new THREE.Matrix4(), fm = new THREE.Matrix4();
  let t = 0;
  const qx = new THREE.Quaternion(), right = new THREE.Vector3(1, 0, 0);
  const pose = (carX, carZ, info = {}, dt = 0) => {
    let noise = 0;
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const d = carX == null ? 99 : Math.hypot(carX - p.x, carZ - p.z);
      const near = Math.max(0, 1 - d / 26);
      // Duck when the car flies over close by; run when it slides at you.
      p.duck = (p.duck || 0) + (((info.air && d < 24) ? 1 : 0) - (p.duck || 0)) * Math.min(1, dt * (info.air ? 14 : 3));
      if (carX != null && d < 8 && info.speed > 6 && !p.marshal) p.scare = 1.2;
      if (p.scare > 0) { p.scare -= dt; p.run = Math.min(5, (p.run || 0) + dt * 6); } else if (p.run > 0) p.run = Math.max(0, p.run - dt * 0.4);
      const running = p.scare > 0;
      // Photographers shoot as the car comes past.
      if (p.photo && d < 34 && d > 6 && t > (p.flashAt || 0)) { p.flashAt = t + 0.35 + rnd() * 0.9; fire(p, info.dark); }
      // Cheer (hop) and step back as the car passes.
      const hop = running ? Math.abs(Math.sin(t * 14 + p.phase)) * 0.18 : near > 0 ? Math.abs(Math.sin(t * 9 + p.phase)) * 0.25 * near * (1 - p.duck) : Math.abs(Math.sin(t * 2 + p.phase)) * 0.03;
      const back = near * 1.6 + (p.run || 0);
      v.set(p.x + p.nx * back, p.y + 0.7 * p.h + hop - p.duck * 0.42 * p.h, p.z + p.nz * back);
      // Running: turn and face away from the road.
      q.setFromAxisAngle(up, p.yaw + (running ? Math.PI : Math.sin(t * 1.3 + p.phase) * 0.2));
      if (p.duck > 0.02) q.multiply(qx.setFromAxisAngle(right, p.duck * 0.55));
      s.setScalar(p.h);
      m4.compose(v, q, s);
      bodies.setMatrixAt(i, m4); legs.setMatrixAt(i, m4); heads.setMatrixAt(i, m4);
      if (p.camIdx != null) cams.setMatrixAt(p.camIdx, m4);
      // Arms: down and swaying idle, up and waving as the car comes; over
      // the head when ducking, pumping when running.
      const cheer = Math.min(1, near * 1.8 * p.keen) * (1 - p.duck);
      noise += near * near * (p.marshal ? 0.2 : 1) + (p.scare > 0 ? 0.5 : 0) + p.duck * 0.6 * near;
      for (const side of [-1, 1]) {
        const wave = Math.sin(t * 10 + p.phase + side) * 0.35 * cheer;
        let ang = side * (0.12 + cheer * 2.5 + wave + Math.sin(t * 1.7 + p.phase) * 0.04);
        // Photographers hold the camera up to the eye: arms forward and in.
        const aim = p.photo && !running ? 1 - p.duck : 0;
        if (aim) ang = side * -0.35;
        ang = ang * (1 - p.duck) + side * 2.7 * p.duck;
        if (running) ang = side * 0.3 + Math.sin(t * 14 + side * 1.6) * 0.7;
        sh.makeTranslation(side * 0.27, 0.58, 0);
        rz.makeRotationZ(ang);
        am.multiplyMatrices(m4, sh).multiply(rz);
        if (aim) am.multiply(rx.makeRotationX(-2.2 * aim));
        arms.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), am);
        // The flag is held in the right hand.
        if (side > 0 && p.flagIdx != null) {
          fm.makeTranslation(0, -0.5, 0);
          am.multiply(fm).multiply(rz.makeRotationY(Math.sin(t * 6 + p.phase) * 0.6 * (0.3 + cheer)));
          flags.setMatrixAt(p.flagIdx, am);
        }
      }
    }
    bodies.instanceMatrix.needsUpdate = legs.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = flags.instanceMatrix.needsUpdate = cams.instanceMatrix.needsUpdate = true;
    for (const sp of flashes) if (sp.visible && (sp.life -= dt) <= 0) sp.visible = false;
    flashLight.intensity = Math.max(0, flashLight.intensity - dt * 900);
    return Math.min(1, noise / 7);
  };
  pose();

  return {
    group, obstacles: solid, count: people.length,
    // info: { air (the car is flying), speed (m/s), dark (night lighting) }
    update(dt, carX, carZ, info) {
      t += dt;
      const crowd = pose(carX, carZ, info, dt);
      rotor.rotation.y += dt * 30;
      heli.position.set(heliBase.x + Math.cos(t * 0.15) * 30, heliBase.y + Math.sin(t * 0.7) * 1.5, heliBase.z + Math.sin(t * 0.15) * 30);
      heli.rotation.y = -t * 0.15;
      heli.rotation.z = 0.12;
      return crowd;          // 0..1: how loud the nearby crowd is
    },
  };
}
