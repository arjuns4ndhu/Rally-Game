// Surface variety along a stage: sealed tarmac sections, mud patches and
// puddles (ice on snow stages, soft sand on canyon stages). Seeded, so a
// stage is the same every attempt; rain brings more mud and puddles.
import * as THREE from 'three';
import { RETRO } from './retro.js';
import { mulberry32 } from './rng.js';

export const PATCH = {
  tarmac: { name: 'tarmac', grip: 1.14, drag: 0.0, dust: [0.45, 0.45, 0.45], dustK: 0.15 },
  mud: { name: 'mud', grip: 0.72, drag: 0.14, dust: [0.32, 0.24, 0.16], dustK: 1.4 },
  puddle: { name: 'puddle', grip: 0.8, drag: 0.22, dust: [0.75, 0.8, 0.85], dustK: 1.6, splash: true },
  ice: { name: 'ice', grip: 0.55, drag: 0.0, dust: [0.95, 0.97, 1.0], dustK: 0.3 },
  sand: { name: 'sand', grip: 0.82, drag: 0.2, dust: [0.92, 0.75, 0.5], dustK: 1.8 },
};

export function planSurfaces(road, seed, { start, finish, theme, weather }) {
  const r = mulberry32(((seed * 40503) ^ 0x1b873593) >>> 0);
  const span = finish - start;
  const plan = { tarmac: [], patches: [] };
  // Sealed sections: 0-2 of them, 140-320 m long.
  const nT = r() < 0.45 ? (r() < 0.35 ? 2 : 1) : 0;
  for (let k = 0; k < nT; k++) {
    const len = 140 + r() * 180;
    const from = start + 80 + r() * Math.max(1, span - len - 160);
    if (plan.tarmac.some((t) => from < t.to + 60 && from + len > t.from - 60)) continue;
    plan.tarmac.push({ from, to: from + len });
  }
  const wet = weather?.wet;
  const kinds = theme.id === 'snow' ? ['ice', 'ice'] : theme.id === 'desert' ? ['sand', 'sand'] : ['mud', 'puddle'];
  const nP = Math.round((3 + r() * 5) * (wet ? 1.8 : 1));
  for (let k = 0; k < nP; k++) {
    const at = start + 40 + r() * (span - 80);
    if (plan.tarmac.some((t) => at > t.from - 8 && at < t.to + 8)) continue;
    let kind = kinds[r() < (wet ? 0.6 : 0.4) ? 1 : 0];
    if (theme.id !== 'snow' && theme.id !== 'desert' && !wet && kind === 'puddle' && r() < 0.5) kind = 'mud';
    const rad = kind === 'puddle' ? 1.2 + r() * 1.3 : 1.8 + r() * 2.2;
    const lat = (r() - 0.5) * (road.width - rad);
    plan.patches.push({ kind, at, lat, r: rad });
  }
  return plan;
}

// Surface at a road position, or null for the normal gravel.
export function patchAt(plan, along, lat) {
  if (!plan) return null;
  for (const t of plan.tarmac) if (along >= t.from && along <= t.to) return PATCH.tarmac;
  for (const p of plan.patches) {
    const da = (along - p.at) / (p.r * 1.7), dl = (lat - p.lat) / p.r;
    if (da * da + dl * dl < 1) return PATCH[p.kind];
  }
  return null;
}

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (RETRO.on) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; }   // blocky, retro
  else t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function asphaltTexture() {
  return canvasTex(RETRO.on ? 64 : 256, RETRO.on ? 64 : 256, (g, w, h) => {
    g.fillStyle = '#3d3f42'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const l = 40 + Math.random() * 60;
      g.fillStyle = `rgba(${l},${l},${l + 4},${Math.random() * 0.6})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // Worn edges with gravel dragged on, and a faded centre line.
    const edge = g.createLinearGradient(0, 0, w, 0);
    edge.addColorStop(0, 'rgba(150,130,100,0.55)'); edge.addColorStop(0.1, 'rgba(150,130,100,0)');
    edge.addColorStop(0.9, 'rgba(150,130,100,0)'); edge.addColorStop(1, 'rgba(150,130,100,0.55)');
    g.fillStyle = edge; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(235,230,215,0.55)';
    g.fillRect(w / 2 - 3, 0, 6, h * 0.45);
  });
}

function patchTexture(kind) {
  const col = { mud: [70, 52, 34], puddle: [150, 165, 180], ice: [205, 225, 240], sand: [214, 170, 110] }[kind];
  return canvasTex(RETRO.on ? 32 : 128, RETRO.on ? 32 : 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    const a = kind === 'puddle' ? 0.85 : 0.8;
    grd.addColorStop(0, `rgba(${col},${a})`);
    grd.addColorStop(0.65, `rgba(${col},${a * 0.85})`);
    grd.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    if (kind === 'puddle') {
      g.strokeStyle = 'rgba(220,235,250,0.35)'; g.lineWidth = 2;
      for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(w / 2, h / 2, 12 + i * 9, 10 + i * 8, 0, 0, Math.PI * 2); g.stroke(); }
    }
    for (let i = 0; i < 300; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      if ((x - w / 2) ** 2 + (y - h / 2) ** 2 > (w / 2.3) ** 2) continue;
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`;
      g.fillRect(x, y, 2, 2);
    }
  }, false);
}

export function buildSurfaces(road, plan) {
  const grp = new THREE.Group();
  if (plan.tarmac.length) {
    const mat = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -1 });
    for (const t of plan.tarmac) {
      const from = road.indexAt(t.from), to = road.indexAt(t.to) + 1;
      grp.add(road.buildOffsetStrip(() => 0, road.width + 0.2, 0.04, mat, 1 / 12, from, to));
    }
  }
  const mats = {};
  for (const p of plan.patches) {
    if (!mats[p.kind]) {
      mats[p.kind] = new THREE.MeshStandardMaterial({
        map: patchTexture(p.kind), transparent: true, depthWrite: false,
        roughness: p.kind === 'puddle' || p.kind === 'ice' ? 0.2 : 0.95,
        // Puddles pick up a little sky light so they read as water, not holes.
        emissive: p.kind === 'puddle' ? 0x3a4654 : 0x000000, emissiveIntensity: 0.6,
      });
    }
    const len = p.r * 1.7 * 2;
    const from = road.indexAt(p.at - len / 2), to = road.indexAt(p.at + len / 2) + 1;
    grp.add(road.buildOffsetStrip(() => p.lat, p.r * 2, 0.045, mats[p.kind], 1 / len, from, to));
  }
  return grp;
}
