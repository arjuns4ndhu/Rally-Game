// Pooled dust particles rendered as soft round points.
import * as THREE from 'three';

const MAX = 900;

export class Dust {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX).fill(1);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.col = new Float32Array(MAX * 3);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 } }]),
      vertexShader: `
        #include <common>
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        uniform float uScale; varying float vAlpha; varying vec3 vColor;
        #include <fog_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        void main(){
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mvPosition.z, 0.1);
          gl_Position = projectionMatrix * mvPosition;
          vAlpha = aAlpha; vColor = aColor;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying float vAlpha; varying vec3 vColor;
        #include <fog_pars_fragment>
        #include <logdepthbuf_pars_fragment>
        void main(){
          #include <logdepthbuf_fragment>
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
          #include <fog_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setViewport(height, fovDeg) {
    this.mat.uniforms.uScale.value = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(x, y, z, vx, vy, vz, size, life, color) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size;
    this.col[i * 3] = color[0]; this.col[i * 3 + 1] = color[1]; this.col[i * 3 + 2] = color[2];
  }

  clear() { this.life.fill(0); this.alpha.fill(0); }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];   // 0 -> 1 over lifetime
      const drag = Math.exp(-dt * 1.8);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + dt * 0.25;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += dt * 2.0;
      this.alpha[i] = Math.min(1, t * 6) * (1 - t) * 0.34;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
}

// Specks of dust and pollen drifting in the headlight beams at night. They
// live in the car's frame (a cone ahead of it) and are drawn additive, so
// they only show where the lamps would light them.
export class BeamDust {
  constructor(scene, n = 260) {
    this.n = n;
    this.local = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    for (let i = 0; i < n; i++) this.spawn(i, true);
  }

  spawn(i, anywhere) {
    const z = anywhere ? 2 + Math.random() * 24 : 24 + Math.random() * 4;   // metres ahead
    const w = 0.8 + z * 0.22;
    this.local.set([(Math.random() - 0.5) * 2 * w, 0.2 + Math.random() * (0.6 + z * 0.06), z], i * 3);
    this.vel.set([(Math.random() - 0.5) * 0.3, (Math.random() - 0.4) * 0.15, (Math.random() - 0.5) * 0.3], i * 3);
  }

  // k: how bright the lamps are (0 = off), density: 0..2.
  update(dt, car, k, density = 1) {
    this.points.visible = k > 0.05;
    if (!this.points.visible) return;
    const pos = this.points.geometry.attributes.position, col = this.points.geometry.attributes.color;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), y0 = car.y ?? 0;
    const vF = car.vx * fx + car.vz * fz;
    const shown = Math.round(this.n * Math.min(1, density / 2));
    for (let i = 0; i < this.n; i++) {
      const L = this.local;
      // The car drives through them: they stream back past the lamps.
      L[i * 3] += this.vel[i * 3] * dt; L[i * 3 + 1] += this.vel[i * 3 + 1] * dt; L[i * 3 + 2] += this.vel[i * 3 + 2] * dt - vF * dt;
      if (L[i * 3 + 2] < 1.5 || L[i * 3 + 2] > 30 || L[i * 3 + 1] < 0) this.spawn(i, false);
      const lx = L[i * 3], ly = L[i * 3 + 1], lz = L[i * 3 + 2];
      pos.setXYZ(i, car.x + fx * lz + fz * lx, y0 + ly, car.z + fz * lz - fx * lx);
      // Brightest near the lamps and in the middle of the beam.
      const w = 0.8 + lz * 0.22, inBeam = Math.max(0, 1 - Math.abs(lx) / w);
      const b = i < shown ? k * inBeam * Math.max(0, 1 - lz / 30) * 0.9 : 0;
      col.setXYZ(i, b, b * 0.95, b * 0.8);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
  }
}
