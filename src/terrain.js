// Low-poly terrain heightfield that hugs the road: flat in a corridor around
// it, blending out into the seeded landform and rolling hills further away.
import * as THREE from 'three';
import { makeBaseHeight, makeHillHeight } from './stagegen.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildTerrain(road, { seed = 1, flat = false, grassMap = null, baseAmp = 1, hillAmp = 1, theme = null } = {}) {
  // Must match the road's landform exactly (same seed and amplitude).
  const base = flat ? () => 0 : makeBaseHeight(seed, baseAmp);
  const hills = makeHillHeight(seed, hillAmp);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < road.n; i++) {
    minX = Math.min(minX, road.px[i]); maxX = Math.max(maxX, road.px[i]);
    minZ = Math.min(minZ, road.pz[i]); maxZ = Math.max(maxZ, road.pz[i]);
  }
  const margin = 420;
  minX -= margin; maxX += margin; minZ -= margin; maxZ += margin;
  let cell = 8;
  while ((maxX - minX) / cell > 260 || (maxZ - minZ) / cell > 260) cell += 2;
  const nx = Math.ceil((maxX - minX) / cell) + 1, nz = Math.ceil((maxZ - minZ) / cell) + 1;

  // Spatial hash of road samples for nearest-distance lookups.
  const RC = 32;
  const rgrid = new Map();
  for (let i = 0; i < road.n; i++) {
    const k = `${Math.floor(road.px[i] / RC)},${Math.floor(road.pz[i] / RC)}`;
    if (!rgrid.has(k)) rgrid.set(k, []);
    rgrid.get(k).push(i);
  }
  const nearestRoad = (x, z) => {
    const cx = Math.floor(x / RC), cz = Math.floor(z / RC);
    let best = -1, bd = Infinity;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const list = rgrid.get(`${cx + dx},${cz + dz}`);
      if (!list) continue;
      for (const i of list) {
        const d = (road.px[i] - x) ** 2 + (road.pz[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best < 0 ? null : { i: best, d: Math.sqrt(bd) };
  };

  const flatZone = road.width / 2 + 4;
  const heightRaw = (x, z) => {
    const nr = nearestRoad(x, z);
    const far = base(x, z) + hills(x, z) * smooth(25, 200, nr ? nr.d : 999);
    if (!nr) return far;
    const s = smooth(flatZone, flatZone + 40, nr.d);
    return (road.py[nr.i] - 0.6) * (1 - s) + far * s;
  };

  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    H[j * nx + i] = heightRaw(minX + i * cell, minZ + j * cell);
  }

  // Bilinear sample of the grid (matches the mesh closely).
  const heightAt = (x, z) => {
    const fx = (x - minX) / cell, fz = (z - minZ) / cell;
    const i = Math.max(0, Math.min(nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
    const a = H[j * nx + i], b = H[j * nx + i + 1], c = H[(j + 1) * nx + i], d = H[(j + 1) * nx + i + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };

  // Mesh
  const geo = new THREE.PlaneGeometry((nx - 1) * cell, (nz - 1) * cell, nx - 1, nz - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  let minH = Infinity, maxH = -Infinity, sumH = 0;
  for (let k = 0; k < H.length; k++) { minH = Math.min(minH, H[k]); maxH = Math.max(maxH, H[k]); }
  let roadMin = Infinity, roadMax = -Infinity;
  for (let k = 0; k < road.n; k++) { roadMin = Math.min(roadMin, road.py[k]); roadMax = Math.max(roadMax, road.py[k]); }
  const g = theme ? theme.ground : { base: '#4a5726', tintLow: [0.92, 0.95, 0.85], tintHigh: [1.1, 1.03, 0.75], rock: [0.55, 0.52, 0.48] };
  const groundCol = new THREE.Color(g.base);
  const rockCol = new THREE.Color().setRGB(...g.rock, THREE.SRGBColorSpace);
  const snowCol = new THREE.Color('#f2f5f8');
  const c = new THREE.Color();
  for (let v = 0; v < pos.count; v++) {
    // PlaneGeometry (after rotateX) runs -x..x, -z..z in row-major order from -z.
    const i = v % nx, j = Math.floor(v / nx);
    const h = H[j * nx + i];
    pos.setXYZ(v, minX + i * cell, h, minZ + j * cell);
    sumH += h;
    // Height tint: low ground one shade, high ground another.
    const t = Math.max(0, Math.min(1, (h - roadMin + 10) / (60 + (roadMax - roadMin))));
    const n = (Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1;
    c.copy(groundCol);
    c.r *= g.tintLow[0] + (g.tintHigh[0] - g.tintLow[0]) * t + n * 0.04;
    c.g *= g.tintLow[1] + (g.tintHigh[1] - g.tintLow[1]) * t + n * 0.04;
    c.b *= g.tintLow[2] + (g.tintHigh[2] - g.tintLow[2]) * t + n * 0.04;
    // Steep slopes show bare rock.
    const hx = H[j * nx + Math.min(nx - 1, i + 1)] - H[j * nx + Math.max(0, i - 1)];
    const hz = H[Math.min(nz - 1, j + 1) * nx + i] - H[Math.max(0, j - 1) * nx + i];
    const slope = Math.hypot(hx, hz) / (2 * cell);
    c.lerp(rockCol, smooth(0.35, 0.8, slope));
    // High alpine ground gets a snow cap.
    if (theme?.peaks) c.lerp(snowCol, smooth(roadMax + 25, roadMax + 55, h) * (1 - smooth(0.6, 1.0, slope) * 0.6));
    col.set([c.r, c.g, c.b], v * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  if (grassMap) grassMap.repeat.set((nx - 1) * cell / 18, (nz - 1) * cell / 18);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: grassMap, vertexColors: true, flatShading: true, roughness: 1, color: 0xffffff,
  }));
  mesh.receiveShadow = true;

  return {
    mesh, heightAt, nearestRoad,
    bounds: { minX, maxX, minZ, maxZ },
    minH, maxH, meanH: sumH / pos.count,
  };
}
