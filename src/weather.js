// Weather and time of day, picked from the stage seed: clear, overcast,
// dusk, fog, rain (snowfall on snow stages) and night. Changes the sky,
// fog and light, the road grip, and adds falling rain or snow.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

export const WEATHER = {
  clear: { id: 'clear', label: 'Clear', grip: 1 },
  overcast: { id: 'overcast', label: 'Overcast', grip: 1 },
  dusk: { id: 'dusk', label: 'Dusk', grip: 1 },
  fog: { id: 'fog', label: 'Fog', grip: 0.97 },
  rain: { id: 'rain', label: 'Rain', grip: 0.86, wet: true },
  snowfall: { id: 'snowfall', label: 'Snowfall', grip: 0.93 },
  night: { id: 'night', label: 'Night', grip: 1, dark: true },
};

export function pickWeather(seed, theme) {
  const r = mulberry32(((seed * 69069) ^ 0x2545f491) >>> 0);
  r(); r();
  const x = r();
  let id = x < 0.38 ? 'clear' : x < 0.48 ? 'overcast' : x < 0.62 ? 'dusk' : x < 0.72 ? 'fog' : x < 0.87 ? 'rain' : 'night';
  if (id === 'rain' && theme.id === 'desert') id = 'clear';
  if (id === 'rain' && theme.id === 'snow') id = 'snowfall';
  return WEATHER[id];
}

const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);

// A theme with the weather's sky, fog and light applied on top.
export function weatherTheme(theme, w) {
  const t = structuredClone(theme);
  const sky = t.sky, L = t.light;
  const css = (c) => `#${c.getHexString()}`;
  switch (w.id) {
    case 'overcast':
      sky.top = css(mix(sky.top, '#7d8590', 0.7)); sky.horizon = css(mix(sky.horizon, '#b7bcc2', 0.6));
      sky.fog = css(mix(sky.fog, '#a9aeb4', 0.6)); sky.fogDensity *= 1.25; sky.sunGlow = [0.15, 0.15, 0.15];
      L.sunI *= 0.45; L.hemi *= 1.1; L.sun = '#e8ecf0';
      break;
    case 'dusk':
      sky.top = '#2b2f5c'; sky.horizon = '#ff9a55'; sky.fog = css(mix(sky.fog, '#c7704a', 0.6));
      sky.sunGlow = [1.0, 0.55, 0.25]; L.sun = '#ffb071'; L.sunI *= 0.9; L.hemi *= 0.75;
      L.hemiSky = '#ffcfa0'; L.sunDir = [L.sunDir[0], 0.16, L.sunDir[2]];
      break;
    case 'fog':
      sky.fog = css(mix(sky.fog, '#c9ccc9', 0.5)); sky.horizon = sky.fog; sky.fogDensity *= 2.6;
      sky.top = css(mix(sky.top, '#c9ccc9', 0.6)); sky.sunGlow = [0.2, 0.2, 0.18];
      L.sunI *= 0.5; L.hemi *= 1.05;
      break;
    case 'rain':
      sky.top = '#4a515b'; sky.horizon = '#8a9098'; sky.fog = '#7c838b'; sky.fogDensity *= 1.3; sky.sunGlow = [0.05, 0.05, 0.05];
      L.sunI *= 0.3; L.hemi *= 0.9; L.sun = '#dfe6ee'; L.hemiSky = '#c9d2dc';
      break;
    case 'snowfall':
      sky.top = '#9aa6b4'; sky.horizon = '#e2e8ee'; sky.fog = '#d6dde5'; sky.fogDensity *= 1.3; sky.sunGlow = [0.1, 0.1, 0.1];
      L.sunI *= 0.45;
      break;
    case 'night':
      sky.top = '#03050b'; sky.horizon = '#141b2b'; sky.fog = '#0a0e17'; sky.fogDensity *= 1.15; sky.sunGlow = [0.35, 0.4, 0.55];
      L.sun = '#9fb4ff'; L.sunI = 0.35; L.hemi = 0.32; L.hemiSky = '#5a6a9a'; L.hemiGround = '#1a1a22';
      L.sunDir = [-0.3, 0.6, 0.5];
      break;
  }
  return t;
}

