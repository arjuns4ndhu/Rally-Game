// Low-poly rally cars built from extruded side profiles. Each body is an
// original design that borrows the silhouette of a classic rally era
// (no real makes, badges or liveries).
import * as THREE from 'three';
import { LOFTS, buildLoftBody } from './loftcar.js';

// Side profiles: [z (forward), y (up)] in metres, traced around the outline:
// rear-bottom, up and over the top to the front, then front-bottom.
const PROFILES = {
  // 70s mid-engine wedge: tiny, very low, wraparound screen, roof spoiler,
  // louvred engine cover, light pod on the bonnet.
  // Built from cross-sections (see loftcar.js); the outline here is only a
  // rough guide for the cockpit view and must follow the beltline.
  stratos: {
    loft: 'stratos',
    body: [[-1.855, 0.34], [-1.855, 0.8], [-1.0, 0.87], [-0.6, 0.83], [0.77, 0.77], [1.3, 0.7], [1.855, 0.44], [1.855, 0.27]],
    glass: [[-0.72, 0.92], [-0.55, 1.11], [-0.05, 1.115], [0.77, 0.75]],
    width: 1.75, hood: [0.85, 1.7],
    wing: 'none', lamps: null, flares: false, round: 0, mirrors: false,
  },
  // 60s mini: a small upright box on tiny wheels, contrast roof, grille lamps.
  mini: {
    loft: 'mini',
    body: [[-1.71, 0.34], [-1.71, 0.8], [-1.45, 0.87], [0.5, 0.88], [1.2, 0.81], [1.34, 0.76], [1.34, 0.32]],
    glass: [[-1.46, 0.89], [-1.34, 1.29], [0.27, 1.29], [0.62, 0.9]],
    width: 1.41, hood: [0.7, 1.3],
    wing: 'none', lamps: null, flares: false, round: 0, mirrors: false,
  },
  // 80s turbo coupe: boxy three-box shape with big blistered arches.
  quattro: {
    loft: 'quattro',
    body: [[-2.25, 0.36], [-2.25, 0.95], [-1.0, 0.96], [0.0, 0.92], [0.9, 0.93], [1.92, 0.87], [2.1, 0.42], [2.1, 0.13]],
    glass: [[-1.32, 1.06], [-0.78, 1.33], [0.25, 1.3], [0.76, 0.96]],
    width: 1.86, hood: [0.9, 1.9],
    wing: 'none', lamps: null, flares: false, round: 0, mirrors: false,
  },
  // 00s world-rally hatch: tall five-door, raked screen, roof-edge wing.
  focus: {
    loft: 'focus',
    body: [[-2.12, 0.4], [-2.12, 0.98], [-1.0, 0.98], [0.0, 0.94], [0.7, 0.92], [1.7, 0.8], [2.03, 0.62], [2.03, 0.3]],
    glass: [[-2.0, 1.3], [-1.85, 1.43], [0.15, 1.42], [0.95, 0.98]],
    width: 1.77, hood: [1.0, 1.85],
    wing: 'none', lamps: null, flares: false, round: 0, mirrors: false,
  },
  // 80s Group B monster: short mid-engined hatch, huge flares, big wing.
  groupb: {
    loft: 'groupb',
    body: [[-2.05, 0.36], [-2.05, 0.98], [-0.8, 0.98], [0.4, 0.92], [1.15, 0.9], [1.85, 0.74], [1.95, 0.6], [1.95, 0.16]],
    glass: [[-1.95, 1.25], [-1.8, 1.34], [0.2, 1.32], [0.75, 0.96]],
    width: 1.88, hood: [0.8, 1.8],
    wing: 'none', lamps: null, flares: false, round: 0, mirrors: false,
  },
  // Rally-raid SUV: tall body on big tyres, roof rack, spare wheels, light bar.
  dakar: {
    loft: 'dakar',
    body: [[-2.38, 0.62], [-2.38, 1.12], [-1.0, 1.17], [0.6, 1.14], [1.4, 1.12], [2.25, 0.96], [2.32, 0.86], [2.32, 0.6]],
    glass: [[-2.2, 1.6], [-2.0, 1.7], [0.3, 1.71], [1.2, 1.17]],
    width: 1.93, hood: [1.2, 2.1],
    wing: 'none', lamps: null, flares: false, round: 0, mirrors: false,
  },
};

// Split long edges so the body has enough vertices to take dents.
function resample(pts, maxSeg = 0.3) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const [z0, y0] = pts[i], [z1, y1] = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(z1 - z0, y1 - y0) / maxSeg));
    for (let k = 0; k < n; k++) out.push([z0 + (z1 - z0) * k / n, y0 + (y1 - y0) * k / n]);
  }
  return out;
}

// Chaikin corner cutting: rounds off every corner of a closed outline.
function roundOff(pts, passes = 3) {
  for (let p = 0; p < passes; p++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const [z0, y0] = pts[i], [z1, y1] = pts[(i + 1) % pts.length];
      out.push([z0 * 0.75 + z1 * 0.25, y0 * 0.75 + y1 * 0.25], [z0 * 0.25 + z1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    pts = out;
  }
  return pts;
}

function extrudeProfile(pts, width, bevel = 0.05, round = 0) {
  // Rounded outline, then split long edges so the body can take dents.
  pts = resample(round ? roundOff(pts, round) : pts, 0.25);
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, steps: 5, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: round ? 3 : 1,
  });
  // Shape is in XY; extrusion goes along +Z. Rotate so profile x -> world z.
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

// Merge a few geometries (position + normal only) into one.
function mergeTyre(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
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

let halo = null;
function haloTexture() {
  if (halo) return halo;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  halo = new THREE.CanvasTexture(c);
  halo.colorSpace = THREE.SRGBColorSpace;
  return halo;
}

function numberTexture(num, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f1e8';
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.lineWidth = 8; g.strokeStyle = color; g.stroke();
  g.fillStyle = '#111';
  g.font = 'bold 72px Bungee, Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const WHEEL_STYLES = ['spoke', 'dish', 'mesh', 'tarmac'];

function buildRim(style, rimMat, darkMat) {
  const g = new THREE.Group();
  const r = 0.21;
  if (style === 'dish') {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.05, 12), rimMat);
    d.rotation.z = Math.PI / 2; g.add(d);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 6), darkMat);
    hub.rotation.z = Math.PI / 2; hub.position.x = 0.02; g.add(hub);
  } else if (style === 'mesh') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r - 0.02, 0.025, 4, 12), rimMat);
    ring.rotation.y = Math.PI / 2; g.add(ring);
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.03, r * 2 - 0.05, 0.018), rimMat);
      s.rotation.x = (i / 10) * Math.PI; g.add(s);
    }
  } else if (style === 'tarmac') {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.045, 10), rimMat);
    d.rotation.z = Math.PI / 2; g.add(d);
    for (let i = 0; i < 5; i++) {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 6), darkMat);
      hole.rotation.z = Math.PI / 2;
      const a = (i / 5) * Math.PI * 2;
      hole.position.set(0.005, Math.cos(a) * 0.12, Math.sin(a) * 0.12);
      g.add(hole);
    }
  } else { // spoke
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r - 0.02, 0.03, 4, 10), rimMat);
    ring.rotation.y = Math.PI / 2; g.add(ring);
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.04, r * 1.85, 0.05), rimMat);
      s.rotation.x = (i / 5) * Math.PI; g.add(s);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 6), darkMat);
    hub.rotation.z = Math.PI / 2; g.add(hub);
  }
  return g;
}


// Every rim is silver; only the unlockable Gold wheels keep their colour.
const SILVER = 0xc8ccd3;
const RIM_COLORS = { spoke: SILVER, dish: SILVER, mesh: SILVER, tarmac: SILVER, gold: 0xe0b23a };

// Dark sun-strip across the top of the windscreen.
function bannerTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#111318'; g.fillRect(0, 0, 512, 64);
  g.fillStyle = '#f1e9da';
  g.font = '40px Bungee, Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('SIDEWAYS', 256, 36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Skins a car offers in the garage ([] for most cars).
export function carSkins(spec) {
  const def = LOFTS[(PROFILES[spec.bodyStyle] || {}).loft];
  return def?.skins ? Object.entries(def.skins).map(([id, s]) => ({ id, name: s.name, paint: s.paint })) : [];
}

