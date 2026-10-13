// Retro look helpers: every triangle gets its own flat shade so the world
// reads as chunky triangles, and textures are sampled blocky (no smoothing
// up close).
import * as THREE from 'three';

// Non-indexed copy of `geo` with a per-triangle colour. Existing vertex
// colours are averaged per face; otherwise the shade is grey around 1.
// `amount` is the +/- brightness spread between neighbouring faces.
export function facet(geo, amount = 0.12, salt = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position.array, n = g.attributes.position.count;
  const old = g.attributes.color;
  const col = new Float32Array(n * 3);
  for (let t = 0; t < n; t += 3) {
    const i = t * 3;
    const cx = pos[i] + pos[i + 3] + pos[i + 6], cy = pos[i + 1] + pos[i + 4] + pos[i + 7], cz = pos[i + 2] + pos[i + 5] + pos[i + 8];
    const h = Math.abs(Math.sin(cx * 12.9898 + cy * 78.233 + cz * 37.719 + salt) * 43758.5453) % 1;
    const s = 1 - amount + h * amount * 2;
    let r = 1, gg = 1, b = 1;
    if (old) {
      r = (old.getX(t) + old.getX(t + 1) + old.getX(t + 2)) / 3;
      gg = (old.getY(t) + old.getY(t + 1) + old.getY(t + 2)) / 3;
      b = (old.getZ(t) + old.getZ(t + 1) + old.getZ(t + 2)) / 3;
    }
    for (let k = 0; k < 3; k++) col.set([r * s, gg * s, b * s], (t + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();          // non-indexed: one flat normal per face
  return g;
}

// Blocky texture sampling up close (mipmaps kept for the distance).
export function pixelTex(tex) {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return tex;
}
