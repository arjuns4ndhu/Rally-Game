// Start, sector and finish gantries spanning the road.
import * as THREE from 'three';

function bannerTexture(label, kind) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  if (kind === 'finish') {
    const sq = 24;
    for (let y = 0; y < 96; y += sq) for (let x = 0; x < 512; x += sq) {
      g.fillStyle = ((x + y) / sq) % 2 ? '#f1e9da' : '#111318';
      g.fillRect(x, y, sq, sq);
    }
    g.fillStyle = '#111318';
    g.fillRect(150, 14, 212, 68);
  } else {
    g.fillStyle = kind === 'start' ? '#1f8a4c' : '#ffb000';
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = -96; x < 512; x += 48) { g.beginPath(); g.moveTo(x, 96); g.lineTo(x + 24, 96); g.lineTo(x + 120, 0); g.lineTo(x + 96, 0); g.fill(); }
  }
  g.font = '64px Bungee, Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = kind === 'sector' ? '#0b0d12' : '#f1e9da';
  g.fillText(label, 256, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// kind: 'start' | 'sector' | 'finish'
export function buildGate(road, along, label, kind) {
  const i = road.indexAt(along);
  const g = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1b1e26, flatShading: true });
  const span = road.width + 3;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.6, 0.35), postMat);
    post.position.set(s * span / 2, 2.6, 0);
    post.castShadow = true;
    g.add(post);
  }
  const tex = bannerTexture(label, kind);
  const bannerMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(span + 0.4, span * 96 / 512 + 0.2, 0.25), bannerMat);
  banner.position.y = 5.2;
  banner.castShadow = true;
  g.add(banner);
  // A painted line across the road.
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(road.width, kind === 'sector' ? 0.35 : 0.7),
    new THREE.MeshBasicMaterial({ color: kind === 'finish' ? 0xf1e9da : kind === 'start' ? 0x9fe3b8 : 0xffd27a, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.085;
  g.add(line);
  g.position.set(road.px[i], road.py[i], road.pz[i]);
  g.rotation.y = Math.atan2(road.tx[i], road.tz[i]);
  return g;
}

// Roadside warning board ahead of a jump or crest.
export function buildSign(road, along, text, side = 1) {
  const i = road.indexAt(along);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#ffb000'; g.fillRect(0, 0, 256, 160);
  g.strokeStyle = '#0b0d12'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 150);
  g.fillStyle = '#0b0d12';
  // Ramp pictogram
  g.beginPath(); g.moveTo(40, 70); g.lineTo(150, 70); g.lineTo(150, 30); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(170, 40); g.quadraticCurveTo(205, 5, 225, 55); g.lineWidth = 8; g.stroke();
  g.font = '44px Bungee, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 118);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const grp = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), new THREE.MeshStandardMaterial({ color: 0x2a2c33 }));
  post.position.y = 1.1;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }));
  board.position.y = 2.2;
  post.castShadow = board.castShadow = true;
  grp.add(post, board);
  const off = road.width / 2 + 2.4;
  grp.position.set(road.px[i] + road.tz[i] * off * side, road.py[i], road.pz[i] - road.tx[i] * off * side);
  // Face oncoming traffic.
  grp.rotation.y = Math.atan2(road.tx[i], road.tz[i]) + Math.PI;
  return grp;
}

// ---------- Sharp-corner warnings ----------
// Real-world cues rather than HUD prompts: countdown brake boards on the
// approach, red/white chevrons round the outside, and heavy braking marks
// left by everyone who went before you.

function boardTexture(draw, w = 256, h = 160) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function chevronTexture(dir) {
  return boardTexture((g, w, h) => {
    g.fillStyle = '#c3251f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4f1e8';
    // Two chevrons pointing the way the road turns (dir +1 = left).
    for (let k = 0; k < 2; k++) {
      const cx = w / 2 + (k - 0.5) * 90;
      g.beginPath();
      const p = dir > 0 ? 1 : -1;
      g.moveTo(cx + 30 * p, 22); g.lineTo(cx - 30 * p, h / 2); g.lineTo(cx + 30 * p, h - 22);
      g.lineTo(cx + 58 * p, h - 22); g.lineTo(cx - 2 * p, h / 2); g.lineTo(cx + 58 * p, 22);
      g.closePath(); g.fill();
    }
  });
}

