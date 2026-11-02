// Low-poly terrain heightfield that hugs the road: flat in a corridor around
// it, blending out into the seeded landform and rolling hills further away.
import * as THREE from 'three';
import { makeBaseHeight, makeHillHeight } from './stagegen.js';
import { facet, RETRO, steady } from './retro.js';

const FIELDS = ['#6c9a3e', '#7fa84a', '#5b8a36', '#b9aa5c', '#8db357', '#a59a4e'].map((c) => new THREE.Color(c));
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildTerrain(road, { seed = 1, flat = false, grassMap = null, baseAmp = 1, hillAmp = 1, theme = null, carve = null } = {}) {
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
  const reach = theme?.cliff ? 4 : 2;      // cliffs look further for their road
  const nearestRoad = (x, z) => {
    const cx = Math.floor(x / RC), cz = Math.floor(z / RC);
    let best = -1, bd = Infinity;
    for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) {
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
  // A little random lumpiness on each grid point away from the road, so
  // the ground breaks up into visible triangles (retro look).
  const lumpK = RETRO.on ? 1 : 0;
  const lump = (x, z) => lumpK * ((Math.abs(Math.sin(x * 0.3711 + z * 1.913) * 43758.5453) % 1) - 0.5) * 1.8;
  // Mountain-edge stages: the whole landscape tilts towards the sea along
  // one direction (U). Wherever the road's left points uphill, ground on
  // the left climbs as a rock face and ground on the right drops away to
  // the sea, and the other way round. sg[i] says which (smoothed along the
  // road, so the sides swap gently where the road turns across the slope).
  let cliffH = null, seaY = null, sgArr = null;
  if (theme?.cliff) {
    const ang = ((seed * 2654435761) >>> 0) / 4294967296 * Math.PI * 2, ux = Math.cos(ang), uz = Math.sin(ang);
    const raw = new Float32Array(road.n), sg = new Float32Array(road.n);
    for (let i = 0; i < road.n; i++) raw[i] = Math.max(-1, Math.min(1, (road.tz[i] * ux - road.tx[i] * uz) * 1.6));
    for (let i = 0; i < road.n; i++) {
      let t = 0, c = 0;
      for (let k = -20; k <= 20; k++) { const j = i + k; if (j >= 0 && j < road.n) { t += raw[j]; c++; } }
      sg[i] = t / c;
    }
    sgArr = sg;
    let rmin = Infinity, rsum = 0, cxm = 0, czm = 0;
    for (let i = 0; i < road.n; i++) { rmin = Math.min(rmin, road.py[i]); rsum += road.py[i]; cxm += road.px[i]; czm += road.pz[i]; }
    seaY = rmin - 45;
    const rmean = rsum / road.n; cxm /= road.n; czm /= road.n;
    // Far away: one big slope down to the sea.
    const plane = (x, z) => Math.max(seaY - 8, Math.min(rmean + 140, rmean + ((x - cxm) * ux + (z - czm) * uz) * 0.55));
    cliffH = (x, z) => {
      const nr = nearestRoad(x, z);
      if (!nr) return plane(x, z);
      const i = nr.i, lat = (x - road.px[i]) * road.tz[i] - (z - road.pz[i]) * road.tx[i];
      // The rise starts a whole grid cell out from the barriers, so no ground
      // triangle can reach from road level up the slope across the road.
      const ry = road.py[i] - 0.6, edge = road.width / 2 + 2.2 + cell, k = Math.abs(sg[i]);
      if (Math.abs(lat) < edge) return ry;
      const d = Math.abs(lat) - edge, up = lat * sg[i] > 0;
      const near = up ? Math.min(ry + 120, ry + d * (0.3 + 1.25 * k) + lump(x, z) * 2) : Math.max(seaY - 8, ry - d * (0.3 + 1.6 * k));
      return near + (plane(x, z) - near) * smooth(90, 125, nr.d);
    };
  }
  // carve(x, z, h): a stage feature (a harbour basin) can lower the ground.
  const heightRaw = (x, z) => (carve ? carve(x, z, heightRaw0(x, z)) : heightRaw0(x, z));
  const heightRaw0 = (x, z) => {
    if (cliffH) return cliffH(x, z);
    const nr = nearestRoad(x, z);
    const far = base(x, z) + hills(x, z) * smooth(25, 200, nr ? nr.d : 999) + lump(x, z) * smooth(flatZone + 8, flatZone + 40, nr ? nr.d : 999);
    if (!nr) return far;
    const s = smooth(flatZone, flatZone + 40, nr.d);
    return (road.py[nr.i] - 0.6) * (1 - s) + far * s;
  };

  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    H[j * nx + i] = heightRaw(minX + i * cell, minZ + j * cell);
  }

  // Height on the mesh's own triangles (PlaneGeometry splits each cell
  // along the (i+1, j) - (i, j+1) diagonal), so things placed on the ground
  // sit exactly on what you see, even on steep slopes.
  const heightAt = (x, z) => {
    const fx = (x - minX) / cell, fz = (z - minZ) / cell;
    const i = Math.max(0, Math.min(nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
    const A = H[j * nx + i], D = H[j * nx + i + 1], B = H[(j + 1) * nx + i], C = H[(j + 1) * nx + i + 1];
    if (tx + tz <= 1) return A + (D - A) * tx + (B - A) * tz;
    return C + (B - C) * (1 - tx) + (D - C) * (1 - tz);
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
    // Country: a patchwork of fields, each its own green (or a wheat field).
    if (theme?.patchwork) {
      const px = minX + i * cell, pz = minZ + j * cell, ca = 0.94, sa = 0.34;
      const fx = Math.floor((px * ca - pz * sa) / 64), fz = Math.floor((px * sa + pz * ca) / 48);
      const hsh = Math.abs(Math.sin(fx * 127.1 + fz * 311.7) * 43758.5453) % 1;
      c.lerp(FIELDS[Math.floor(hsh * FIELDS.length)], 0.6);
    }
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
  // Flat-coloured triangles, each a slightly different shade, no texture.
  if (!RETRO.on) geo.computeVertexNormals();
  if (grassMap) grassMap.repeat.set((nx - 1) * cell / 18, (nz - 1) * cell / 18);
  const mesh = new THREE.Mesh(facet(geo, 0.15), steady(new THREE.MeshStandardMaterial({
    map: RETRO.on ? null : grassMap, vertexColors: true, flatShading: true, roughness: 1, color: 0xffffff,
  })));
  mesh.receiveShadow = true;

  return {
    mesh, heightAt, nearestRoad, seaY,
    cliffSide: (i) => (sgArr ? sgArr[i] : 0),      // + : ground rises on the road's left
    bounds: { minX, maxX, minZ, maxZ },
    minH, maxH, meanH: sumH / pos.count,
  };
}
