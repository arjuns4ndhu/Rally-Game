// Low-poly world dressing: sky, lights, fog, ground, trees, rocks, fences.
// Everything is driven by the stage theme (forest, canyon, snow, alpine, autumn).
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { buildTerrain } from './terrain.js';
import { THEMES } from './themes.js';
import { distToPolyline } from './track.js';
import { facet, pixelTex, RETRO } from './retro.js';

function skyDome() {
  const geo = new THREE.SphereGeometry(440, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(-0.6, 0.18, -0.75).normalize() }, glow: { value: new THREE.Color(1, 0.75, 0.45) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 glow; varying vec3 vP;
      void main(){ float h = clamp(vP.y * 2.2, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.7));
      float s = max(dot(vP, normalize(sunDir)), 0.0);
      c += glow * pow(s, 24.0) * 0.7;
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}

// Coloured ground texture (for the far apron).
function groundTexture(theme) {
  const g0 = theme.ground;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = g0.base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const [r, gg, b] = Math.random() < 0.5 ? g0.dark : g0.light;
    g.fillStyle = `rgba(${r},${gg},${b},${0.28 * Math.random()})`;
    const s = 1 + Math.random() * 3;
    g.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Near-white detail texture for the terrain; colour comes from vertex colours.
function detailTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const l = 170 + Math.random() * 85;
    g.fillStyle = `rgba(${l},${l},${l},${0.5 * Math.random()})`;
    const s = 1 + Math.random() * 3;
    g.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function setupWorld(scene) {
  scene.background = new THREE.Color();
  scene.fog = new THREE.FogExp2(0xffffff, 0.006);
  const sky = skyDome();
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(-0.6, 0.55, -0.75).normalize();

  const world = {
    sun, sky,
    applyTheme(theme) {
      const fog = new THREE.Color(theme.sky.fog);
      scene.background.copy(fog);
      scene.fog.color.copy(fog);
      scene.fog.density = theme.sky.fogDensity;
      const u = sky.material.uniforms;
      u.top.value.set(theme.sky.top);
      u.horizon.value.set(theme.sky.horizon);
      u.glow.value.setRGB(...theme.sky.sunGlow);
      sunDir.set(...theme.light.sunDir).normalize();
      u.sunDir.value.set(sunDir.x, Math.max(0.12, sunDir.y * 0.4), sunDir.z).normalize();
      hemi.color.set(theme.light.hemiSky);
      hemi.groundColor.set(theme.light.hemiGround);
      hemi.intensity = theme.light.hemi;
      sun.color.set(theme.light.sun);
      sun.intensity = theme.light.sunI;
    },
    follow(x, y, z) {
      sun.target.position.set(x, y, z);
      sun.position.set(x + sunDir.x * 120, y + sunDir.y * 120, z + sunDir.z * 120);
    },
  };
  world.applyTheme(THEMES.forest);
  return world;
}

// ---------- Tree kits ----------
// Each kind is a list of parts (geometry + material + whether it takes the
// per-instance colour), a colour picker and a collision radius.
function buildTreeKits() {
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, flatShading: true, vertexColors: true });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9, vertexColors: true });
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, flatShading: true, roughness: 0.8, vertexColors: true });
  const birchMat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, flatShading: true, vertexColors: true });
  const at = (geo, y) => { geo.translate(0, y, 0); return geo; };

  const trunk = at(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 5), 1.1);
  const pine = mergeGeos([at(new THREE.ConeGeometry(1.9, 5.5, 6), 4.6), at(new THREE.ConeGeometry(1.3, 3.6, 6), 7.0)]);
  const snowCaps = mergeGeos([at(new THREE.ConeGeometry(1.15, 2.0, 6), 6.25), at(new THREE.ConeGeometry(0.8, 1.7, 6), 8.0)]);
  const canopy = at(new THREE.IcosahedronGeometry(2.3, 0), 4.6);
  // Broadleaf trunks reach up into the canopy (it starts ~2.7 m up).
  const broadTrunk = at(new THREE.CylinderGeometry(0.2, 0.3, 3.6, 5), 1.8);
  const birchTrunk = at(new THREE.CylinderGeometry(0.12, 0.16, 4.2, 5), 2.1);
  const birchTop = at(new THREE.IcosahedronGeometry(1.4, 0), 4.9);
  const cactus = mergeGeos([
    at(new THREE.CylinderGeometry(0.28, 0.32, 3.2, 7), 1.6),
    at(new THREE.CylinderGeometry(0.18, 0.18, 1.1, 6).rotateZ(Math.PI / 2), 1.5).translate(0.55, 0, 0),
    at(new THREE.CylinderGeometry(0.17, 0.17, 1.0, 6), 2.0).translate(1.05, 0, 0),
    at(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 6).rotateZ(Math.PI / 2), 1.9).translate(-0.5, 0, 0),
    at(new THREE.CylinderGeometry(0.15, 0.15, 0.8, 6), 2.3).translate(-0.95, 0, 0),
  ]);
  const shrub = at(new THREE.DodecahedronGeometry(0.9, 0), 0.5);
  const H = (h, s, l) => (r) => new THREE.Color().setHSL(h[0] + r() * h[1], s[0] + r() * s[1], l[0] + r() * l[1]);

  // Every part gets per-triangle shading (retro faceted look).
  const F = (g) => facet(g, 0.2);
  const kits = {
    pine: { parts: [[trunk, trunkMat, false], [pine, leafMat, true]], color: H([0.24, 0.08], [0.35, 0.2], [0.18, 0.1]), r: 0.42 },
    snowpine: { parts: [[trunk, trunkMat, false], [pine, leafMat, true], [snowCaps, snowMat, false]], color: H([0.36, 0.06], [0.25, 0.15], [0.14, 0.08]), r: 0.42 },
    broadleaf: { parts: [[broadTrunk, trunkMat, false], [canopy, leafMat, true]], color: H([0.02, 0.11], [0.6, 0.25], [0.35, 0.15]), r: 0.42 },
    birch: { parts: [[birchTrunk, birchMat, false], [birchTop, leafMat, true]], color: H([0.12, 0.05], [0.6, 0.2], [0.45, 0.12]), r: 0.25 },
    cactus: { parts: [[cactus, leafMat, true]], color: H([0.26, 0.06], [0.35, 0.15], [0.28, 0.08]), r: 0.35 },
    shrub: { parts: [[shrub, leafMat, true]], color: H([0.12, 0.1], [0.3, 0.2], [0.25, 0.1]), r: 0 },
  };
  const done = new Map();
  for (const k of Object.values(kits)) k.parts = k.parts.map(([g, m, c]) => { if (!done.has(g)) done.set(g, F(g)); return [done.get(g), m, c]; });
  return kits;
}

