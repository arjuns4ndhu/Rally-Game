// Low-poly car meshes built from extruded side profiles.
import * as THREE from 'three';

// Side profiles: [z (forward), y (up)] in metres, traced around the outline.
const PROFILES = {
  hatch: {
    body: [[-1.78, 0.3], [-1.82, 0.78], [-1.6, 0.9], [0.9, 0.86], [1.7, 0.7], [1.85, 0.5], [1.82, 0.3]],
    glass: [[-1.62, 0.88], [-1.45, 1.36], [0.05, 1.4], [0.85, 0.88]],
    width: 1.66, wing: false, hood: [0.95, 1.65],
  },
  coupe: {
    body: [[-2.0, 0.32], [-2.05, 0.74], [-1.75, 0.88], [-0.95, 0.9], [1.25, 0.86], [1.95, 0.66], [2.08, 0.46], [2.02, 0.32]],
    glass: [[-1.05, 0.89], [-0.35, 1.3], [0.45, 1.32], [1.15, 0.87]],
    width: 1.74, wing: true, hood: [1.2, 1.9],
  },
  muscle: {
    body: [[-2.2, 0.32], [-2.24, 0.8], [-1.9, 0.92], [-1.05, 0.94], [1.35, 0.92], [2.15, 0.78], [2.25, 0.5], [2.18, 0.32]],
    glass: [[-1.1, 0.93], [-0.45, 1.28], [0.3, 1.3], [1.0, 0.92]],
    width: 1.84, wing: true, hood: [1.3, 2.1], scoop: true,
  },
  wagon: {
    body: [[-2.05, 0.34], [-2.1, 0.86], [-1.95, 0.95], [1.2, 0.92], [1.95, 0.72], [2.1, 0.5], [2.05, 0.34]],
    glass: [[-1.98, 0.94], [-1.88, 1.42], [0.3, 1.45], [1.1, 0.93]],
    width: 1.78, wing: false, hood: [1.15, 1.95], roofRack: true,
  },
};

function extrudeProfile(pts, width, bevel = 0.05) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1,
  });
  // Shape is in XY; extrusion goes along +Z. Rotate so profile x -> world z.
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
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

const RIM_COLORS = { spoke: 0xd8d4c8, dish: 0x2b2d33, mesh: 0xc9a54a, tarmac: 0xf2f2ee };

