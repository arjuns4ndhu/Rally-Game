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
  line.position.y = 0.06;
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