// Build the terrain and dressing around a road. Returns { group, terrain, obstacles }.
export function buildScenery(road, seed = 1, { flat = false, theme = THEMES.forest, hilliness = 1, avoid = [], detail = 1 } = {}) {
  const rand = mulberry32(seed * 7919 + 13);
  const group = new THREE.Group();

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < road.n; i++) {
    minX = Math.min(minX, road.px[i]); maxX = Math.max(maxX, road.px[i]);
    minZ = Math.min(minZ, road.pz[i]); maxZ = Math.max(maxZ, road.pz[i]);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  // Ground: shaped terrain around the road, plus a flat apron under the horizon.
  const terrain = buildTerrain(road, {
    seed, flat, theme, grassMap: RETRO.on ? null : detailTexture(),
    baseAmp: theme.heightAmp * hilliness, hillAmp: theme.hillAmp * hilliness,
  });
  group.add(terrain.mesh);
  const apronTex = pixelTex(groundTexture(theme));
  apronTex.repeat.set(220, 220);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: apronTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, terrain.minH - 3, cz);
  group.add(ground);
  const groundY = terrain.heightAt;
  // Lowest ground under a footprint, so nothing hangs off a slope.
  const baseY = (x, z, r) => Math.min(groundY(x, z), groundY(x + r, z), groundY(x - r, z), groundY(x, z + r), groundY(x, z - r));

  // Keep things off the road, and off any shortcut tracks.
  const clear = (x, z, r) => {
    const n = terrain.nearestRoad(x, z);
    if (n && n.d <= r) return false;
    return avoid.every((pts) => distToPolyline(pts, x, z) > 5.5);
  };
  const density = Math.max(1, Math.min(2.4, road.length / 1200));

  // --- Trees (or cacti, shrubs, birches...) per theme, denser near the road.
  const kits = buildTreeKits();
  const spots = [];
  const tryPlace = (x, z, minR) => { if (clear(x, z, minR)) spots.push([x, z]); };
  const nTrees = theme.treeDensity * density;
  for (let k = 0; k < 1400 * nTrees; k++) {
    const i = Math.floor(rand() * road.n);
    const side = rand() < 0.5 ? -1 : 1;
    const off = road.width / 2 + 5 + Math.pow(rand(), 1.6) * 90;
    const lx = road.tz[i], lz = -road.tx[i];
    tryPlace(road.px[i] + lx * off * side + rand() * 4, road.pz[i] + lz * off * side + rand() * 4, road.width / 2 + 4);
  }
  for (let k = 0; k < 550 * nTrees; k++) {
    tryPlace(minX - 150 + rand() * (maxX - minX + 300), minZ - 150 + rand() * (maxZ - minZ + 300), road.width / 2 + 6);
  }
  const pickKind = () => {
    let r = rand();
    for (const [kind, w] of theme.trees) { if ((r -= w) <= 0) return kind; }
    return theme.trees[0][0];
  };
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), m4 = new THREE.Matrix4();
  const byKind = {};
  const treeItems = spots.map(([x, z]) => {
    const kind = pickKind();
    const kit = kits[kind];
    const sc = 0.7 + rand() * 0.8;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
    s.set(sc, sc * (0.85 + rand() * 0.4), sc);
    p.set(x, baseY(x, z, 0.6 * sc) - 0.3, z);
    const item = { x, z, sc, r: kit.r * sc, m: new THREE.Matrix4().compose(p, q, s), color: kit.color(rand) };
    // Cacti snap off at the base and topple over when hit.
    if (kind === 'cactus') item.knock = 'topple';
    (byKind[kind] ||= []).push(item);
    return item;
  });
  // Lower detail thins out distant trees only (all of them still collide,
  // so a stage plays the same on any setting).
  const keep = (it) => {
    if (detail >= 1) return true;
    const nr = terrain.nearestRoad(it.x, it.z);
    if (nr && nr.d < 28) return true;
    return Math.abs(Math.sin(it.x * 12.9898 + it.z * 78.233) * 43758.5453) % 1 < detail;
  };
  for (const [kind, all] of Object.entries(byKind)) {
    const items = all.filter(keep);
    for (const [geo, mat, colored] of kits[kind].parts) addTiled(group, geo, mat, items, colored);
  }

  // --- Rocks
  const rockGeo = facet(new THREE.DodecahedronGeometry(1, 0), 0.18);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95, vertexColors: true });
  const rockSpots = [];
  for (let k = 0; k < 500 * theme.rockDensity; k++) {
    const i = Math.floor(rand() * road.n);
    const side = rand() < 0.5 ? -1 : 1;
    const off = road.width / 2 + 3 + rand() * 40;
    const x = road.px[i] + road.tz[i] * off * side, z = road.pz[i] - road.tx[i] * off * side;
    if (clear(x, z, road.width / 2 + 2.5)) rockSpots.push([x, z]);
  }
  const [rh, rs, rl] = theme.rockColor;
  const rockVerts = rockGeo.attributes.position;
  const v3 = new THREE.Vector3();
  const rockItems = rockSpots.map(([x, z]) => {
    const sc = 0.3 + Math.pow(rand(), 2) * 1.6;
    // Lying roughly flat: any heading, only a slight tilt.
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.5, rand() * Math.PI * 2, (rand() - 0.5) * 0.5, 'YXZ'));
    s.set(sc * (1 + rand()), sc * 0.7, sc * (1 + rand()));
    // The spot was only checked for a small rock: shrink big ones that would
    // reach into the road (a boulder used to sit across a hairpin).
    const nr = terrain.nearestRoad(x, z);
    if (nr) {
      const room = nr.d - road.width / 2 - 0.8, reach = Math.max(s.x, s.z);
      if (reach > room) s.multiplyScalar(Math.max(0.2, room / reach));
    }
    p.set(x, baseY(x, z, 0.8 * sc) + sc * 0.15, z);
    const color = new THREE.Color().setHSL(rh, rs + rand() * 0.1, rl - 0.08 + rand() * 0.2);
    const m = new THREE.Matrix4().compose(p, q, s);
    // Hitbox from the rock's real footprint (the part above the ground):
    // its long axis, half-length and half-width.
    const gy = groundY(x, z) + 0.12;
    let ax = 0, az = 0, n = 0;
    const pts = [];
    for (let i = 0; i < rockVerts.count; i++) {
      v3.fromBufferAttribute(rockVerts, i).applyMatrix4(m);
      if (v3.y < gy) continue;
      pts.push([v3.x - x, v3.z - z]);
    }
    if (!pts.length) pts.push([0, 0]);
    // Long axis = direction of the furthest point.
    for (const [dx, dz] of pts) { const d = dx * dx + dz * dz; if (d > ax * ax + az * az) { ax = dx; az = dz; } }
    const al = Math.hypot(ax, az) || 1, ux = ax / al, uz = az / al;
    let half = 0, wide = 0;
    for (const [dx, dz] of pts) { half = Math.max(half, Math.abs(dx * ux + dz * uz)); wide = Math.max(wide, Math.abs(-dx * uz + dz * ux)); n++; }
    // Rocks up to about a metre get knocked aside (they slow you a little);
    // only proper boulders are solid.
    const knock = sc < 1.1;
    // (A rock almost buried in the ground still gets a small, sane hitbox.)
    return { x, z, sc, knock, r: knock ? Math.max(0.15, (half + wide) * 0.45) : Math.max(0.3, wide * 0.9), half, ux, uz, m, color };
  });
  addTiled(group, rockGeo, rockMat, rockItems, true, true);

  // --- Fences on the outside of tight corners (a visual warning, too).
  const postGeo = new THREE.BoxGeometry(0.12, 1.1, 0.12);
  postGeo.translate(0, 0.55, 0);
  const railGeo = new THREE.BoxGeometry(0.06, 0.1, 1);
  const fenceMat = new THREE.MeshStandardMaterial({ color: theme.id === 'snow' ? 0x8a5a3a : 0xd9c9a8, flatShading: true });
  const posts = [];
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
    m4.makeTranslation(x, groundY(x, z), z);
    postMesh.setMatrixAt(i, m4);
    const nxt = posts[i + 1];
    if (nxt) {
      const dx = nxt[0] - x, dz = nxt[1] - z, len = Math.hypot(dx, dz);
      if (len < 6) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz));
        for (const h of [0.55, 0.95]) {
          p.set(x + dx / 2, (groundY(x, z) + groundY(nxt[0], nxt[1])) / 2 + h, z + dz / 2); s.set(1, 1, len);
          m4.compose(p, q, s);
          railMesh.setMatrixAt(rc++, m4);
        }
      }
    }
  });
  postMesh.count = posts.length; railMesh.count = rc;
  postMesh.castShadow = true;
  group.add(postMesh, railMesh);

  // --- Horizon: rolling hills, desert mesas or snow-capped alpine peaks.
  const hillMat = new THREE.MeshStandardMaterial({ color: theme.hills, flatShading: true, roughness: 1, vertexColors: true });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xf2f5f8, flatShading: true, roughness: 0.9, vertexColors: true });
  const radius = Math.max(maxX - minX, maxZ - minZ) / 2 + 260;
  const base = terrain.meanH - 8;
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2 + rand() * 0.2;
    const r = radius + rand() * 220;
    const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
    if (theme.mesas) {
      const w = 60 + rand() * 110, h = 40 + rand() * 70;
      const mesa = new THREE.Mesh(facet(new THREE.CylinderGeometry(w, w * 1.25, h, 7, 3), 0.14), hillMat);
      mesa.position.set(px, base + h / 2, pz);
      mesa.rotation.y = rand() * 3;
      group.add(mesa);
    } else if (theme.peaks) {
      const w = 110 + rand() * 120, h = 140 + rand() * 160;
      const peak = new THREE.Mesh(facet(new THREE.ConeGeometry(w, h, 6, 3), 0.14), hillMat);
      peak.position.set(px, base + h / 2, pz);
      const cap = new THREE.Mesh(facet(new THREE.ConeGeometry(w * 0.32, h * 0.32, 6), 0.1), capMat);
      cap.position.set(0, h * 0.34, 0);
      peak.add(cap);
      peak.rotation.y = rand() * 3;
      group.add(peak);
    } else {
      const h = new THREE.Mesh(facet(new THREE.IcosahedronGeometry(1, 1), 0.14), hillMat);
      const w = 90 + rand() * 140;
      h.scale.set(w, (30 + rand() * 70) * Math.max(0.8, hilliness), w * (0.6 + rand() * 0.6));
      h.position.set(px, base, pz);
      h.rotation.y = rand() * 3;
      group.add(h);
    }
  }

  // Solid things the car can hit: tree trunks and big rocks. Small rocks and
  // cacti are knockable.
  const obstacles = [];
  for (const o of [...treeItems, ...rockItems]) {
    if (!(o.r > 0)) continue;
    if (o.knock) { obstacles.push({ x: o.x, z: o.z, r: o.r, knock: true, item: o }); continue; }
    // Long boulders: a chain of circles along the long axis covers the shape.
    const span = Math.max(0, (o.half || 0) - o.r);
    const nC = span > 0.15 ? Math.min(6, Math.ceil(span / (o.r * 0.8))) : 0;
    for (let k = -nC; k <= nC; k++) {
      const t = nC ? (k / nC) * span : 0;
      obstacles.push({ x: o.x + (o.ux || 0) * t, z: o.z + (o.uz || 0) * t, r: o.r, src: o });
    }
  }
  return { group, terrain, obstacles };
}

// Split instances into map tiles so each tile can be frustum-culled, in both
// the camera pass and the shadow pass. One huge InstancedMesh can't be.
const TILE = 140;
function addTiled(group, geo, mat, items, withColor, receive = false) {
  const tiles = new Map();
  for (const it of items) {
    const k = `${Math.floor(it.x / TILE)},${Math.floor(it.z / TILE)}`;
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k).push(it);
  }
  for (const list of tiles.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      it.mesh = mesh; it.idx = i;          // so a single instance can be moved later
      if (withColor) mesh.setColorAt(i, it.color);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = receive;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
}

function mergeGeos(geos) {
  // Minimal non-indexed merge (avoids pulling in BufferGeometryUtils).
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
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
