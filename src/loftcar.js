// Car bodies lofted from cross-sections along the car, for shapes an
// extruded side profile can't make: narrow cabins on wide haunches,
// fender humps above a low bonnet, wraparound screens, tapered noses.
// Each car is a set of curves over z (metres, +z forward, 0 = mid-car).
import * as THREE from 'three';

const lerp = (a, b, t) => a + (b - a) * t;

// Piecewise-linear curve through [z, value] keys (sorted by z).
function curve(keys) {
  return (z) => {
    if (z <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (z <= keys[i][0]) {
        const [z0, v0] = keys[i - 1], [z1, v1] = keys[i];
        return lerp(v0, v1, (z - z0) / ((z1 - z0) || 1));
      }
    }
    return keys[keys.length - 1][1];
  };
}
const inRange = (z, [a, b]) => z >= a && z <= b;

// Real-car references are only for proportions; liveries are generic stripes
// (no names, badges or sponsor marks).
export const LOFTS = {
  // 70s mid-engined wedge: 3.71 m long, 1.75 m wide, 1.11 m tall.
  stratos: {
    length: 3.71,
    bottom: [[-1.855, 0.34], [-1.6, 0.24], [1.5, 0.22], [1.855, 0.27]],
    halfWidth: [[-1.855, 0.8], [-1.72, 0.86], [-1.0, 0.88], [-0.45, 0.865], [0.2, 0.835], [0.8, 0.85], [1.18, 0.86], [1.55, 0.82], [1.75, 0.72], [1.855, 0.56]],
    belt: [[-1.855, 0.9], [-1.79, 0.9], [-1.62, 0.85], [-1.0, 0.87], [-0.6, 0.83], [-0.25, 0.77], [0.5, 0.76], [0.95, 0.79], [1.3, 0.78], [1.6, 0.7], [1.78, 0.6], [1.855, 0.5]],
    top: [[-1.855, 0.95], [-1.8, 0.94], [-1.66, 0.865], [-1.5, 0.86], [-0.8, 0.89], [-0.74, 0.98], [-0.64, 1.09], [-0.55, 1.11], [-0.05, 1.115], [0.2, 1.03], [0.5, 0.85], [0.77, 0.71], [1.2, 0.645], [1.6, 0.56], [1.78, 0.49], [1.855, 0.44]],
    cabinWidth: [[-1.855, 0.5], [-0.8, 0.56], [-0.72, 0.6], [-0.55, 0.62], [-0.05, 0.64], [0.5, 0.72], [0.77, 0.76], [0.87, 0.56], [1.855, 0.32]],
    cabin: [[-0.8, 0], [-0.72, 1], [0.77, 1], [0.85, 0]],
    // (the top and belt keys at the very back form the ducktail lip)
    glass: { screen: [-0.05, 0.79], side: [-0.55, -0.05], rear: [-0.74, -0.55] },
    accents: [0x1d7f3f, 0xd0282c],      // green, red
    // Livery: a green band with a red pinstripe sweeping up the side from
    // the front wheel to the roof, a chevron on the bonnet, a green roof and
    // stripes along the louvred engine cover.
    livery(part, x, y, z) {
      const ax = Math.abs(x);
      if (part === 'side') {
        const L = 0.34 + (1.3 - z) * 0.3;
        if (z < -0.62) return null;
        if (y > L - 0.2 && y < L) return 1;
        if (y >= L && y < L + 0.05) return 2;
        return null;
      }
      if (part === 'top') {
        if (z > 0.86) {
          const d = ax - (z - 0.86) * 0.62;
          if (d < -0.07) return 1;
          if (d < 0.0) return 2;
          return null;
        }
        if (z > -0.6 && z < -0.02) return 1;
        if (z < -0.8) return ax < 0.18 ? null : ax < 0.36 ? 1 : ax < 0.46 ? 2 : null;
      }
      return null;
    },
  },
  // 60s mini: 3.05 m long, 1.41 m wide, 1.35 m tall, wheels right out at
  // the corners, tall glasshouse, flat bonnet and boot.
  mini: {
    length: 3.05,
    zRange: [-1.71, 1.34],
    bottom: [[-1.71, 0.34], [-1.6, 0.24], [1.2, 0.22], [1.34, 0.32]],
    halfWidth: [[-1.71, 0.62], [-1.64, 0.68], [-1.5, 0.7], [1.1, 0.705], [1.26, 0.68], [1.34, 0.62]],
    belt: [[-1.71, 0.8], [-1.62, 0.85], [-1.45, 0.87], [0.5, 0.88], [0.7, 0.87], [1.2, 0.81], [1.34, 0.76]],
    top: [[-1.71, 0.82], [-1.55, 0.86], [-1.46, 0.89], [-1.34, 1.29], [-1.22, 1.33], [-0.4, 1.345], [0.15, 1.33], [0.27, 1.29], [0.6, 0.91], [0.68, 0.89], [1.2, 0.83], [1.34, 0.77]],
    cabinWidth: [[-1.71, 0.52], [-1.52, 0.6], [-1.44, 0.665], [0.6, 0.665], [0.7, 0.6], [1.34, 0.5]],
    cabin: [[-1.52, 0], [-1.44, 1], [0.62, 1], [0.7, 0]],
    glass: { screen: [0.26, 0.64], side: [-1.32, 0.26], rear: [-1.46, -1.32] },
    defaultSkin: 'rally',
    skins: {
      // Works rally car: contrast roof, white door panels for the numbers.
      rally: {
        name: 'Rally', paint: '#c4161c', accents: [0xf1ede2],
        livery(part, x, y, z) {
          if (part === 'top' && z > -1.32 && z < 0.27) return 1;
          if (part === 'side' && z > -0.3 && z < 0.28 && y > 0.42 && y < 0.8) return 1;
          return null;
        },
      },
      // Lime green with a black bonnet... and an armchair strapped to the roof.
      armchair: {
        name: 'Armchair', paint: '#a3c13a', accents: [0x17181b],
        livery(part, x, y, z) { return part === 'top' && z > 0.68 ? 1 : null; },
      },
    },
  },
};