export function buildCarModel(spec, { color = '#e8542a', wheelStyle = 'spoke', number = 7, ghost = false, skin = null } = {}) {
  const prof = PROFILES[spec.bodyStyle] || PROFILES.focus;
  const WR = spec.wheelR || 0.32;
  const root = new THREE.Group();
  const body = new THREE.Group();        // pitches / rolls with weight transfer
  root.add(body);

  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2, flatShading: true });
  const glass = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.15, metalness: 0.6, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.8, flatShading: true });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.6, flatShading: true });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe9a0, emissiveIntensity: 1.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x80140f, emissive: 0xff2a1a, emissiveIntensity: 0.6 });
  const mats = [paint, glass, dark, trim, lightMat, tailMat];
  const add = (geo, mat, x, y, z, shadow = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    body.add(m);
    return m;
  };

  // Scale the profile so its length matches the car spec.
  const xs = prof.body.map((p) => p[0]);
  const k = spec.length / (Math.max(...xs) - Math.min(...xs));
  const scaled = (pts) => pts.map(([z, y]) => [z * k, y]);
  const bodyPts = scaled(prof.body), g = scaled(prof.glass);
  const W = prof.width;
  const front = Math.max(...bodyPts.map((p) => p[0]));
  const rear = Math.min(...bodyPts.map((p) => p[0]));
  // Height of the body's top edge at a given z.
  const top = bodyPts.slice(1, -1);
  const topY = (z) => {
    for (let i = 0; i < top.length - 1; i++) {
      const [z0, y0] = top[i], [z1, y1] = top[i + 1];
      if (z >= Math.min(z0, z1) && z <= Math.max(z0, z1)) return y0 + (y1 - y0) * ((z - z0) / ((z1 - z0) || 1));
    }
    return top[top.length - 1][1];
  };

  const rnd = prof.round || 0;
  // Wheel fitment: the tyre's outer face sits flush with the arch flare
  // (or the body side), not tucked in under it. Visual only; physics uses spec.track.
  const fw = prof.bigFlares ? 0.22 : 0.15;
  const tw = WR > 0.38 ? 0.32 : 0.25, hw = tw / 2;
  const wheelX = prof.flares ? W / 2 + fw - 0.07 - hw : W / 2 + 0.01 - hw;
  // Body in three slices so the wheel wells can be real openings: two outer
  // side panels with half-round cutouts over each wheel, and a solid centre
  // that forms the back wall of each well. The centre overlaps the sides by
  // twice the bevel so no seam shows on top.
  const bev = rnd ? 0.06 + rnd * 0.015 : 0.05;
  const ar = WR + 0.07;                               // wheel-well radius
  const sideW = Math.max(W / 2 - (wheelX - hw) + 0.06, 3.2 * bev + 0.02);
  const y0 = bodyPts[bodyPts.length - 1][1];          // body's bottom edge
  const well = (wz) => {
    const dy = y0 - WR;
    if (Math.abs(dy) >= ar) return [];
    const c = Math.sqrt(ar * ar - dy * dy), t0 = Math.atan2(dy, c), out = [];
    for (let i = 0; i <= 16; i++) { const t = t0 + (Math.PI - 2 * t0) * i / 16; out.push([wz + ar * Math.cos(t), WR + ar * Math.sin(t)]); }
    return out;
  };
  // The outline runs rear-bottom -> over the top -> front-bottom, so the
  // closing bottom edge goes front to rear: front well first, then rear.
  const cutPts = [...bodyPts, ...well(spec.a), ...well(-spec.b)];
  let bodyMesh = new THREE.Mesh(extrudeProfile(bodyPts, W - 2 * sideW + 4 * bev, bev, rnd), paint);
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(extrudeProfile(cutPts, sideW, bev, rnd), paint);
    panel.position.x = side * (W / 2 - sideW / 2);
    panel.castShadow = true;
    body.add(panel);
  }
  // Dark liner over each wheel and a dark back wall, so the openings read as wells.
  {
    const linerMat = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.95, side: THREE.DoubleSide });
    mats.push(linerMat);
    const liner = new THREE.CylinderGeometry(ar - 0.01, ar - 0.01, sideW, 18, 1, true, 0, Math.PI);
    liner.rotateZ(Math.PI / 2);
    const wall = new THREE.CircleGeometry(ar - 0.01, 18, 0, Math.PI);
    wall.rotateY(Math.PI / 2);   // upper half-disc in the car's side plane
    for (const side of [-1, 1]) for (const wz of [spec.a, -spec.b]) {
      add(liner, linerMat, side * (W / 2 - sideW / 2), WR, wz);
      add(wall, linerMat, side * (W / 2 - sideW + 0.005), WR, wz);
    }
  }
  let glassMesh = new THREE.Mesh(extrudeProfile(g, W - (rnd ? 0.24 + rnd * 0.02 : 0.18), rnd ? 0.08 : 0.04, Math.min(rnd, 2)), glass);
  bodyMesh.castShadow = glassMesh.castShadow = true;
  body.add(bodyMesh, glassMesh);

  // Roof panel over the glass.
  const roofY = Math.max(g[1][1], g[2][1]) + 0.02;
  const roofZ = (g[1][0] + g[2][0]) / 2, roofLen = (g[2][0] - g[1][0]) * 0.92;
  add(new THREE.BoxGeometry(W - 0.22, 0.05, roofLen), prof.roofContrast ? trim : paint, 0, roofY, roofZ);

  // Livery: twin bonnet stripes, matching roof stripes and a side band.
  const hz0 = prof.hood[0] * k, hz1 = prof.hood[1] * k;
  for (const sx of [-0.13, 0.13]) {
    const st = add(new THREE.BoxGeometry(0.16, 0.012, hz1 - hz0), trim, sx, (topY(hz0) + topY(hz1)) / 2 + 0.012, (hz0 + hz1) / 2);
    st.rotation.x = Math.atan2(topY(hz0) - topY(hz1), hz1 - hz0);
    add(new THREE.BoxGeometry(0.16, 0.012, roofLen), trim, sx, roofY + 0.032, roofZ);
  }
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.01, 0.1, (front - rear) * 0.82), trim, side * (W / 2 + 0.003), Math.max(0.5, WR + ar + 0.06), (front + rear) / 2 + 0.05);
  }

  // Windscreen sun-strip.
  if (!ghost) {
    const [tz, ty] = g[2], [bz, by] = g[3];
    const uy = ty - by, uz = tz - bz, ul = Math.hypot(uy, uz);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.32, 0.16), new THREE.MeshBasicMaterial({ map: bannerTexture() }));
    mats.push(strip.material);
    const t = 0.16;   // near the top of the screen
    // Tilt to the screen's rake and sit just proud of the glass (outward normal).
    const ny = -uz / ul, nz = uy / ul;
    strip.position.set(0, ty - uy * t + ny * 0.05, tz - uz * t + nz * 0.05);
    strip.rotation.x = Math.atan2(uz, uy);
    body.add(strip);
  }

  // Door number roundels.
  if (!ghost) {
    const tex = numberTexture(number, '#111');
    const roundMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    mats.push(roundMat);
    for (const side of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), roundMat);
      r.position.set(side * (W / 2 + 0.008), 0.68, (g[1][0] + g[3][0]) / 2);
      r.rotation.y = side * Math.PI / 2;
      body.add(r);
    }
  }

  // Head and tail lights. Halo spots are collected for the night glow.
  const heads = [], tails = [];
  let rider = null;          // the armchair passenger, if this car has one
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.3, 0.1, 0.05), lightMat, side * (W / 2 - 0.3), topY(front - 0.1) - 0.16, front + 0.05);
    add(new THREE.BoxGeometry(0.34, 0.1, 0.05), tailMat, side * (W / 2 - 0.28), topY(rear + 0.05) - 0.14, rear - 0.05);
    heads.push([side * (W / 2 - 0.3), topY(front - 0.1) - 0.16, front + 0.1, 1]);
    tails.push([side * (W / 2 - 0.28), topY(rear + 0.05) - 0.14, rear - 0.1]);
  }
  root.userData.tailMat = tailMat;

  // Rally lamps: a four-lamp bar on the bumper, or a pod on the bonnet.
  const lampSpots = {
    pod: [hz1 - 0.35, topY(hz1 - 0.35) + 0.14, 0.3, 0.1],
    bar: [front + 0.07, topY(front - 0.15) - 0.14, 0.3, 0.1],
    grille: [front + 0.06, topY(front - 0.15) - 0.32, 0.26, 0.08],
    roof: [g[2][0] - 0.05, roofY + 0.2, 0.3, 0.09],
  }[prof.lamps];
  if (lampSpots) {
    const [lampZ, lampY, gap, lr] = lampSpots;
    add(new THREE.BoxGeometry(gap * 4, 0.06, 0.12), dark, 0, lampY - lr - 0.01, lampZ - 0.02);
    for (let n = 0; n < 4; n++) {
      const x = (n - 1.5) * gap;
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(lr, lr, 0.09, 10), dark);
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(x, lampY, lampZ);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(lr * 0.85, 10), lightMat);
      lens.position.set(x, lampY, lampZ + 0.05);
      body.add(lamp, lens);
      heads.push([x, lampY, lampZ + 0.1, 0.8]);
    }
  }
  // Round headlamps at the front corners (the mini's face).
  if (prof.roundLights) {
    for (const side of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), lightMat);
      hl.position.set(side * (W / 2 - 0.2), topY(front - 0.05) - 0.1, front + 0.06);
      body.add(hl);
      heads.push([hl.position.x, hl.position.y, front + 0.1, 0.9]);
    }
  }
  // Louvred engine cover behind the cabin.
  if (prof.louvres) {
    for (let n = 0; n < 5; n++) {
      const z = g[0][0] - 0.15 - n * 0.16;
      add(new THREE.BoxGeometry(W - 0.5, 0.03, 0.06), dark, 0, topY(z) + 0.02, z);
    }
  }
  // Roof rack with two spare wheels (rally-raid).
  if (prof.rack) {
    add(new THREE.BoxGeometry(W - 0.3, 0.05, roofLen * 0.95), dark, 0, roofY + 0.1, roofZ);
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.12, roofLen * 0.95), dark, side * (W / 2 - 0.16), roofY + 0.06, roofZ);
    for (const dz of [-0.45, 0.35]) {
      const spare = new THREE.Mesh(new THREE.CylinderGeometry(WR * 0.95, WR * 0.95, 0.24, 14), dark);
      spare.position.set(0, roofY + 0.25, roofZ + dz);
      spare.castShadow = true;
      body.add(spare);
    }
  }
  if (prof.skid) add(new THREE.BoxGeometry(W - 0.4, 0.06, 0.7), new THREE.MeshStandardMaterial({ color: 0x8b8f96, metalness: 0.6, roughness: 0.4, flatShading: true }), 0, bodyPts[0][1] - 0.02, front - 0.4);

  // Bumpers.
  const bumpY = bodyPts[0][1] + 0.08;
  add(new THREE.BoxGeometry(W + 0.04, 0.16, 0.14), dark, 0, bumpY, front - 0.03);
  add(new THREE.BoxGeometry(W + 0.04, 0.16, 0.14), dark, 0, bumpY, rear + 0.03);

  // Box-flared wheel arches and mud flaps.
  if (prof.flares) {
    // Curved arch flares over each wheel: a paint shell with a dark lip.
    const archGeo = new THREE.CylinderGeometry(ar, ar, fw, 18, 1, true, 0, Math.PI);
    archGeo.rotateZ(Math.PI / 2);
    const lipGeo = new THREE.TorusGeometry(ar, 0.03, 4, 18, Math.PI);
    lipGeo.rotateY(Math.PI / 2);
    const archMat = paint.clone(); archMat.side = THREE.DoubleSide; mats.push(archMat);
    archMat.userData.followPaint = true;
    for (const side of [-1, 1]) for (const wz of [spec.a, -spec.b]) {
      const a = add(archGeo, archMat, side * (W / 2 + fw / 2 - 0.05), WR, wz, true);
      a.userData.arch = true;
      add(lipGeo, dark, side * (W / 2 + fw - 0.04), WR, wz);
    }
  }
  // Door mirrors.
  if (prof.mirrors) {
    const mz = g[3][0] - 0.12, my = g[3][1] + 0.12;
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.06, 0.03, 0.04), dark, side * (W / 2 + 0.03), my - 0.02, mz);
      add(new THREE.BoxGeometry(0.12, 0.1, 0.07), paint, side * (W / 2 + 0.1), my + 0.02, mz - 0.02);
    }
  }
  // Pillars between the side windows and a door shut line.
  {
    const pz = (g[1][0] + g[2][0]) / 2 + (g[2][0] - g[1][0]) * 0.1;
    const py0 = topY(pz) + 0.02, py1 = Math.max(g[1][1], g[2][1]) - 0.02;
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.02, Math.max(0.1, py1 - py0), 0.09), paint, side * ((W - (rnd ? 0.24 + rnd * 0.02 : 0.18)) / 2 + 0.005), (py0 + py1) / 2, pz);
      add(new THREE.BoxGeometry(0.012, 0.42, 0.015), dark, side * (W / 2 + 0.004), 0.58, g[3][0] - 0.05);
      add(new THREE.BoxGeometry(0.012, 0.42, 0.015), dark, side * (W / 2 + 0.004), 0.58, g[1][0] + 0.12);   // rear door edge, clear of the number
    }
  }
  // Front grille.
  if (prof.grille) {
    const gw = prof.grille === 'mini' ? 0.5 : prof.grille === 'mesh' ? 0.8 : W - 0.7;
    add(new THREE.BoxGeometry(gw, 0.14, 0.03), dark, 0, topY(front - 0.1) - 0.2, front + 0.03);
    for (let n = 0; n < 3; n++) add(new THREE.BoxGeometry(gw - 0.04, 0.012, 0.035), trim, 0, topY(front - 0.1) - 0.25 + n * 0.045, front + 0.035);
  }
  // Exhaust tailpipe(s).
  {
    const pipe = new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10);
    pipe.rotateX(Math.PI / 2);
    const chrome = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.8, roughness: 0.3 });
    mats.push(chrome);
    const n = spec.cyl >= 6 ? 2 : 1;
    for (let i = 0; i < n; i++) add(pipe, chrome, (n === 2 ? (i ? 0.35 : -0.35) : 0.45), bodyPts[0][1] + 0.02, rear - 0.04);
  }
  // Rally-raid snorkel up the A-pillar.
  if (prof.snorkel) {
    const sz = g[3][0] - 0.1;
    add(new THREE.CylinderGeometry(0.05, 0.05, Math.max(0.3, g[2][1] - topY(sz)), 8), dark, W / 2 + 0.06, (topY(sz) + g[2][1]) / 2, sz);
  }
  for (const side of [-1, 1]) for (const wz of [spec.a - WR - 0.12, -spec.b - WR - 0.12]) {
    add(new THREE.BoxGeometry(0.3, 0.24, 0.02), dark, side * wheelX, Math.max(0.2, WR - 0.12), wz);
  }

  // Wings.
  if (prof.wing === 'roof') {
    add(new THREE.BoxGeometry(W - 0.3, 0.04, 0.3), paint, 0, g[1][1] + 0.05, g[1][0] - 0.08, true);
  } else if (prof.wing === 'ducktail') {
    const d = add(new THREE.BoxGeometry(W - 0.12, 0.05, 0.4), dark, 0, topY(rear + 0.3) + 0.12, rear + 0.3, true);
    d.rotation.x = -0.25;
  } else if (prof.wing === 'lip') {
    add(new THREE.BoxGeometry(W - 0.1, 0.06, 0.16), dark, 0, topY(rear + 0.2) + 0.05, rear + 0.16, true);
  } else if (prof.wing === 'hatch') {
    // Roof-edge wing on the tailgate, with endplates.
    const wz = g[1][0] - 0.12, wy = g[1][1] + 0.04;
    add(new THREE.BoxGeometry(W - 0.12, 0.06, 0.4), dark, 0, wy, wz, true);
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.2, 0.44), paint, side * (W / 2 - 0.08), wy - 0.04, wz);
  } else if (prof.wing === 'big') {
    const wy = Math.max(topY(rear + 0.35), 0.95) + 0.42;
    add(new THREE.BoxGeometry(W - 0.04, 0.07, 0.44), dark, 0, wy, rear + 0.32, true);
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.05, 0.36, 0.22), dark, side * 0.62, wy - 0.18, rear + 0.34);
      add(new THREE.BoxGeometry(0.03, 0.22, 0.5), paint, side * (W / 2 - 0.02), wy + 0.04, rear + 0.32);
    }
  }
  if (prof.scoop) {
    const sz = (hz0 + hz1) / 2 - 0.15;
    add(new THREE.BoxGeometry(0.5, 0.09, 0.45), dark, 0, topY(sz) + 0.05, sz);
  }
  if (prof.vent) add(new THREE.BoxGeometry(0.34, 0.07, 0.3), dark, 0, roofY + 0.05, roofZ + roofLen * 0.3);
  // Roof aerial.
  add(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 4), dark, 0.4, roofY + 0.25, roofZ - roofLen * 0.3);

  // Lofted bodies replace everything above with a shape traced from the real car.
  let loftC = null, loftDef = null;   // its shape curves, for placing the cockpit
  let plainSkin = false;              // the Plain style: no door numbers
  if (prof.loft) {
    for (const c of [...body.children]) { body.remove(c); if (c.geometry && c.geometry !== bodyMesh.geometry) c.geometry.dispose(); }
    bodyMesh.geometry.dispose(); glassMesh.geometry.dispose();
    heads.length = 0; tails.length = 0;
    const def = LOFTS[prof.loft];
    const skinId = def.skins ? (def.skins[skin] ? skin : def.defaultSkin) : null;
    const sk = skinId ? def.skins[skinId] : null;
    plainSkin = skinId === 'plain';
    const acc = (sk ? sk.accents : def.accents).map((col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.45, metalness: 0.2, flatShading: true }));
    mats.push(...acc);
    loftDef = def;
    const L = buildLoftBody(def, { paint, glass, dark, accents: acc, livery: sk ? sk.livery : def.livery, wheelZ: [spec.a, -spec.b], wheelY: WR, archR: ar, wellX: wheelX - hw - 0.035 });
    mats.push(...L.extraMats);
    bodyMesh = L.bodyMesh; glassMesh = L.glassMesh;
    loftC = L.curves;
    body.add(bodyMesh, glassMesh);
    const [zr, zf] = def.zRange || [-def.length / 2, def.length / 2];
    ({ stratos: stratosDetails, mini: miniDetails, quattro: quattroDetails, focus: focusDetails, dakar: dakarDetails, groupb: groupbDetails })[prof.loft](L.curves, acc, zr, zf, skinId);
    styleKit(prof.loft, skinId, L.curves, acc, zr, zf);
  }

  // ---------- Style kits ----------
  // Unlockable styles change the car itself, not just its paint: wings,
  // splitters, bull bars, lamp pods, roof racks, snorkels and so on.
  function styleKit(loft, skinId, C, acc, zr, zf) {
    const kit = kitTable()[`${loft}:${skinId}`];
    if (kit) kit(C, acc, zr, zf);
  }
  function tube(r, len, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    const t = add(new THREE.CylinderGeometry(r, r, len, 8), mat, x, y, z, true);
    t.rotation.set(rx, ry, rz);
    return t;
  }
  // A big rear wing on two stalks: centre z, height above the surface below it.
  function bigWing(C, z, width, rise, chord, mat, endMat = mat) {
    const base = C.top(z), y = base + rise;
    const plane = add(new THREE.BoxGeometry(width, 0.035, chord), mat, 0, y, z, true);
    plane.rotation.x = -0.1;
    add(new THREE.BoxGeometry(width * 0.98, 0.02, chord * 0.45), mat, 0, y + 0.07, z - chord * 0.2).rotation.x = -0.25;
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.03, 0.2, chord + 0.06), endMat, side * width / 2, y + 0.02, z);
      add(new THREE.BoxGeometry(0.04, rise, 0.08), dark, side * width * 0.3, base + rise / 2, z);
    }
  }
  // Flat splitter under the nose, with little dive planes on the corners.
  // Never wider than the nose it hangs under (they used to poke out the sides).
  function fitW(C, z, width) { return Math.min(width, 2 * C.halfWidth(z) - 0.04); }
  function splitter(C, zf, width, mat) {
    add(new THREE.BoxGeometry(fitW(C, zf - 0.1, width), 0.035, 0.36), mat, 0, C.bottom(zf) + 0.01, zf + 0.05, true);
    for (const side of [-1, 1]) {
      const fin = add(new THREE.BoxGeometry(0.16, 0.025, 0.12), mat, side * (C.halfWidth(zf - 0.15) + 0.04), C.belt(zf - 0.15) - 0.18, zf - 0.15);
      fin.rotation.z = side * 0.25;
    }
  }
  // Side skirts between the wheel arches, in short pieces that follow the
  // body's width and sill height so they sit flush all the way along.
  function sideSkirts(C, mat) {
    const z0 = -spec.b + WR + 0.12, z1 = spec.a - WR - 0.12, n = Math.max(2, Math.round((z1 - z0) / 0.25));
    const len = (z1 - z0) / n;
    for (const side of [-1, 1]) for (let k = 0; k < n; k++) {
      const zc = z0 + (k + 0.5) * len;
      add(new THREE.BoxGeometry(0.05, 0.08, len + 0.01), mat, side * (C.halfWidth(zc) + 0.01), C.bottom(zc) + 0.05, zc);
    }
  }
  // Tubular bull bar across the nose.
  function bullBar(C, zf, width) {
    const y0 = C.bottom(zf) + 0.08, h = Math.max(0.35, C.belt(zf) - y0 + 0.05), z = zf + 0.12;
    tube(0.03, width, dark, 0, y0 + h, z, 0, 0, Math.PI / 2);
    tube(0.03, width * 0.9, dark, 0, y0 + h * 0.45, z, 0, 0, Math.PI / 2);
    for (const x of [-width * 0.36, width * 0.36]) tube(0.03, h + 0.05, dark, x, y0 + h / 2, z);
  }
  // A row of round lamps on a bar, facing forward.
  function lampPod(n, spacing, y, z, r = 0.09) {
    add(new THREE.BoxGeometry(spacing * n, 0.05, 0.08), dark, 0, y - r - 0.01, z - 0.03);
    for (let k = 0; k < n; k++) {
      const x = (k - (n - 1) / 2) * spacing;
      const pot = add(new THREE.CylinderGeometry(r, r, r, 12), dark, x, y, z);
      pot.rotation.x = Math.PI / 2;
      disc(r * 0.85, x, y, z + r / 2 + 0.003, lightMat);
      heads.push([x, y, z + 0.1, 0.7]);
    }
  }
  // Snorkel up the right-hand screen pillar.
  function snorkel(C, zA, zRoof) {
    const x = -(C.halfWidth(zA) + 0.04), y0 = C.belt(zA) - 0.25, y1 = C.top(zRoof) + 0.12;
    tube(0.05, y1 - y0, dark, x, (y0 + y1) / 2, zA);
    const cap = add(new THREE.BoxGeometry(0.12, 0.1, 0.18), dark, x, y1 + 0.03, zA + 0.05, true);
    cap.rotation.x = 0.2;
  }
  // Roof rack: a frame of bars on the roof between z0 and z1.
  function roofRack(C, z0, z1, width) {
    const y = Math.max(C.top(z0), C.top(z1), C.top((z0 + z1) / 2)) + 0.06;
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.035, 0.035, z1 - z0), dark, side * width / 2, y, (z0 + z1) / 2);
    for (const z of [z0 + 0.05, (z0 + z1) / 2, z1 - 0.05]) add(new THREE.BoxGeometry(width, 0.03, 0.035), dark, 0, y, z);
    return y;
  }
  // Tall mud flaps that hang well below the sills.
  function bigFlaps(mat) {
    for (const side of [-1, 1]) for (const wz of [spec.a - WR - 0.12, -spec.b - WR - 0.12]) {
      add(new THREE.BoxGeometry(0.3, 0.3, 0.02), mat, side * (wheelX + 0.02), Math.max(0.17, WR - 0.08), wz);
    }
  }
  function jerryCan(x, y, z, mat) { add(new THREE.BoxGeometry(0.14, 0.32, 0.24), mat, x, y, z, true); }
  function kitTable() { return {
    // Safari: bull bar, a four-lamp pod on the roof, tall flaps.
    'stratos:sunset': (C, acc, zr, zf) => {
      bullBar(C, zf, 1.5);
      lampPod(4, 0.22, C.top(-0.3) + 0.14, -0.05, 0.08);
      bigFlaps(dark);
    },
    // Silhouette: a huge race wing on stalks, a splitter and side skirts.
    'stratos:gold': (C, acc, zr, zf) => {
      bigWing(C, zr + 0.3, 1.7, 0.42, 0.42, acc[0], dark);
      splitter(C, zf, 1.8, dark);
      sideSkirts(C, dark);
    },
    // Chequers: a roof rack with two pairs of skis.
    'mini:checkers': (C, acc, zr, zf) => {
      const y = roofRack(C, -1.2, 0.15, 1.1);
      const skiMat = new THREE.MeshStandardMaterial({ color: 0xc4161c, roughness: 0.5, flatShading: true }); mats.push(skiMat);
      for (const x of [-0.36, -0.24, 0.24, 0.36]) {
        const ski = add(new THREE.BoxGeometry(0.07, 0.025, 1.7), x < 0 ? skiMat : trim, x, y + 0.04, -0.5, true);
        ski.rotation.x = 0.04;
      }
    },
    // Arctic: lamp pod on the bonnet, bull bar and tall flaps for snow stages.
    'quattro:arctic': (C, acc, zr, zf) => {
      bullBar(C, zf, 1.6);
      lampPod(4, 0.25, C.top(1.3) + 0.12, 1.4, 0.095);
      bigFlaps(new THREE.MeshStandardMaterial({ color: 0x2f6f99, roughness: 0.6, flatShading: true }));
    },
    // Hillclimb: a giant double wing and a deep splitter with dive planes.
    'quattro:redline': (C, acc, zr, zf) => {
      bigWing(C, zr + 0.3, 1.9, 0.5, 0.5, acc[0], acc[1]);
      splitter(C, zf, 2.0, acc[0]);
    },
    // Gravel: roof scoop, bonnet lamp pod, big flaps.
    'focus:lime': (C, acc, zr, zf) => {
      add(new THREE.BoxGeometry(0.4, 0.12, 0.5), acc[0], 0, C.top(-0.5) + 0.06, -0.5, true);
      add(new THREE.BoxGeometry(0.34, 0.09, 0.02), dark, 0, C.top(-0.5) + 0.07, -0.24);
      lampPod(4, 0.24, C.top(1.4) + 0.12, 1.5, 0.09);
      bigFlaps(acc[0]);
    },
    // Tarmac: a tall race wing over the hatch, splitter and skirts.
    'focus:heritage': (C, acc, zr, zf) => {
      bigWing(C, zr + 0.25, 1.7, 0.32, 0.38, acc[1], dark);
      splitter(C, zf, 1.85, dark);
      sideSkirts(C, dark);
    },
    // Dune: sand ladders on the flanks and jerry cans on the tail.
    'dakar:dune': (C, acc, zr, zf) => {
      const ladder = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6, flatShading: true }); mats.push(ladder);
      for (const side of [-1, 1]) {
        const l = add(new THREE.BoxGeometry(0.04, 0.28, 1.3), ladder, side * (C.halfWidth(-0.9) + 0.03), C.belt(-0.9) - 0.25, -0.9, true);
        for (let k = 0; k < 6; k++) add(new THREE.BoxGeometry(0.05, 0.22, 0.02), dark, l.position.x, l.position.y, -1.45 + k * 0.22);
      }
      for (const x of [-0.45, 0.45]) jerryCan(x, C.bottom(zr) + 0.45, zr - 0.14, acc[0]);
    },
    // Expedition: snorkel, winch bull bar and a cargo box on the rack.
    'dakar:expedition': (C, acc, zr, zf) => {
      snorkel(C, 1.1, 0.4);
      bullBar(C, zf, 1.75);
      add(new THREE.BoxGeometry(0.26, 0.14, 0.2), acc[0], 0, C.bottom(zf) + 0.2, zf + 0.14, true);
      for (const x of [-0.4, 0, 0.4]) jerryCan(x, C.bottom(zr) + 0.45, zr - 0.14, acc[2]);
    },
    // Evo: tall hatch wing, a bigger roof scoop and nose canards.
    'groupb:rosso': (C, acc, zr, zf) => {
      bigWing(C, zr + 0.25, 1.7, 0.36, 0.4, acc[1], acc[0]);
      add(new THREE.BoxGeometry(0.44, 0.14, 0.6), acc[1], 0, C.top(-0.6) + 0.07, -0.6, true);
      splitter(C, zf, 1.85, acc[1]);
    },
    // Safari: bull bar, roof lamp pod, snorkel, tall flaps.
    'groupb:oro': (C, acc, zr, zf) => {
      bullBar(C, zf, 1.6);
      lampPod(4, 0.24, C.top(0) + 0.14, 0.1, 0.085);
      snorkel(C, 0.6, 0.1);
      bigFlaps(acc[0]);
    },
  }; }
  function disc(r, x, y, z, mat, back = false) {
    const m = add(new THREE.CircleGeometry(r, 14), mat, x, y, z);
    if (back) m.rotation.y = Math.PI;
    return m;
  }
  function doorNumbers(C, z, y, size) {
    if (plainSkin) return;
    if (ghost) return;
    const roundMat = new THREE.MeshBasicMaterial({ map: numberTexture(number, '#111'), transparent: true });
    mats.push(roundMat);
    for (const side of [-1, 1]) {
      const r = add(new THREE.PlaneGeometry(size, size), roundMat, side * (C.halfWidth(z) + 0.008), y, z);
      r.rotation.y = side * Math.PI / 2;
    }
  }
  function mudFlaps() {
    for (const side of [-1, 1]) for (const wz of [spec.a - WR - 0.1, -spec.b - WR - 0.1]) {
      add(new THREE.BoxGeometry(0.26, 0.2, 0.02), dark, side * wheelX, Math.max(0.19, WR - 0.12), wz);
    }
  }
  function miniDetails(C, acc, zr, zf, skinId) {
    const rally = skinId !== 'armchair';   // every style but the armchair gets the works rally kit
    const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.85, roughness: 0.25, flatShading: true });
    mats.push(chrome);
    // Grille between the wings, with chrome slats and surround.
    const gy = C.belt(zf) - 0.17;
    add(new THREE.BoxGeometry(0.62, 0.2, 0.03), dark, 0, gy, zf + 0.005);
    for (let n = 0; n < 5; n++) add(new THREE.BoxGeometry(0.6, 0.012, 0.035), chrome, 0, gy - 0.08 + n * 0.04, zf + 0.01);
    add(new THREE.BoxGeometry(0.66, 0.025, 0.04), chrome, 0, gy + 0.11, zf + 0.006);
    // Round headlamps in the wing fronts, indicators below.
    const amber = new THREE.MeshStandardMaterial({ color: 0xffa23a, emissive: 0xff7a1a, emissiveIntensity: 0.35 });
    mats.push(amber);
    for (const side of [-1, 1]) {
      const hx = side * 0.5, hy = C.belt(zf - 0.05) - 0.08, hz = zf + 0.005;
      const ring = add(new THREE.CylinderGeometry(0.095, 0.095, 0.06, 14), chrome, hx, hy, hz);
      ring.rotation.x = Math.PI / 2;
      disc(0.08, hx, hy, hz + 0.032, lightMat);
      heads.push([hx, hy, hz + 0.08, 1]);
      add(new THREE.BoxGeometry(0.07, 0.04, 0.02), amber, hx, hy - 0.15, zf + 0.01);
    }
    // Chrome bumpers with over-riders.
    const bw = 2 * C.halfWidth(zf - 0.1) + 0.04;
    add(new THREE.BoxGeometry(bw, 0.05, 0.06), chrome, 0, C.bottom(zf) + 0.1, zf + 0.04);
    add(new THREE.BoxGeometry(2 * C.halfWidth(zr + 0.1) + 0.04, 0.05, 0.06), chrome, 0, C.bottom(zr) + 0.06, zr - 0.04);
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.04, 0.16, 0.05), chrome, side * 0.3, C.bottom(zf) + 0.14, zf + 0.06);
      add(new THREE.BoxGeometry(0.04, 0.14, 0.05), chrome, side * 0.3, C.bottom(zr) + 0.1, zr - 0.06);
    }
    // Upright tail lamps, boot handle, single exhaust.
    for (const side of [-1, 1]) {
      const tx = side * 0.55, tz = zr - 0.012;
      add(new THREE.BoxGeometry(0.08, 0.13, 0.025), tailMat, tx, 0.6, tz);
      add(new THREE.BoxGeometry(0.08, 0.05, 0.025), amber, tx, 0.7, tz);
      tails.push([tx, 0.6, tz - 0.05]);
    }
    add(new THREE.BoxGeometry(0.12, 0.025, 0.03), chrome, 0, 0.74, zr - 0.012);
    const pipe = add(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), chrome, 0.3, C.bottom(zr) + 0.0, zr - 0.06);
    pipe.rotation.x = Math.PI / 2;
    // Door handles, mirrors, wipers (the window pillars are part of the body).
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.02, 0.025, 0.09), chrome, side * (C.halfWidth(0.1) + 0.012), 0.8, 0.1);
      const mz = 0.45, mx = side * (C.halfWidth(mz) + 0.05);
      add(new THREE.BoxGeometry(0.02, 0.12, 0.02), chrome, mx, 0.92, mz);
      const mir = add(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 10), chrome, mx, 1.0, mz);
      mir.rotation.x = Math.PI / 2;
      const wp = add(new THREE.BoxGeometry(0.36, 0.015, 0.02), dark, side * 0.18, C.top(0.62) + 0.03, 0.62);
      wp.rotation.z = side * 0.06;
    }
    if (rally) {
      // Four spot lamps on a bar across the grille, sump guard, arch extensions,
      // door numbers on the white panels, mud flaps.
      const lz = zf + 0.1, ly = gy - 0.02;
      add(new THREE.BoxGeometry(0.66, 0.03, 0.05), dark, 0, ly - 0.08, lz - 0.02);
      for (let n = 0; n < 4; n++) {
        const x = (n - 1.5) * 0.16;
        const pot = add(new THREE.CylinderGeometry(0.068, 0.068, 0.08, 12), chrome, x, ly, lz);
        pot.rotation.x = Math.PI / 2;
        disc(0.058, x, ly, lz + 0.042, lightMat);
        heads.push([x, ly, lz + 0.1, 0.7]);
      }
      const guard = add(new THREE.BoxGeometry(0.9, 0.03, 0.5), new THREE.MeshStandardMaterial({ color: 0x8b8f96, metalness: 0.6, roughness: 0.45, flatShading: true }), 0, C.bottom(zf) - 0.03, zf - 0.12, true);
      guard.rotation.x = -0.18;
      mats.push(guard.material);
      const lip = new THREE.TorusGeometry(ar + 0.01, 0.035, 4, 16, Math.PI);
      lip.rotateY(Math.PI / 2);
      for (const side of [-1, 1]) for (const wz of [spec.a, -spec.b]) add(lip, dark, side * (C.halfWidth(wz) + 0.01), WR, wz);
      doorNumbers(C, -0.01, 0.6, 0.3);
      mudFlaps();
    } else {
      // Armchair strapped to the roof.
      const fabric = new THREE.MeshStandardMaterial({ color: 0xa48a66, roughness: 0.95, flatShading: true });
      mats.push(fabric);
      const ry = C.top(-0.5) - 0.01, cz = -0.45;
      add(new THREE.BoxGeometry(0.72, 0.16, 0.6), fabric, 0, ry + 0.11, cz, true);
      add(new THREE.BoxGeometry(0.62, 0.08, 0.5), fabric, 0, ry + 0.23, cz + 0.03);
      const back = add(new THREE.BoxGeometry(0.72, 0.62, 0.16), fabric, 0, ry + 0.45, cz - 0.24, true);
      back.rotation.x = -0.12;
      for (const side of [-1, 1]) {
        add(new THREE.BoxGeometry(0.13, 0.3, 0.6), fabric, side * 0.36, ry + 0.27, cz);
        add(new THREE.BoxGeometry(0.05, 0.04, 0.05), dark, side * 0.3, ry + 0.02, cz + 0.25);
        add(new THREE.BoxGeometry(0.05, 0.04, 0.05), dark, side * 0.3, ry + 0.02, cz - 0.25);
      }
      // Straps from the arms down to the door frames.
      const rope = new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 1, flatShading: true });
      mats.push(rope);
      for (const side of [-1, 1]) for (const dz of [-0.2, 0.15]) {
        const x0 = side * 0.42, y0 = ry + 0.3, x1 = side * 0.63, y1 = ry - 0.12;
        const st = add(new THREE.BoxGeometry(0.025, Math.hypot(x1 - x0, y1 - y0), 0.04), rope, (x0 + x1) / 2, (y0 + y1) / 2, cz + dz);
        st.rotation.z = Math.atan2(x1 - x0, y0 - y1);
      }
      // The passenger: a chap in a brown suit, legs out over the windscreen,
      // waving. He can be thrown off (see main.js), so he's his own group.
      if (!ghost) rider = buildRider(ry + 0.27, cz);
    }
  }
  function quattroDetails(C, acc, zr, zf) {
    const mesh = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.7, metalness: 0.3, flatShading: true });
    const amber = new THREE.MeshStandardMaterial({ color: 0xffa23a, emissive: 0xff7a1a, emissiveIntensity: 0.35 });
    mats.push(mesh, amber);
    // Square nose: grille between two big rectangular headlamps, then
    // indicators and mesh intakes in the bumper, and the chin splitter.
    const nz = 1.98, ny = 0.78;
    add(new THREE.BoxGeometry(0.78, 0.15, 0.04), dark, 0, ny, nz + 0.03);
    for (let n = 0; n < 4; n++) add(new THREE.BoxGeometry(0.74, 0.01, 0.045), mesh, 0, ny - 0.05 + n * 0.033, nz + 0.035);
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.27, 0.16, 0.05), dark, side * 0.6, ny, nz + 0.02);
      add(new THREE.BoxGeometry(0.23, 0.12, 0.02), lightMat, side * 0.6, ny, nz + 0.05);
      heads.push([side * 0.6, ny, nz + 0.1, 1]);
      add(new THREE.BoxGeometry(0.12, 0.06, 0.02), amber, side * 0.78, 0.58, 2.04);
      add(new THREE.BoxGeometry(0.2, 0.07, 0.02), mesh, side * 0.5, 0.58, 2.045);
    }
    add(new THREE.BoxGeometry(0.34, 0.06, 0.02), mesh, 0, 0.58, 2.05);
    const lip = add(new THREE.BoxGeometry(fitW(C, zf - 0.2, 1.84), 0.04, 0.32), acc[0], 0, C.bottom(zf) + 0.02, zf - 0.1, true);
    lip.rotation.x = 0.04;
    // Bonnet vents.
    for (const side of [-1, 1]) {
      const v = add(new THREE.BoxGeometry(0.26, 0.03, 0.18), dark, side * 0.22, C.top(1.35) + 0.02, 1.35);
      v.rotation.x = 0.06;
    }
    // Huge rear wing: a main plane over the tail on tall end plates.
    const wy = C.top(-1.2) + 0.28, wz = zr + 0.15;
    const wingTop = add(new THREE.BoxGeometry(1.82, 0.04, 0.5), paint, 0, wy, wz, true);
    wingTop.rotation.x = -0.1;
    for (const side of [-1, 1]) {
      const ep = add(new THREE.BoxGeometry(0.03, 0.3, 0.72), paint, side * 0.9, wy - 0.1, wz + 0.2, true);
      ep.rotation.x = 0.12;
      add(new THREE.BoxGeometry(0.04, 0.28, 0.06), dark, side * 0.45, wy - 0.15, wz + 0.1);
    }
    // Black rear panel with two radiator grilles, tail lamps, side-exit exhaust.
    add(new THREE.BoxGeometry(1.5, 0.3, 0.02), dark, 0, 0.66, zr - 0.006);
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.46, 0.2, 0.025), mesh, side * 0.32, 0.67, zr - 0.012);
      add(new THREE.BoxGeometry(0.16, 0.12, 0.025), tailMat, side * 0.8, 0.8, zr - 0.012);
      tails.push([side * 0.8, 0.8, zr - 0.06]);
    }
    const chrome = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.8, roughness: 0.3 });
    mats.push(chrome);
    const ex = add(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10), chrome, 0.55, C.bottom(zr) + 0.02, zr - 0.06);
    ex.rotation.x = Math.PI / 2;
    // Side intakes behind the doors, door mirrors, wipers.
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.02, 0.4, 0.24), dark, side * (C.halfWidth(-0.95) + 0.006), 0.66, -0.95);
      const mz = 0.62, mx = side * (C.halfWidth(mz) + 0.03);
      add(new THREE.BoxGeometry(0.12, 0.09, 0.06), dark, mx, C.belt(mz) + 0.1, mz);
      const wp = add(new THREE.BoxGeometry(0.46, 0.015, 0.02), dark, side * 0.22, C.top(0.72) + 0.03, 0.72);
      wp.rotation.z = side * 0.06;
    }
    doorNumbers(C, 0.2, 0.8, 0.3);
    mudFlaps();
  }
  function focusDetails(C, acc, zr, zf) {
    const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.85, roughness: 0.25, flatShading: true });
    const amber = new THREE.MeshStandardMaterial({ color: 0xffa23a, emissive: 0xff7a1a, emissiveIntensity: 0.35 });
    mats.push(chrome, amber);
    // Four-lamp pod across the nose, swept-back headlamps, big lower intake.
    const lz = zf - 0.02, ly = C.top(zf - 0.08) + 0.08;
    add(new THREE.BoxGeometry(0.86, 0.05, 0.1), dark, 0, ly - 0.1, lz - 0.04);
    for (let n = 0; n < 4; n++) {
      const x = (n - 1.5) * 0.205;
      const pot = add(new THREE.CylinderGeometry(0.095, 0.095, 0.1, 12), dark, x, ly, lz);
      pot.rotation.x = Math.PI / 2;
      disc(0.082, x, ly, lz + 0.052, lightMat);
      heads.push([x, ly, lz + 0.1, 0.8]);
    }
    for (const side of [-1, 1]) {
      const hl = add(new THREE.BoxGeometry(0.34, 0.1, 0.03), lightMat, side * 0.6, C.belt(1.85) - 0.07, 1.86);
      hl.rotation.y = -side * 0.45;
      heads.push([side * 0.6, C.belt(1.85) - 0.07, 1.92, 0.9]);
      add(new THREE.BoxGeometry(0.1, 0.07, 0.02), dark, side * 0.62, 0.42, zf + 0.004);
    }
    add(new THREE.BoxGeometry(0.9, 0.2, 0.02), dark, 0, 0.47, zf + 0.004);
    // Tall tail lamps up the rear pillars, beside the hatch glass.
    for (const side of [-1, 1]) {
      const tl = add(new THREE.BoxGeometry(0.11, 0.36, 0.04), tailMat, side * 0.66, 1.14, -2.05);
      tl.rotation.x = 0.42;
      add(new THREE.BoxGeometry(0.11, 0.08, 0.04), amber, side * 0.66, 0.97, -2.11);
      tails.push([side * 0.66, 1.14, -2.12]);
    }
    // Light blue X across the blue tailgate, single exhaust.
    for (const k of [-1, 1]) {
      const st = add(new THREE.BoxGeometry(1.3, 0.05, 0.01), acc[2], 0, 0.72, zr - 0.006);
      st.rotation.z = k * 0.42;
    }
    const ex = add(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10), chrome, 0.5, C.bottom(zr) + 0.02, zr - 0.06);
    ex.rotation.x = Math.PI / 2;
    // Orange wing on the hatch.
    const wing = add(new THREE.BoxGeometry(1.42, 0.05, 0.38), acc[1], 0, C.top(-1.95) + 0.06, -1.98, true);
    wing.rotation.x = -0.12;
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.08, 0.36), acc[1], side * 0.7, C.top(-1.95) + 0.03, -1.98);
    // Body-coloured mirrors, wipers.
    for (const side of [-1, 1]) {
      const mz = 0.82, mx = side * (C.halfWidth(mz) + 0.04);
      add(new THREE.BoxGeometry(0.13, 0.1, 0.07), paint, mx, C.belt(mz) + 0.1, mz);
      const wp = add(new THREE.BoxGeometry(0.5, 0.015, 0.02), dark, side * 0.24, C.top(0.9) + 0.03, 0.9);
      wp.rotation.z = side * 0.05;
    }
    doorNumbers(C, -0.1, 0.72, 0.3);
    mudFlaps();
  }
  function dakarDetails(C, acc, zr, zf) {
    const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.85, roughness: 0.25, flatShading: true });
    const red = new THREE.MeshStandardMaterial({ color: 0xd42a20, roughness: 0.5, flatShading: true });
    const amber = new THREE.MeshStandardMaterial({ color: 0xffa23a, emissive: 0xff7a1a, emissiveIntensity: 0.35 });
    mats.push(chrome, red, amber);
    // Big headlamps in the wing fronts, three intakes, red tow hooks, skid plate.
    for (const side of [-1, 1]) {
      const hz = zf - 0.12, hy = C.belt(hz) - 0.05;
      const hl = add(new THREE.BoxGeometry(0.3, 0.15, 0.04), lightMat, side * 0.62, hy, hz + 0.04);
      hl.rotation.x = -0.55;
      heads.push([side * 0.62, hy, hz + 0.12, 1]);
      add(new THREE.BoxGeometry(0.3, 0.13, 0.02), dark, side * 0.58, 0.74, zf + 0.004);
      add(new THREE.BoxGeometry(0.1, 0.05, 0.02), amber, side * 0.82, 0.88, zf - 0.03);
      const hook = add(new THREE.BoxGeometry(0.06, 0.06, 0.12), red, side * 0.5, C.bottom(zf) + 0.0, zf + 0.04);
      hook.castShadow = true;
    }
    add(new THREE.BoxGeometry(0.62, 0.17, 0.02), dark, 0, 0.74, zf + 0.004);
    const skid = add(new THREE.BoxGeometry(1.1, 0.03, 0.55), chrome, 0, C.bottom(zf) - 0.04, zf - 0.2);
    skid.rotation.x = -0.15;
    // Roof rack with two spare tyres and a five-lamp bar on the front edge.
    const ry = C.top(-0.6) + 0.06;
    add(new THREE.BoxGeometry(1.4, 0.04, 1.9), dark, 0, ry, -0.75);
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.1, 1.9), dark, side * 0.7, ry + 0.04, -0.75);
    for (const dz of [-0.35, -1.15]) {
      const tyre = add(new THREE.CylinderGeometry(WR * 0.95, WR * 0.95, 0.26, 16), dark, 0, ry + 0.15, dz, true);
      tyre.castShadow = true;
    }
    add(new THREE.BoxGeometry(1.3, 0.05, 0.08), dark, 0, ry + 0.06, 0.2);
    for (let n = 0; n < 5; n++) {
      const x = (n - 2) * 0.27;
      const pot = add(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 12), dark, x, ry + 0.17, 0.2);
      pot.rotation.x = Math.PI / 2;
      disc(0.088, x, ry + 0.17, 0.252, lightMat);
      heads.push([x, ry + 0.17, 0.3, 0.8]);
    }
    // Wide tail lamps, roof spoiler, twin pipes each side.
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.32, 0.13, 0.03), tailMat, side * 0.66, 1.1, zr - 0.012);
      tails.push([side * 0.66, 1.1, zr - 0.06]);
      for (const k of [-1, 1]) {
        const p = add(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10), chrome, side * (0.6 + k * 0.06), C.bottom(zr) + 0.02, zr - 0.04);
        p.rotation.x = Math.PI / 2;
      }
    }
    add(new THREE.BoxGeometry(1.5, 0.05, 0.3), paint, 0, C.top(-2.1) + 0.05, -2.12, true);
    // Body-coloured mirrors, wipers.
    for (const side of [-1, 1]) {
      const mz = 1.05, mx = side * (C.halfWidth(mz) + 0.05);
      add(new THREE.BoxGeometry(0.15, 0.11, 0.08), paint, mx, C.belt(mz) + 0.12, mz);
      const wp = add(new THREE.BoxGeometry(0.55, 0.015, 0.02), dark, side * 0.26, C.top(1.15) + 0.03, 1.15);
      wp.rotation.z = side * 0.05;
    }
    doorNumbers(C, -1.0, 0.82, 0.32);
    mudFlaps();
  }
  function groupbDetails(C, acc, zr, zf) {
    const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.85, roughness: 0.25, flatShading: true });
    mats.push(chrome);
    // Six round lamps in the nose: three across the top each side, one below.
    const fz = zf + 0.005, uy = C.belt(zf - 0.05) - 0.15, ly = uy - 0.15;
    for (const side of [-1, 1]) {
      for (const [x, y] of [[0.3, uy], [0.5, uy], [0.7, uy - 0.02], [0.42, ly]]) {
        const lx = side * x;
        const ring = add(new THREE.CylinderGeometry(0.088, 0.088, 0.05, 14), chrome, lx, y, fz);
        ring.rotation.x = Math.PI / 2;
        disc(0.075, lx, y, fz + 0.027, lightMat);
        heads.push([lx, y, fz + 0.08, 0.8]);
      }
      add(new THREE.BoxGeometry(0.14, 0.09, 0.02), dark, side * 0.1, uy - 0.02, fz);
    }
    const splitter = add(new THREE.BoxGeometry(fitW(C, zf - 0.2, 1.8), 0.05, 0.3), acc[2], 0, C.bottom(zf) + 0.03, zf - 0.08, true);
    splitter.rotation.x = 0.05;
    // Black spoiler overhanging the back of the roof; white vent at the front.
    const sy = C.top(-1.6) + 0.06;
    const sp = add(new THREE.BoxGeometry(1.3, 0.03, 0.4), dark, 0, sy, -1.72, true);
    sp.rotation.x = -0.18;
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.08, 0.3), dark, side * 0.62, sy - 0.04, -1.66);
    add(new THREE.BoxGeometry(0.5, 0.07, 0.26), paint, 0, C.top(0.0) + 0.04, 0.0, true);
    add(new THREE.BoxGeometry(0.44, 0.04, 0.02), dark, 0, C.top(0.0) + 0.05, 0.13);
    // Tail: black band between tall amber-over-red lamps, single pipe.
    const amberS4 = new THREE.MeshStandardMaterial({ color: 0xffa23a, emissive: 0xff7a1a, emissiveIntensity: 0.35 });
    mats.push(amberS4);
    add(new THREE.BoxGeometry(1.25, 0.14, 0.02), dark, 0, 0.9, zr - 0.006);
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.11, 0.1, 0.025), amberS4, side * 0.76, 0.95, zr - 0.012);
      add(new THREE.BoxGeometry(0.11, 0.12, 0.025), tailMat, side * 0.76, 0.83, zr - 0.012);
      tails.push([side * 0.76, 0.85, zr - 0.06]);
    }
    const pipe = add(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10), chrome, 0.4, C.bottom(zr) + 0.02, zr - 0.06);
    pipe.rotation.x = Math.PI / 2;
    // Big white mud flaps behind the rear wheels.
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.34, 0.36, 0.02), trim, side * wheelX, 0.24, -spec.b - WR - 0.12);
    // Black mirrors, wipers.
    for (const side of [-1, 1]) {
      const mz = 0.62, mx = side * (C.halfWidth(mz) + 0.04);
      add(new THREE.BoxGeometry(0.12, 0.09, 0.06), dark, mx, C.belt(mz) + 0.1, mz);
      const wp = add(new THREE.BoxGeometry(0.46, 0.015, 0.02), dark, side * 0.22, C.top(0.7) + 0.03, 0.7);
      wp.rotation.z = side * 0.06;
    }
    doorNumbers(C, -0.1, 0.62, 0.3);
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.26, 0.2, 0.02), dark, side * wheelX, Math.max(0.19, WR - 0.12), spec.a - WR - 0.1);
  }
  function buildRider(sy, cz) {
    const g = new THREE.Group();
    const m = (c) => { const x = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }); mats.push(x); return x; };
    const suit = m(0x5b4733), trousers = m(0x463626), shirt = m(0xf2efe8), skin = m(0xe9c39f), hair = m(0x2b1f16), tie = m(0x8c1c1c), shoe = m(0x141414);
    // Parts are placed relative to his hips, so he tumbles about his middle.
    g.position.set(0, sy, cz);
    g.userData.home = [0, sy, cz];
    const part = (geo, mat, x, y, z, rx = 0, rz = 0) => {
      const p = new THREE.Mesh(geo, mat);
      p.position.set(x, y - sy, z - cz); p.rotation.set(rx, 0, rz);
      p.castShadow = true;
      g.add(p);
      return p;
    };
    part(new THREE.BoxGeometry(0.4, 0.48, 0.24), suit, 0, sy + 0.27, cz - 0.1, -0.12);
    part(new THREE.BoxGeometry(0.12, 0.3, 0.02), shirt, 0, sy + 0.33, cz + 0.03, -0.12);
    part(new THREE.BoxGeometry(0.04, 0.2, 0.025), tie, 0, sy + 0.32, cz + 0.045, -0.12);
    part(new THREE.BoxGeometry(0.2, 0.24, 0.21), skin, 0, sy + 0.66, cz - 0.07);
    part(new THREE.BoxGeometry(0.21, 0.06, 0.22), hair, 0, sy + 0.8, cz - 0.08);
    for (const side of [-1, 1]) {
      part(new THREE.BoxGeometry(0.14, 0.13, 0.46), trousers, side * 0.1, sy + 0.08, cz + 0.2);
      part(new THREE.BoxGeometry(0.12, 0.12, 0.46), trousers, side * 0.1, sy - 0.04, cz + 0.6, 0.55);
      part(new THREE.BoxGeometry(0.12, 0.08, 0.2), shoe, side * 0.1, sy - 0.16, cz + 0.84);
    }
    part(new THREE.BoxGeometry(0.1, 0.42, 0.1), suit, 0.27, sy + 0.62, cz - 0.08, 0, -0.45);   // waving arm
    part(new THREE.BoxGeometry(0.09, 0.09, 0.09), skin, 0.37, sy + 0.84, cz - 0.08);
    part(new THREE.BoxGeometry(0.1, 0.1, 0.36), suit, -0.25, sy + 0.24, cz + 0.08, -0.2);      // other arm on the armrest
    body.add(g);
    return g;
  }
  function stratosDetails(C, acc, zr, zf) {
    const half = zf;
    // Four rally lamps across the bonnet, round headlamps in the fender ends.
    const lz = half - 0.13, ly = C.top(lz) + 0.08;
    add(new THREE.BoxGeometry(0.98, 0.05, 0.1), dark, 0, ly - 0.09, lz - 0.03);
    for (let n = 0; n < 4; n++) {
      const x = (n - 1.5) * 0.24;
      const pot = add(new THREE.CylinderGeometry(0.085, 0.085, 0.09, 12), dark, x, ly, lz);
      pot.rotation.x = Math.PI / 2;
      disc(0.072, x, ly, lz + 0.047, lightMat);
      heads.push([x, ly, lz + 0.1, 0.8]);
    }
    for (const side of [-1, 1]) {
      const hx = side * 0.6, hz = half - 0.04, hy = C.belt(hz) - 0.07;
      const ring = add(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 14), dark, hx, hy, hz);
      ring.rotation.x = Math.PI / 2;
      disc(0.085, hx, hy, hz + 0.032, lightMat);
      heads.push([hx, hy, hz + 0.08, 1]);
    }
    // Chin slot, and the black tail panel's round lamps, reversing lights and pipes.
    add(new THREE.BoxGeometry(1.0, 0.06, 0.03), dark, 0, C.bottom(half) + 0.07, half + 0.005);
    const panelTop = C.belt(-half) - 0.32, panelBot = C.bottom(-half);
    add(new THREE.BoxGeometry(2 * C.halfWidth(-half) - 0.1, panelTop - panelBot, 0.02), dark, 0, (panelTop + panelBot) / 2, -half - 0.006);
    const amber = new THREE.MeshStandardMaterial({ color: 0xff9a2a, emissive: 0xff7a1a, emissiveIntensity: 0.4 });
    mats.push(amber);
    for (const side of [-1, 1]) {
      const tx = side * 0.56, ty = C.belt(-half) - 0.18, tz = -half - 0.01;
      const ring = add(new THREE.CylinderGeometry(0.115, 0.115, 0.05, 14), dark, tx, ty, tz + 0.01);
      ring.rotation.x = Math.PI / 2;
      disc(0.095, tx, ty, tz - 0.02, tailMat, true);
      disc(0.04, tx, ty, tz - 0.025, amber, true);
      tails.push([tx, ty, tz - 0.06]);
      add(new THREE.BoxGeometry(0.13, 0.06, 0.02), trim, side * 0.3, ty, tz);
    }
    const chrome = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.8, roughness: 0.3 });
    mats.push(chrome);
    for (const side of [-1, 1]) {
      const p = add(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 10), chrome, side * 0.24, C.bottom(-half) + 0.02, -half - 0.05);
      p.rotation.x = Math.PI / 2;
    }
    // Roof spoiler with end plates, and the louvred engine cover.
    const sz = -0.62, sy = C.top(-0.58) + 0.07;
    const wing = add(new THREE.BoxGeometry(1.18, 0.03, 0.24), acc[1], 0, sy, sz, true);
    wing.rotation.x = -0.12;
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.09, 0.26), paint, side * 0.59, sy - 0.03, sz);
    for (let z = -0.86; z > -half + 0.2; z -= 0.12) add(new THREE.BoxGeometry(1.0, 0.025, 0.04), dark, 0, C.top(z) + 0.02, z);
    // Stalk mirrors at the base of the screen, wipers, door numbers, mud flaps.
    for (const side of [-1, 1]) {
      const mz = 0.62, mx = side * (C.halfWidth(mz) - 0.02), my = C.belt(mz) + 0.1;
      add(new THREE.BoxGeometry(0.02, 0.12, 0.02), dark, mx, my - 0.06, mz);
      add(new THREE.BoxGeometry(0.1, 0.07, 0.05), dark, mx + side * 0.03, my + 0.02, mz);
      const wp = add(new THREE.BoxGeometry(0.42, 0.015, 0.02), dark, side * 0.2, C.top(0.7) + 0.035, 0.7);
      wp.rotation.z = side * 0.08;
    }
    if (!ghost && !plainSkin) {
      const roundMat = new THREE.MeshBasicMaterial({ map: numberTexture(number, '#111'), transparent: true });
      mats.push(roundMat);
      for (const side of [-1, 1]) {
        const r = add(new THREE.PlaneGeometry(0.34, 0.34), roundMat, side * (C.halfWidth(0.15) + 0.008), 0.5, 0.15);
        r.rotation.y = side * Math.PI / 2;
      }
    }
    for (const side of [-1, 1]) for (const wz of [spec.a - WR - 0.1, -spec.b - WR - 0.1]) {
      add(new THREE.BoxGeometry(0.28, 0.2, 0.02), dark, side * wheelX, Math.max(0.2, WR - 0.12), wz);
    }
  }

  // Wheels: pivot (steers) -> spinner (rolls) -> tyre + rim.
  // Tyre: round tread, flat sidewalls and rounded shoulders (built along X).
  const rIn = WR * 0.62, sh = 0.04;
  const tyreParts = [];
  const tread = new THREE.CylinderGeometry(WR, WR, tw - sh * 2, 28, 1, true);
  tread.rotateZ(Math.PI / 2);
  tyreParts.push(tread);
  for (const sx of [-1, 1]) {
    const wall = new THREE.RingGeometry(rIn, WR - sh, 28);
    wall.rotateY(Math.PI / 2);
    wall.translate(sx * hw, 0, 0);
    tyreParts.push(wall);
    const shoulder = new THREE.TorusGeometry(WR - sh, sh, 6, 28);
    shoulder.rotateY(Math.PI / 2);
    shoulder.translate(sx * (hw - sh), 0, 0);
    tyreParts.push(shoulder);
  }
  const tyreGeo = mergeTyre(tyreParts);
  // Dark disc filling the middle of the tyre behind the rim.
  const rimScale = (rIn + 0.01) / 0.3;   // rims are built ~0.3 m in radius; fit them inside the sidewall
  const hubGeo = new THREE.CircleGeometry(rIn + 0.01, 20);
  hubGeo.rotateY(Math.PI / 2);
  const darkDS = dark.clone(); darkDS.side = THREE.DoubleSide; mats.push(darkDS);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.92, side: THREE.DoubleSide });
  mats.push(tyreMat);
  const rimMat = new THREE.MeshStandardMaterial({ color: RIM_COLORS[wheelStyle], roughness: 0.4, metalness: 0.5, flatShading: true });
  mats.push(rimMat);
  const wheels = [];
  const positions = [
    [wheelX, spec.a, true], [-wheelX, spec.a, true],
    [wheelX, -spec.b, false], [-wheelX, -spec.b, false],
  ];
  for (const [x, z, isFront] of positions) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WR, z);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(tyreGeo, tyreMat);
    tyre.castShadow = true;
    spin.add(tyre, new THREE.Mesh(hubGeo, darkDS));
    const rim = buildRim(wheelStyle, rimMat, dark);
    rim.position.x = Math.sign(x) * (hw - 0.01);
    rim.scale.setScalar(rimScale);
    spin.add(rim);
    spin.userData.rim = rim;
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin, isFront, side: Math.sign(x) });
  }

  // Brake discs behind the rims; they glow after heavy braking.
  const discMat = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.6, roughness: 0.4, emissive: 0xff4a10, emissiveIntensity: 0 });
  mats.push(discMat);
  const discGeo = new THREE.CylinderGeometry(rIn * 0.85, rIn * 0.85, 0.03, 16).rotateZ(Math.PI / 2);
  for (const w of wheels) {
    const d = new THREE.Mesh(discGeo, discMat);
    d.position.x = w.side * (hw - 0.07);
    w.pivot.add(d);
  }
  let brakeHeat = 0;

  // Night glow: soft additive halos on every lamp, off by day.
  const glow = new THREE.Group();
  glow.visible = false;
  const headGlow = new THREE.SpriteMaterial({ map: haloTexture(), color: 0xfff1c8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const tailGlow = new THREE.SpriteMaterial({ map: haloTexture(), color: 0xff2a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  for (const [x, y, z, k] of heads) { const sp = new THREE.Sprite(headGlow); sp.position.set(x, y, z); sp.scale.setScalar(1.3 * k); glow.add(sp); }
  for (const [x, y, z] of tails) { const sp = new THREE.Sprite(tailGlow); sp.position.set(x, y, z); sp.scale.setScalar(0.7); glow.add(sp); }
  if (!ghost) body.add(glow);
  let glowLevel = 0;

  // Cockpit (only shown in the cockpit camera): dash, steering wheel, rev lights.
  const cockpit = new THREE.Group();
  cockpit.visible = false;
  // Everything is placed from the windscreen: its base (bz, by) where it
  // meets the bonnet and its top (tz, ty) where it meets the roof. Lofted
  // bodies take these from their own curves, so the dash sits right under
  // the real screen and the driver's eye just below the real roof.
  let seatX = -W * 0.2, dashZ = g[3][0] - 0.05, dashY = topY(g[3][0]) + bev + 0.02;
  let gw = W - (rnd ? 0.24 + rnd * 0.02 : 0.18);
  let [bz, by] = g[3], [tz, ty] = g[2];
  if (loftC) {
    [tz, bz] = loftDef.glass.screen;
    by = loftC.top(bz); ty = loftC.top(tz);
    gw = 2 * loftC.cabinWidth((bz + tz) / 2) - 0.08;
    seatX = -gw * 0.22;
    dashZ = bz; dashY = by + 0.02;
  }
  // A touch of self-light so the cabin reads as dark grey trim, not a black hole.
  const dashMat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, emissive: 0x16171b, roughness: 0.9 });
  mats.push(dashMat);
  // Lofted: the dash top sits a little under the screen base so the bonnet
  // shows over it.
  const dashTop = loftC ? dashY - 0.07 : dashY + 0.04;
  const dash = new THREE.Mesh(new THREE.BoxGeometry(loftC ? gw : W - 0.3, 0.2, 0.45), dashMat);
  dash.position.set(0, dashTop - 0.1, dashZ - 0.2);
  cockpit.add(dash);
  // Window frame seen from inside: A-pillars and a header rail. There's no
  // headlining: like most racing games the view is opened up above the
  // screen (the body's roof faces away from the eye, so it isn't drawn).
  const pl = Math.hypot(tz - bz, ty - by);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, pl), dashMat);
    pillar.position.set(side * (gw / 2 - 0.05), (by + ty) / 2 - 0.02, (bz + tz) / 2);
    pillar.rotation.x = Math.atan2(ty - by, bz - tz);
    cockpit.add(pillar);
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.025, 0.05), dashMat);
  header.position.set(0, ty - 0.005, tz + 0.01);
  cockpit.add(header);
  // Driver's eye: just behind the top of the screen, kept inside the cabin
  // (the tiny wedge cars have very little room behind it).
  const eyeZ = loftC ? Math.max(tz - 0.4, loftDef.glass.side[0] + 0.3) : bz - 0.85;
  // Interior tub over the body top between the seat and the dash.
  const sillY = loftC ? loftC.belt(eyeZ) - 0.02 : Math.max(topY(eyeZ), topY(bz)) + bev + 0.01;
  const tub = new THREE.Mesh(new THREE.BoxGeometry(gw + 0.04, 0.02, bz - eyeZ + 0.9), dashMat);
  tub.position.set(0, sillY, (bz + eyeZ - 0.9) / 2);
  cockpit.add(tub);
  const seat = new THREE.Vector3(seatX, loftC ? Math.max(dashTop + 0.2, ty - 0.11) : Math.max(sillY + 0.2, ty - 0.08), eyeZ);
  // Steering wheel low in front of the driver: only the top of the rim shows.
  const wheelGrp = new THREE.Group();
  wheelGrp.position.set(seatX, loftC ? seat.y - 0.32 : dashY - 0.02, loftC ? Math.min(eyeZ + 0.5, dashZ - 0.45) : dashZ - 0.4);
  wheelGrp.rotation.x = -0.45;
  const wheelRimMat = new THREE.MeshStandardMaterial({ color: 0x1c1d21, emissive: 0x0e0f12, roughness: 0.7 });
  mats.push(wheelRimMat);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 24), wheelRimMat);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.02), wheelRimMat);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), new THREE.MeshBasicMaterial({ color: 0xffb000 }));
  mark.position.y = 0.17;
  const wheelSpin = new THREE.Group();
  wheelSpin.add(rim, spoke, mark);
  wheelGrp.add(wheelSpin);
  cockpit.add(wheelGrp);
  // Shift lights along the back edge of the dash.
  const revLights = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.018, 0.01), new THREE.MeshBasicMaterial({ color: 0x222222 }));
    m.position.set(seatX - 0.16 + i * 0.036, dashTop + 0.01, dashZ - 0.43);
    m.userData.on = i < 6 ? 0x3ddc84 : i < 8 ? 0xffb000 : 0xff3b30;
    revLights.push(m);
    cockpit.add(m);
  }
  body.add(cockpit);
  // Things bolted on above the screen (roof scoops, racks, lamp pods, a man
  // in an armchair) would hang in the sky from inside: hide them in the
  // cockpit view.
  const roofBits = [];
  {
    const box = new THREE.Box3(), inv = new THREE.Matrix4();
    root.updateMatrixWorld(true);
    inv.copy(body.matrixWorld).invert();
    body.traverse((o) => {
      if (!o.isMesh || o === bodyMesh || o === glassMesh) return;
      for (let p = o; p; p = p.parent) if (p === cockpit) return;
      box.setFromObject(o).applyMatrix4(inv);
      if (box.min.y > ty - 0.12) roofBits.push(o);
    });
  }

  if (ghost) {
    root.traverse((o) => {
      o.castShadow = false;
      // A mesh can have one material or a list of them (the lofted bodies).
      for (const m of [].concat(o.material || [])) if (m && !mats.includes(m)) mats.push(m);
    });
    for (const m of mats) { m.transparent = true; m.opacity = 0.38; m.depthWrite = false; }
  }

  // Roof height (body and glass, plus the rack), used to frame the camera.
  const roofBox = new THREE.Box3().setFromObject(bodyMesh).union(new THREE.Box3().setFromObject(glassMesh));
  const roofH = roofBox.max.y + (prof.rack ? 0.3 : 0);
  const api = {
    root, body, wheels, paint, roofH, seat, cockpit,
    get rider() { return rider; },
    // Put a thrown-off passenger back in his chair.
    seatRider() {
      if (!rider) return;
      body.add(rider);
      rider.position.set(...rider.userData.home); rider.rotation.set(0, 0, 0); rider.scale.set(1, 1, 1);
    },
    setGlow(level) {
      glowLevel = level;
      glow.visible = level > 0;
      headGlow.opacity = 0.9 * level;
    },
    setCockpit(on) {
      if (cockpit.visible === on) return;
      cockpit.visible = on; glassMesh.visible = !on;
      for (const o of roofBits) o.visible = !on;
    },
    setColor(c) { paint.color.set(c); for (const m of mats) if (m.userData.followPaint) m.color.set(c); },
    // Purely cosmetic crash damage: push the bodywork in around a point
    // (body space: x right, y up, z forward). `depth` in metres.
    dent(x, y, z, depth) {
      const R = 0.75;
      const hit = new THREE.Vector3(x, y, z);
      const push = new THREE.Vector3(-x * 0.8, 0.55 - y, -z).normalize();   // toward the middle
      const inv = new THREE.Matrix4(), p = new THREE.Vector3(), dir = new THREE.Vector3(), v = new THREE.Vector3();
      const done = new Set(), users = new Map();
      for (const m of body.children) if (m.isMesh) users.set(m.geometry, (users.get(m.geometry) || 0) + 1);
      for (const m of body.children) {
        // Skip parts that share a geometry (arches, pipes): denting one would dent all.
        if (!m.isMesh || done.has(m.geometry) || users.get(m.geometry) > 1) continue;
        done.add(m.geometry);
        m.updateMatrix();
        inv.copy(m.matrix).invert();
        p.copy(hit).applyMatrix4(inv);
        dir.copy(push).transformDirection(inv);
        const pos = m.geometry.attributes.position;
        if (!m.geometry.userData.orig) m.geometry.userData.orig = pos.array.slice();
        const orig = m.geometry.userData.orig;
        let moved = false;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          const d = v.distanceTo(p);
          if (d >= R) continue;
          const f = (1 - d / R) ** 2;
          // A little noise so it crumples rather than pressing in smoothly.
          const n = 0.7 + 0.6 * Math.abs(Math.sin(orig[i * 3] * 91.7 + orig[i * 3 + 1] * 47.3 + orig[i * 3 + 2] * 13.1));
          v.addScaledVector(dir, depth * f * n);
          // Never more than 0.22 m from the original shape.
          const ox = orig[i * 3], oy = orig[i * 3 + 1], oz = orig[i * 3 + 2];
          const dx = v.x - ox, dy = v.y - oy, dz = v.z - oz, dl = Math.hypot(dx, dy, dz);
          if (dl > 0.22) v.set(ox + dx * 0.22 / dl, oy + dy * 0.22 / dl, oz + dz * 0.22 / dl);
          pos.setXYZ(i, v.x, v.y, v.z);
          moved = true;
        }
        if (moved) { pos.needsUpdate = true; m.geometry.computeVertexNormals(); }
      }
    },
    // Back to showroom condition.
    repair() {
      for (const m of body.children) {
        const o = m.geometry?.userData.orig;
        if (!o) continue;
        m.geometry.attributes.position.array.set(o);
        m.geometry.attributes.position.needsUpdate = true;
        m.geometry.computeVertexNormals();
      }
    },
    setWheelStyle(style) {
      rimMat.color.setHex(RIM_COLORS[style]);
      for (const w of wheels) {
        w.spin.remove(w.spin.userData.rim);
        const rim = buildRim(style, rimMat, dark);
        rim.position.x = w.side * (hw - 0.01);
        rim.scale.setScalar(rimScale);
        w.spin.add(rim);
        w.spin.userData.rim = rim;
      }
    },
    // Pose the model from the physics state.
    update(car, dt) {
      root.position.set(car.x, car.y ?? 0, car.z);
      // Follow the ground: pitch up hills, roll across slopes.
      root.rotation.order = 'YXZ';
      root.rotation.y = car.yaw;
      const k = Math.min(1, dt * 12);
      root.rotation.x += (-(car.groundPitch || 0) - root.rotation.x) * k;
      root.rotation.z += ((car.groundRoll || 0) - root.rotation.z) * k;
      // Body pitch from longitudinal accel, roll from lateral accel.
      const pitch = THREE.MathUtils.clamp(-car.axSmooth * 0.008, -0.07, 0.07);
      const roll = THREE.MathUtils.clamp(car.aySmooth * 0.009, -0.08, 0.08);
      body.rotation.x = THREE.MathUtils.lerp(body.rotation.x, pitch, Math.min(1, dt * 10));
      body.rotation.z = THREE.MathUtils.lerp(body.rotation.z, roll, Math.min(1, dt * 10));
      body.position.y = 0.02 - (car.squash || 0) + (car.air ? 0 : Math.sin(performance.now() * 0.03) * 0.004 * Math.min(1, car.speed / 20));
      const roll2 = car.vF / WR * dt;
      for (const w of wheels) {
        if (w.isFront) w.pivot.rotation.y = car.steer;
        // Suspension droops when the car is airborne.
        w.pivot.position.y += ((car.air && car.airTime > 0.06 ? WR - 0.12 : WR) - w.pivot.position.y) * Math.min(1, dt * 14);
        // Rear wheels spin faster when the tyres are lit up.
        w.spin.rotation.x += w.isFront ? roll2 : roll2 * (1 + car.wheelSpin * 2);
      }
      tailMat.emissiveIntensity = car.brake > 0.1 ? 2.2 : 0.5;
      if (glowLevel) tailGlow.opacity = (car.brake > 0.1 ? 1 : 0.45) * Math.max(0.6, glowLevel);
      // Discs heat up under hard braking at speed and cool off slowly.
      brakeHeat = Math.max(0, Math.min(1, brakeHeat + ((car.brake || 0) * Math.min(1, car.speed / 25) * 0.9 - 0.18) * dt));
      discMat.emissiveIntensity = brakeHeat * brakeHeat * 3;
      if (cockpit.visible) {
        wheelSpin.rotation.z = -(car.steer || 0) * 4;
        const lit = Math.round(Math.max(0, Math.min(1, (car.rpm - car.spec.idleRpm) / (car.spec.redline - car.spec.idleRpm))) * 10);
        revLights.forEach((m, i) => m.material.color.setHex(i < lit ? m.userData.on : 0x222222));
      }
    },
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      mats.forEach((m) => { m.map?.dispose(); m.dispose?.(); });
    },
  };
  return api;
}