// Falling rain (streaks) or snow (flakes) in a box that follows the camera.
export class Precip {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.kind = null;
  }

  set(kind) {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
    this.kind = kind;
    if (!kind) return;
    const N = Math.round((kind === 'rain' ? 650 : 900) * (this.density ?? 1));   // low-res rendering makes each one chunky
    this.N = N;
    this.box = { x: 46, y: 26, z: 46 };
    this.p = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.p[i * 3] = (Math.random() - 0.5) * this.box.x;
      this.p[i * 3 + 1] = Math.random() * this.box.y;
      this.p[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
    }
    const geo = new THREE.BufferGeometry();
    if (kind === 'rain') {
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
      this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc6d2e0, transparent: true, opacity: 0.2, depthWrite: false }));
    } else {
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      this.mesh = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.75, depthWrite: false }));
    }
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  update(dt, cam, carVel) {
    if (!this.mesh) return;
    const rain = this.kind === 'rain';
    const fall = rain ? 22 : 2.2, wind = rain ? 3 : 1.2;
    const t = performance.now() / 1000;
    const pos = this.mesh.geometry.attributes.position.array;
    const B = this.box, cx = cam.position.x, cy = cam.position.y - 8, cz = cam.position.z;
    // Streak direction includes your own speed, so rain slants as you drive.
    const sx = (wind - (carVel?.x || 0) * 0.5) * 0.04, sz = (-(carVel?.z || 0) * 0.5) * 0.04;
    for (let i = 0; i < this.N; i++) {
      const k = i * 3;
      this.p[k + 1] -= fall * dt;
      this.p[k] += (wind + (rain ? 0 : Math.sin(t + i) * 0.6)) * dt;
      if (this.p[k + 1] < 0) this.p[k + 1] += B.y;
      // Wrap around the camera so the box always surrounds it.
      let x = ((this.p[k] - cx) % B.x + B.x * 1.5) % B.x - B.x / 2 + cx;
      let z = ((this.p[k + 2] - cz) % B.z + B.z * 1.5) % B.z - B.z / 2 + cz;
      const y = cy + this.p[k + 1];
      if (rain) {
        const j = i * 6;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
        pos[j + 3] = x + sx * 6; pos[j + 4] = y + 0.55; pos[j + 5] = z + sz * 6;
      } else {
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

// High-quality rain, animated entirely on the GPU: soft-edged streaks
// aligned with their fall (tilted by wind and by your own speed), plus
// splash rings on the ground around the car.
export class Rain {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
  }

  set(on, density = 1) {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      this.group = null;
    }
    if (!on) return;
    this.group = new THREE.Group();
    this.uniforms = {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(2.5, 0) },
      uGround: { value: 0 }, uOpacity: { value: 0.5 }, uPix: { value: 2 / 720 }, uAspect: { value: 16 / 9 },
    };
    const logV = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
    const logF = '#include <common>\n#include <logdepthbuf_pars_fragment>\n';

    // Streaks.
    const N = Math.round(3200 * density);
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    const off = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) off.set([Math.random() * 30, Math.random() * 16, Math.random() * 30, 0.6 + Math.random() * 0.8], i * 4);
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = N;
    const streaks = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: logV + `
        uniform float uTime; uniform vec3 uCenter; uniform vec2 uWind; uniform float uPix; uniform float uAspect;
        attribute vec4 aOff; varying vec2 vUv; varying float vFade;
        void main() {
          vUv = uv;
          float speed = 16.0 + aOff.w * 8.0;
          vec3 box = vec3(30.0, 16.0, 30.0);
          vec3 p;
          p.x = uCenter.x + mod(aOff.x + uWind.x * uTime * 0.3 - uCenter.x, box.x) - box.x * 0.5;
          p.z = uCenter.z + mod(aOff.z + uWind.y * uTime * 0.3 - uCenter.z, box.z) - box.z * 0.5;
          p.y = uCenter.y - 6.0 + mod(aOff.y - uTime * speed, box.y);
          vec3 dir = normalize(vec3(uWind.x, -speed, uWind.y));
          float len = 1.0 + aOff.w * 0.9, wid = 0.018 + aOff.w * 0.012;
          // Draw the streak in screen space so it is never thinner than about
          // one pixel (at the low retro resolution thin streaks vanished).
          vec4 ct = projectionMatrix * viewMatrix * vec4(p, 1.0);
          vec4 cb = projectionMatrix * viewMatrix * vec4(p - dir * len, 1.0);
          vec4 c = mix(ct, cb, position.y);
          vec2 st = ct.xy / ct.w, sb = cb.xy / cb.w;
          vec2 d = (sb - st) * vec2(uAspect, 1.0);
          d = length(d) > 1e-5 ? normalize(d) : vec2(0.0, 1.0);
          vec2 n = vec2(-d.y, d.x) / vec2(uAspect, 1.0);
          float w = max(wid * projectionMatrix[1][1] / max(c.w, 0.1), uPix * 1.4);
          c.xy += n * position.x * w * c.w;
          // Fade out far drops so the air doesn't turn into a grey wall.
          vFade = 1.0 - smoothstep(9.0, 16.0, length(p - cameraPosition));
          gl_Position = c;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: logF + `
        uniform float uOpacity; varying vec2 vUv; varying float vFade;
        void main() {
          #include <logdepthbuf_fragment>
          float t = vUv.y;                             // 0 at the falling head, 1 at the tail
          float a = uOpacity * vFade * (1.0 - t * 0.75) * smoothstep(0.0, 0.08, t) * (1.0 - pow(abs(vUv.x - 0.5) * 2.0, 3.0));
          gl_FragColor = vec4(0.86, 0.9, 0.96, a);
        }`,
    }));
    streaks.frustumCulled = false;
    this.group.add(streaks);

    // Splash rings on the ground near the car.
    const M = Math.round(260 * density);
    const sq = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const sg = new THREE.InstancedBufferGeometry();
    sg.index = sq.index;
    sg.setAttribute('position', sq.attributes.position);
    sg.setAttribute('uv', sq.attributes.uv);
    const so = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) so.set([Math.random() * 28, Math.random() * 28, Math.random()], i * 3);
    sg.setAttribute('aOff', new THREE.InstancedBufferAttribute(so, 3));
    sg.instanceCount = M;
    const splashes = new THREE.Mesh(sg, new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: logV + `
        uniform float uTime; uniform vec3 uCenter; uniform float uGround;
        attribute vec3 aOff; varying vec2 vUv; varying float vT;
        void main() {
          vUv = uv;
          float cyc = uTime * 2.2 + aOff.z;
          vT = fract(cyc);
          float k = floor(cyc);
          // Each cycle lands somewhere new.
          vec2 jit = vec2(fract(sin(k * 12.9898 + aOff.x) * 43758.5), fract(sin(k * 78.233 + aOff.y) * 43758.5)) * 6.0;
          vec3 p = vec3(uCenter.x + mod(aOff.x + jit.x - uCenter.x, 28.0) - 14.0, uGround + 0.06, uCenter.z + mod(aOff.y + jit.y - uCenter.z, 28.0) - 14.0);
          float s = 0.08 + vT * 0.32;
          gl_Position = projectionMatrix * viewMatrix * vec4(p + position * s, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: logF + `
        uniform float uOpacity; varying vec2 vUv; varying float vT;
        void main() {
          #include <logdepthbuf_fragment>
          float r = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.65, 0.85, r) * (1.0 - smoothstep(0.85, 1.0, r));
          gl_FragColor = vec4(0.85, 0.9, 0.95, ring * (1.0 - vT) * uOpacity * 1.6);
        }`,
    }));
    splashes.frustumCulled = false;
    this.group.add(splashes);
    this.scene.add(this.group);
  }

  // Render-target height in pixels, so streaks stay at least a pixel wide.
  setViewport(h) { this.viewH = h; if (this.uniforms) this.uniforms.uPix.value = 2 / h; }

  update(dt, cam, carVel, groundY) {
    if (!this.group) return;
    const u = this.uniforms;
    if (this.viewH) u.uPix.value = 2 / this.viewH;
    u.uAspect.value = cam.aspect || 16 / 9;
    u.uTime.value += dt;
    u.uCenter.value.copy(cam.position);
    // Streaks lean into the wind and against your motion.
    u.uWind.value.set(2.5 - (carVel?.x || 0) * 0.6, -(carVel?.z || 0) * 0.6);
    u.uGround.value = groundY ?? cam.position.y - 2;
  }
}