// Points of one half cross-section at z, from the bottom centre out, up the
// side and over the top to the top centre. Always the same count, so rings
// join up. Over a wheel the bottom steps up into a real wheel well.
const SEG = { under: 0, wellWall: 1, wellRoof: 2, rocker: 3, side0: 4, side1: 7, shoulder: 8, sill: 9, top0: 10, top1: 12 };
function section(d, z, wells) {
  const hs = d.halfWidth(z), belt = d.belt(z), top = d.top(z), c = d.cabin(z), yb = d.bottom(z);
  const cw = Math.min(d.cabinWidth(z), hs - 0.06);
  let yw = yb;
  for (const w of wells.list) {
    const dz = z - w.z;
    if (Math.abs(dz) < w.r) yw = Math.max(yw, w.y + Math.sqrt(w.r * w.r - dz * dz));
  }
  const sideTop = belt - 0.07;
  const sideLow = Math.min(yw + 0.05, sideTop - 0.04);
  const mid = lerp(top + 0.03, belt + 0.03, c);
  return [
    [0, yb], [wells.xin, yb], [wells.xin, yw], [hs - 0.03, yw], [hs, sideLow],
    [hs, lerp(sideLow, sideTop, 0.25)], [hs, lerp(sideLow, sideTop, 0.5)], [hs, lerp(sideLow, sideTop, 0.75)],
    [hs, sideTop], [hs - 0.05, belt], [cw, mid],
    [lerp(cw * 0.72, cw - 0.09, c), lerp(top + 0.012, top - 0.05, c)],
    [cw * lerp(0.36, 0.5, c), lerp(top + 0.004, top - 0.012, c)],
    [0, top],
  ];
}