export function buildCarModel(spec, { color = '#e8542a', wheelStyle = 'spoke', number = 7, ghost = false } = {}) {
  const prof = PROFILES[spec.bodyStyle] || PROFILES.coupe;
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

  // Scale the profile so its length matches the car spec.
  const xs = prof.body.map((p) => p[0]);
  const profLen = Math.max(...xs) - Math.min(...xs);
  const k = spec.length / profLen;
  const scaled = (pts) => pts.map(([z, y]) => [z * k, y]);

  const bodyMesh = new THREE.Mesh(extrudeProfile(scaled(prof.body), prof.width), paint);
  const glassMesh = new THREE.Mesh(extrudeProfile(scaled(prof.glass), prof.width - 0.18, 0.04), glass);
  bodyMesh.castShadow = glassMesh.castShadow = true;
  body.add(bodyMesh, glassMesh);

  // Roof panel over the glass so it reads as a car rather than a fishbowl.
  const g = scaled(prof.glass);
  const roofLen = (g[2][0] - g[1][0]) * 0.92;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(prof.width - 0.22, 0.05, roofLen), paint);
  roof.position.set(0, Math.max(g[1][1], g[2][1]) + 0.02, (g[1][0] + g[2][0]) / 2);
  body.add(roof);

  // Livery stripe over hood + roof.
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, (prof.hood[1] - prof.hood[0]) * k), trim);
  const hoodTop = scaled(prof.body).find((p) => p[0] > prof.hood[0] * k)?.[1] ?? 0.86;
  stripe.position.set(0, hoodTop + 0.01, ((prof.hood[0] + prof.hood[1]) / 2) * k);
  stripe.rotation.x = -0.12;
  body.add(stripe);
  const roofStripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, roofLen), trim);
  roofStripe.position.copy(roof.position); roofStripe.position.y += 0.03;
  body.add(roofStripe);

  // Door number roundels.
  if (!ghost) {
    const tex = numberTexture(number, '#111');
    const roundMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    mats.push(roundMat);
    for (const side of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), roundMat);
      r.position.set(side * (prof.width / 2 + 0.006), 0.6, -0.05);
      r.rotation.y = side * Math.PI / 2;
      body.add(r);
    }
  }

  // Lights.
  const front = Math.max(...scaled(prof.body).map((p) => p[0]));
  const rear = Math.min(...scaled(prof.body).map((p) => p[0]));
  for (const side of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.05), lightMat);
    hl.position.set(side * (prof.width / 2 - 0.3), 0.62, front - 0.02);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.05), tailMat);
    tl.position.set(side * (prof.width / 2 - 0.28), 0.7, rear + 0.01);
    body.add(hl, tl);
    // Rally spot lamps on the bumper.
    const spot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 8), lightMat);
    spot.rotation.x = Math.PI / 2;
    spot.position.set(side * 0.28, 0.48, front + 0.04);
    body.add(spot);
  }
  root.userData.tailMat = tailMat;

  // Bumpers / mud flaps.
  const bump = new THREE.Mesh(new THREE.BoxGeometry(prof.width + 0.02, 0.14, 0.12), dark);
  bump.position.set(0, 0.36, front - 0.02);
  const bumpR = bump.clone(); bumpR.position.z = rear + 0.02;
  body.add(bump, bumpR);
  for (const side of [-1, 1]) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.02), dark);
    flap.position.set(side * (spec.track / 2), 0.22, -spec.b - 0.42);
    body.add(flap);
  }

  if (prof.wing) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(prof.width - 0.1, 0.04, 0.32), dark);
    wing.position.set(0, 1.08, rear + 0.25);
    body.add(wing);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.12), dark);
      post.position.set(side * 0.55, 0.97, rear + 0.27);
      body.add(post);
    }
  }
  if (prof.scoop) {
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.6), dark);
    scoop.position.set(0, 0.97, 1.2 * k);
    body.add(scoop);
  }
  if (prof.roofRack) {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(prof.width - 0.4, 0.06, 1.3), dark);
    rack.position.copy(roof.position); rack.position.y += 0.1;
    body.add(rack);
  }

  // Wheels: pivot (steers) -> spinner (rolls) -> tyre + rim.
  const tyreGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 14);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: RIM_COLORS[wheelStyle], roughness: 0.4, metalness: 0.5, flatShading: true });
  mats.push(rimMat);
  const wheels = [];
  const positions = [
    [spec.track / 2, spec.a, true], [-spec.track / 2, spec.a, true],
    [spec.track / 2, -spec.b, false], [-spec.track / 2, -spec.b, false],
  ];
  for (const [x, z, isFront] of positions) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.32, z);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(tyreGeo, dark);
    tyre.castShadow = true;
    spin.add(tyre);
    const rim = buildRim(wheelStyle, rimMat, dark);
    rim.position.x = Math.sign(x) * 0.115;
    spin.add(rim);
    spin.userData.rim = rim;
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin, isFront, side: Math.sign(x) });
  }

  if (ghost) {
    for (const m of mats) { m.transparent = true; m.opacity = 0.35; m.depthWrite = false; }
    root.traverse((o) => { o.castShadow = false; });
  }

  const api = {
    root, body, wheels, paint,
    setColor(c) { paint.color.set(c); },
    setWheelStyle(style) {
      rimMat.color.setHex(RIM_COLORS[style]);
      for (const w of wheels) {
        w.spin.remove(w.spin.userData.rim);
        const rim = buildRim(style, rimMat, dark);
        rim.position.x = w.side * 0.115;
        w.spin.add(rim);
        w.spin.userData.rim = rim;
      }
    },
    // Pose the model from the physics state.
    update(car, dt) {
      root.position.set(car.x, car.y ?? 0, car.z);
      root.rotation.y = car.yaw;
      // Body pitch from longitudinal accel, roll from lateral accel.
      const pitch = THREE.MathUtils.clamp(-car.axSmooth * 0.008, -0.07, 0.07);
      const roll = THREE.MathUtils.clamp(car.aySmooth * 0.009, -0.08, 0.08);
      body.rotation.x = THREE.MathUtils.lerp(body.rotation.x, pitch, Math.min(1, dt * 10));
      body.rotation.z = THREE.MathUtils.lerp(body.rotation.z, roll, Math.min(1, dt * 10));
      body.position.y = 0.02 + Math.sin(performance.now() * 0.03) * 0.004 * Math.min(1, car.speed / 20);
      const roll2 = car.vF / 0.32 * dt;
      for (const w of wheels) {
        if (w.isFront) w.pivot.rotation.y = car.steer;
        // Rear wheels spin faster when the tyres are lit up.
        w.spin.rotation.x += w.isFront ? roll2 : roll2 * (1 + car.wheelSpin * 2);
      }
      tailMat.emissiveIntensity = car.brake > 0.1 ? 2.2 : 0.5;
    },
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      mats.forEach((m) => { m.map?.dispose(); m.dispose(); });
    },
  };
  return api;
}