function countdownTexture(stripes) {
  return boardTexture((g, w, h) => {
    g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c3251f';
    const band = h / 7;
    for (let k = 0; k < stripes; k++) {
      const y = h * 0.12 + k * band * 1.9;
      g.beginPath(); g.moveTo(0, y + band); g.lineTo(w, y); g.lineTo(w, y + band); g.lineTo(0, y + band * 2); g.closePath(); g.fill();
    }
    g.strokeStyle = '#1a1b1f'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
  }, 128, 256);
}

// Fading, streaky skid texture: faint far from the corner, heavy near it.
function brakeMarkTexture() {
  return boardTexture((g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const along = 1 - y / h;                               // v=0 at the far end
      const fade = Math.pow(Math.min(1, along * 1.25), 1.6);
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w;
        const edge = Math.min(1, Math.sin(u * Math.PI) * 1.8);
        const streak = 0.55 + 0.45 * Math.sin(x * 1.9 + Math.sin(y * 0.05) * 2);
        const a = edge * fade * streak * (0.75 + Math.random() * 0.25);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
    }
    g.putImageData(img, 0, 0);
  }, 32, 256);
}

function roadsideBoard(road, along, side, tex, bw, bh, yaw, postH = 1.0) {
  const i = road.indexAt(along);
  const grp = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, postH, 0.08), new THREE.MeshStandardMaterial({ color: 0x2a2c33 }));
  post.position.y = postH / 2;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }));
  board.position.y = postH + bh / 2 - 0.1;
  post.castShadow = board.castShadow = true;
  grp.add(post, board);
  const off = road.width / 2 + 2.6;
  grp.position.set(road.px[i] + road.tz[i] * off * side, road.py[i], road.pz[i] - road.tx[i] * off * side);
  grp.rotation.y = yaw;
  return grp;
}

export function buildCornerWarnings(road, corners) {
  const group = new THREE.Group();
  const brakeTex = brakeMarkTexture();
  brakeTex.wrapT = THREE.ClampToEdgeWrapping;
  const brakeMat = new THREE.MeshBasicMaterial({
    map: brakeTex, color: 0x140d08, transparent: true, opacity: 0.85,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5,
  });
  for (const c of corners) {
    const outside = -c.dir;
    const iE = road.indexAt(c.entry);
    const approachYaw = Math.atan2(road.tx[iE], road.tz[iE]) + Math.PI;   // face the incoming driver

    // Countdown brake boards: 3 stripes at 150 m, 2 at 100 m, 1 at 50 m.
    [[150, 3], [100, 2], [50, 1]].forEach(([d, n]) => {
      if (c.entry - d < 20) return;
      const yaw = Math.atan2(road.tx[road.indexAt(c.entry - d)], road.tz[road.indexAt(c.entry - d)]) + Math.PI;
      group.add(roadsideBoard(road, c.entry - d, outside, countdownTexture(n), 0.8, 1.6, yaw, 0.5));
    });

    // Chevrons round the outside of the bend.
    const chev = chevronTexture(c.dir);
    const span = Math.max(12, c.exit - c.entry);
    for (let k = 0; k < 5; k++) {
      const at = c.entry - 4 + (span + 4) * (k / 4);
      group.add(roadsideBoard(road, at, outside, chev, 1.6, 1.0, approachYaw, 0.8));
    }

    // Heavy braking marks along the racing line into the corner.
    const from = road.indexAt(Math.max(0, c.entry - 70)), to = road.indexAt(c.entry + 6);
    const len = road.cum[to] - road.cum[from];
    for (const s of [-1, 1]) {
      group.add(road.buildOffsetStrip((i) => (road.racing ? road.racing[i] : 0) + s * 0.8, 0.5, 0.062, brakeMat, 1 / Math.max(1, len), from, to));
    }
  }
  return group;
}

// ---------- Shortcut markers ----------
// A green advance board ("SHORTCUT" with a bent arrow), an arrow board and
// flags at the mouth of the track, and marker posts lining it.
function shortcutTexture(dir, text) {
  return boardTexture((g, w, h) => {
    g.fillStyle = '#1f9e5a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f4f1e8'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
    g.save();
    g.translate(w / 2, 62);
    g.scale(dir, 1);
    g.strokeStyle = '#f4f1e8'; g.fillStyle = '#f4f1e8'; g.lineWidth = 12; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-40, 34); g.lineTo(-40, 0); g.quadraticCurveTo(-40, -22, -10, -22); g.lineTo(26, -22); g.stroke();
    g.beginPath(); g.moveTo(52, -22); g.lineTo(22, -44); g.lineTo(22, 0); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#f4f1e8';
    g.font = '30px Bungee, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, 128);
  });
}

