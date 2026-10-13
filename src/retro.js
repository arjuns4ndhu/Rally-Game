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

// ---------- Vertex wobble ----------
// Snap every vertex to a coarse screen grid, like early consoles without
// sub-pixel precision. Patches three's shared projection chunk, so it must
// run before anything is compiled (toggling it needs a reload).
export function enableWobble(grid = [200, 112]) {
  THREE.ShaderChunk.project_vertex = THREE.ShaderChunk.project_vertex.replace(
    'gl_Position = projectionMatrix * mvPosition;',
    `gl_Position = projectionMatrix * mvPosition;
    if (gl_Position.w > 0.0) {
      vec2 snapGrid = vec2(${grid[0].toFixed(1)}, ${grid[1].toFixed(1)});
      gl_Position.xy = floor(gl_Position.xy / gl_Position.w * snapGrid + 0.5) / snapGrid * gl_Position.w;
    }`,
  );
}

// ---------- Low-res render + dithered reduced colour ----------
// Renders the scene into a small target (pixelated), then draws it to the
// screen with nearest sampling, tone mapping, and optional ordered (Bayer)
// dithering down to a few levels per channel.
export class RetroPass {
  constructor() {
    this.lines = 0;           // vertical resolution (0 = off)
    this.dither = false;
    this.rt = null;
    this.size = [1, 1];
    this.qScene = new THREE.Scene();
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uDither: { value: 0 }, uLevels: { value: 24 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uDither; uniform float uLevels;
        varying vec2 vUv;
        float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
        float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          if (uDither > 0.5) {
            float b = bayer4(floor(vUv * uRes)) - 0.5;
            gl_FragColor.rgb = clamp(floor(gl_FragColor.rgb * uLevels + b + 0.5) / uLevels, 0.0, 1.0);
          }
        }`,
      depthTest: false, depthWrite: false,
    });
    this.qScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  get active() { return this.lines > 0 || this.dither; }

  // w, h: canvas size in CSS pixels; ratio: the renderer's pixel ratio.
  setSize(w, h, ratio) {
    const fullH = Math.round(h * ratio);
    const rh = this.lines > 0 ? Math.min(this.lines, fullH) : fullH;
    const rw = Math.max(1, Math.round(rh * w / h));
    this.size = [rw, rh];
    if (!this.active) return;
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    } else this.rt.setSize(rw, rh);
    this.mat.uniforms.tDiffuse.value = this.rt.texture;
    this.mat.uniforms.uRes.value.set(rw, rh);
    this.mat.uniforms.uDither.value = this.dither ? 1 : 0;
  }

  render(renderer, scene, camera) {
    if (!this.active || !this.rt) { renderer.render(scene, camera); return; }
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.qScene, this.qCam);
  }
}