// Builds { bodyMesh, glassMesh, curves } for a lofted car. `wells` gives the
// wheel centres (z), the arch radius and the inner face of the wells (x).
export function buildLoftBody(def, { paint, glass, dark, accents, livery = def.livery, wheelZ, wheelY, archR, wellX }) {
  const d = {
    bottom: curve(def.bottom), halfWidth: curve(def.halfWidth), belt: curve(def.belt), top: curve(def.top),
    cabinWidth: curve(def.cabinWidth), cabin: curve(def.cabin),
  };
  const wells = { list: wheelZ.map((z) => ({ z, y: wheelY, r: archR })), xin: wellX };
  // Body from tail to nose (wheels needn't be centred under it).
  const [zr, zf] = def.zRange || [-def.length / 2, def.length / 2];
  // Ring positions: every 8 cm, plus the arch edges so the wells are crisp.
  const zs = new Set();
  for (let z = zr; z < zf; z += 0.08) zs.add(+z.toFixed(4));
  zs.add(zf);
  for (const w of wells.list) for (const e of [-1, 1]) zs.add(+(w.z + e * w.r * 0.999).toFixed(4));
  const rings = [...zs].sort((a, b) => a - b).map((z) => ({ z, pts: section(d, z, wells) }));

  // Triangles sorted by material.
  const buckets = { paint: [], dark: [], glass: [], a1: [], a2: [], a3: [] };
  const tri = (key, a, b, c, out) => {
    // Wind each triangle to face outwards (reference: away from the car's core).
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    const ref = out || [cx, cy - 0.55, 0];
    const flip = nx * ref[0] + ny * ref[1] + nz * ref[2] < 0;
    buckets[key].push(...a, ...(flip ? c : b), ...(flip ? b : c));
  };
  const partOf = (s) => (s <= SEG.wellRoof ? 'under' : s === SEG.rocker ? 'rocker' : s <= SEG.shoulder ? 'side' : 'top');
  for (let j = 0; j < rings.length - 1; j++) {
    const r0 = rings[j], r1 = rings[j + 1], zc = (r0.z + r1.z) / 2;
    const c = d.cabin(zc);
    for (let s = 0; s < r0.pts.length - 1; s++) {
      for (const side of [1, -1]) {
        const A = [r0.pts[s][0] * side, r0.pts[s][1], r0.z], B = [r0.pts[s + 1][0] * side, r0.pts[s + 1][1], r0.z];
        const C = [r1.pts[s + 1][0] * side, r1.pts[s + 1][1], r1.z], D = [r1.pts[s][0] * side, r1.pts[s][1], r1.z];
        const xc = (A[0] + B[0] + C[0] + D[0]) / 4, yc = (A[1] + B[1] + C[1] + D[1]) / 4;
        const part = partOf(s);
        let key = 'paint';
        if (part === 'under') key = 'dark';
        else if (s >= SEG.top0 && c > 0.5 && (inRange(zc, def.glass.screen) || inRange(zc, def.glass.rear) ||
          (inRange(zc, def.glass.side) && s === SEG.top0))) key = 'glass';
        if (key === 'paint' && livery) {
          const acc = livery(part === 'rocker' ? 'side' : part, xc, yc, zc);
          if (acc) key = acc === 1 ? 'a1' : acc === 2 ? 'a2' : 'a3';
        }
        tri(key, A, B, C);
        tri(key, A, C, D);
      }
    }
  }
  // End caps: fan from the middle of each end ring.
  for (const [ring, dir] of [[rings[0], -1], [rings[rings.length - 1], 1]]) {
    const right = ring.pts.map(([x, y]) => [x, y, ring.z]);
    const left = ring.pts.slice(1, -1).reverse().map(([x, y]) => [-x, y, ring.z]);
    const poly = [...right, ...left];
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const ctr = [0, cy, ring.z];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      tri('paint', ctr, a, b, [0, 0, dir]);
    }
  }

  const make = (keys, mats) => {
    const all = [], groups = [];
    keys.forEach((k, i) => {
      const arr = buckets[k];
      if (!arr.length) return;
      groups.push([all.length / 3, arr.length / 3, i]);
      for (let q = 0; q < arr.length; q++) all.push(arr[q]);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));
    for (const [start, count, mi] of groups) geo.addGroup(start, count, mi);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mats);
  };
  const darkDS = dark.clone(); darkDS.side = THREE.DoubleSide;
  const bodyMesh = make(['paint', 'dark', 'a1', 'a2', 'a3'], [paint, darkDS, accents[0], accents[1], accents[2] || accents[0]]);
  const glassMesh = make(['glass'], [glass]);
  bodyMesh.castShadow = glassMesh.castShadow = true;
  return { bodyMesh, glassMesh, curves: d, extraMats: [darkDS] };
}