function signPost(tex, width = 1.6, height = 1.0, postH = 2.2) {
  const grp = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, postH, 0.12), new THREE.MeshStandardMaterial({ color: 0x2a2c33 }));
  post.position.y = postH / 2;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, emissive: 0x0d3a22, emissiveIntensity: 0.4 }));
  board.position.y = postH;
  post.castShadow = board.castShadow = true;
  grp.add(post, board);
  return grp;
}

export function buildShortcutMarkers(road, sc) {
  const grp = new THREE.Group();
  // Which end you reach first, and which side of the road the track leaves on.
  const qa = road.nearest(sc.px[0], sc.pz[0], -1), aStart = qa.along;
  const qb = road.nearest(sc.px[sc.n - 1], sc.pz[sc.n - 1], -1), aEnd = qb.along;
  const fwd = aStart < aEnd;
  const k0 = fwd ? 0 : sc.n - 1, kIn = fwd ? Math.min(sc.n - 1, 6) : Math.max(0, sc.n - 7);
  const entryAlong = Math.min(aStart, aEnd);
  const qi = road.nearest(sc.px[kIn], sc.pz[kIn], -1);
  const side = qi.lateral >= 0 ? 1 : -1;          // +1 = left of the road
  const dir = side > 0 ? -1 : 1;                  // arrow bends left or right on the board
  const place = (obj, along, lat) => {
    const i = road.indexAt(Math.max(0, along));
    obj.position.set(road.px[i] + road.tz[i] * lat, road.py[i], road.pz[i] - road.tx[i] * lat);
    obj.rotation.y = Math.atan2(road.tx[i], road.tz[i]) + Math.PI;   // face oncoming cars
    return obj;
  };
  // Advance warning and the board at the turn-off.
  const edge = side * (road.width / 2 + 2.4);
  grp.add(place(signPost(shortcutTexture(dir, 'SHORTCUT'), 2.3, 1.45, 2.6), entryAlong - 70, edge));
  grp.add(place(signPost(shortcutTexture(dir, 'SHORTCUT'), 2.3, 1.45, 2.6), entryAlong - 25, edge));
  const at = signPost(shortcutTexture(dir, 'THIS WAY'), 2.0, 1.25, 2.0);
  grp.add(place(at, entryAlong + 6, side * (road.width / 2 + 5)));
  // Flags either side of the mouth of the track.
  const flagMat = new THREE.MeshStandardMaterial({ color: 0x2bd47a, emissive: 0x0f5a32, emissiveIntensity: 0.5, side: THREE.DoubleSide });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d8 });
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.06, 4.2, 5);
  const flagGeo = new THREE.PlaneGeometry(1.4, 0.85);
  const tx = sc.px[kIn] - sc.px[k0], tz = sc.pz[kIn] - sc.pz[k0], tl = Math.hypot(tx, tz) || 1;
  const nx = tz / tl, nz = -tx / tl;
  for (const s of [-1, 1]) {
    const k = fwd ? 2 : sc.n - 3;
    const x = sc.px[k] + nx * s * (sc.width / 2 + 0.6), z = sc.pz[k] + nz * s * (sc.width / 2 + 0.6);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, sc.py[k] + 2.1, z);
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(x, sc.py[k] + 3.75, z);
    flag.rotation.y = Math.atan2(tx, tz) + Math.PI / 2;
    flag.translateX(0.7);
    grp.add(pole, flag);
  }
  // Marker posts down both sides of the track: white with a green reflector.
  const postGeo = new THREE.BoxGeometry(0.1, 0.9, 0.1), capGeo = new THREE.BoxGeometry(0.12, 0.18, 0.12);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x2bd47a, emissive: 0x2bd47a, emissiveIntensity: 0.6 });
  for (let k = 6; k < sc.n - 6; k += 6) {
    const k1 = Math.min(sc.n - 1, k + 1);
    const dx = sc.px[k1] - sc.px[k], dz = sc.pz[k1] - sc.pz[k], dl = Math.hypot(dx, dz) || 1;
    for (const s of [-1, 1]) {
      const x = sc.px[k] + (dz / dl) * s * (sc.width / 2 + 0.5), z = sc.pz[k] - (dx / dl) * s * (sc.width / 2 + 0.5);
      // Skip posts standing on the main road.
      if (road.nearest(x, z, -1).dist < road.width / 2 + 0.8) continue;
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(x, sc.py[k] + 0.45, z);
      const c = new THREE.Mesh(capGeo, capMat);
      c.position.set(x, sc.py[k] + 0.85, z);
      grp.add(p, c);
    }
  }
  return grp;
}
