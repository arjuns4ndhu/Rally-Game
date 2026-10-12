// Low-poly world dressing: sky, lights, fog, ground, trees, rocks, fences.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

export const PALETTE = {
  skyTop: new THREE.Color('#2a3a5c'),
  horizon: new THREE.Color('#d9a877'),
  fog: new THREE.Color('#c79a72'),
  grass: '#4a5726',
  sun: new THREE.Color('#ffd7a3'),
};

function skyDome() {
  const geo = new THREE.SphereGeometry(1800, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: PALETTE.skyTop }, horizon: { value: PALETTE.horizon } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vP;
      void main(){ float h = clamp(vP.y * 2.2, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.7));
      // sun glow
      float s = max(dot(vP, normalize(vec3(-0.6, 0.18, -0.75))), 0.0);
      c += vec3(1.0, 0.75, 0.45) * pow(s, 24.0) * 0.7;
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = PALETTE.grass; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const l = Math.random();
    g.fillStyle = l < 0.5 ? `rgba(40,52,22,${0.3 * Math.random()})` : `rgba(150,140,80,${0.25 * Math.random()})`;
    const s = 1 + Math.random() * 3;
    g.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function setupWorld(scene) {
  scene.background = PALETTE.fog.clone();
  scene.fog = new THREE.FogExp2(PALETTE.fog, 0.0062);
  scene.add(skyDome());

  const hemi = new THREE.HemisphereLight(0xffe6c4, 0x5a5238, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 220;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(-0.6, 0.55, -0.75).normalize();

  return {
    sun,
    follow(x, z) {
      sun.target.position.set(x, 0, z);
      sun.position.set(x + sunDir.x * 100, sunDir.y * 100, z + sunDir.z * 100);
    },
  };
}

// Build the dressing around a road. Returns a group to add/remove as a unit.
export function buildScenery(road, seed = 1) {
  const rand = mulberry32(seed * 7919 + 13);
  const group = new THREE.Group();

  // Bounds
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < road.n; i++) {
    minX = Math.min(minX, road.px[i]); maxX = Math.max(maxX, road.px[i]);
    minZ = Math.min(minZ, road.pz[i]); maxZ = Math.max(maxZ, road.pz[i]);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  // Ground
  const gTex = grassTexture();
  gTex.repeat.set(220, 220);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshStandardMaterial({ map: gTex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -0.02, cz);
  ground.receiveShadow = true;
  group.add(ground);

  const clear = (x, z, r) => road.nearest(x, z, -1).dist > r;

  // --- Trees: pines and a few round broadleaf trees, denser near the road.
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 5);
  trunkGeo.translate(0, 1.1, 0);
  const pineGeo = new THREE.ConeGeometry(1.9, 5.5, 6);
  pineGeo.translate(0, 4.6, 0);
  const pineTop = new THREE.ConeGeometry(1.3, 3.6, 6);
  pineTop.translate(0, 7.0, 0);
  const pineMerged = mergeGeos([pineGeo, pineTop]);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, flatShading: true });

  const spots = [];
  const tryPlace = (x, z, minR) => { if (clear(x, z, minR)) spots.push([x, z]); };
  for (let k = 0; k < 1400; k++) {
    const i = Math.floor(rand() * road.n);
    const side = rand() < 0.5 ? -1 : 1;
    const off = road.width / 2 + 5 + Math.pow(rand(), 1.6) * 90;
    const lx = road.tz[i], lz = -road.tx[i];
    tryPlace(road.px[i] + lx * off * side + rand() * 4, road.pz[i] + lz * off * side + rand() * 4, road.width / 2 + 4);
  }
  for (let k = 0; k < 900; k++) {
    tryPlace(cx + (rand() - 0.5) * 700, cz + (rand() - 0.5) * 700, road.width / 2 + 6);
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const leaves = new THREE.InstancedMesh(pineMerged, leafMat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  spots.forEach(([x, z], i) => {
    const sc = 0.7 + rand() * 0.8;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
    s.set(sc, sc * (0.85 + rand() * 0.4), sc);
    p.set(x, 0, z);
    m4.compose(p, q, s);
    trunks.setMatrixAt(i, m4);
    leaves.setMatrixAt(i, m4);
    col.setHSL(0.24 + rand() * 0.08, 0.35 + rand() * 0.2, 0.18 + rand() * 0.1);
    leaves.setColorAt(i, col);
  });
  trunks.castShadow = leaves.castShadow = true;
  group.add(trunks, leaves);

  // --- Rocks
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 });
  const rockSpots = [];
  for (let k = 0; k < 500; k++) {
    const i = Math.floor(rand() * road.n);
    const side = rand() < 0.5 ? -1 : 1;
    const off = road.width / 2 + 3 + rand() * 40;
    const x = road.px[i] + road.tz[i] * off * side, z = road.pz[i] - road.tx[i] * off * side;
    if (clear(x, z, road.width / 2 + 2.5)) rockSpots.push([x, z]);
  }
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockSpots.length);
  rockSpots.forEach(([x, z], i) => {
    const sc = 0.3 + Math.pow(rand(), 2) * 1.6;
    q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
    s.set(sc * (1 + rand()), sc * 0.7, sc * (1 + rand()));
    p.set(x, sc * 0.15, z);
    m4.compose(p, q, s);
    rocks.setMatrixAt(i, m4);
    col.setHSL(0.08, 0.08 + rand() * 0.1, 0.35 + rand() * 0.2);
    rocks.setColorAt(i, col);
  });
  rocks.castShadow = true; rocks.receiveShadow = true;
  group.add(rocks);

  // --- Fences on the outside of tight corners (a visual warning, too).
  const postGeo = new THREE.BoxGeometry(0.12, 1.1, 0.12);
  postGeo.translate(0, 0.55, 0);
  const railGeo = new THREE.BoxGeometry(0.06, 0.1, 1);
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0xd9c9a8, flatShading: true });
  const posts = [], rails = [];
  for (let i = 0; i < road.n; i += 2) {
    const a = road.idx(i - 4), b = road.idx(i + 4);
    let d = Math.atan2(road.tx[b], road.tz[b]) - Math.atan2(road.tx[a], road.tz[a]);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < 0.32) continue;            // only tight-ish corners
    const side = d > 0 ? -1 : 1;                  // outside of the turn
    const off = road.width / 2 + 3.2;
    const x = road.px[i] + road.tz[i] * off * side, z = road.pz[i] - road.tx[i] * off * side;
    if (!clear(x, z, road.width / 2 + 2.8)) continue;
    posts.push([x, z]);
  }
  const postMesh = new THREE.InstancedMesh(postGeo, fenceMat, Math.max(1, posts.length));
  const railMesh = new THREE.InstancedMesh(railGeo, fenceMat, Math.max(1, posts.length * 2));
  let rc = 0;
  posts.forEach(([x, z], i) => {
    m4.makeTranslation(x, 0, z);
    postMesh.setMatrixAt(i, m4);
    const nxt = posts[i + 1];
    if (nxt) {
      const dx = nxt[0] - x, dz = nxt[1] - z, len = Math.hypot(dx, dz);
      if (len < 6) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz));
        for (const h of [0.55, 0.95]) {
          p.set(x + dx / 2, h, z + dz / 2); s.set(1, 1, len);
          m4.compose(p, q, s);
          railMesh.setMatrixAt(rc++, m4);
        }
      }
    }
  });
  postMesh.count = posts.length; railMesh.count = rc;
  postMesh.castShadow = true;
  group.add(postMesh, railMesh);

  // --- Distant hills: big flat-shaded lumps in a ring, silhouetted by fog.
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x55603a, flatShading: true, roughness: 1 });
  const radius = Math.max(maxX - minX, maxZ - minZ) / 2 + 260;
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2 + rand() * 0.2;
    const r = radius + rand() * 220;
    const h = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), hillMat);
    const w = 90 + rand() * 140;
    h.scale.set(w, 30 + rand() * 70, w * (0.6 + rand() * 0.6));
    h.position.set(cx + Math.cos(a) * r, -8, cz + Math.sin(a) * r);
    h.rotation.y = rand() * 3;
    group.add(h);
  }

  return group;
}

function mergeGeos(geos) {
  // Minimal non-indexed merge (avoids pulling in BufferGeometryUtils).
  const parts = geos.map((g) => g.toNonIndexed());
  let count = 0;
  parts.forEach((g) => (count += g.attributes.position.count));
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
