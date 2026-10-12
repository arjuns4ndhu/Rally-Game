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
      sky.top = '#4a515b'; sky.horizon = '#8a9098'; sky.fog = '#7c838b'; sky.fogDensity *= 1.8; sky.sunGlow = [0.05, 0.05, 0.05];
      L.sunI *= 0.3; L.hemi *= 0.9; L.sun = '#dfe6ee'; L.hemiSky = '#c9d2dc';
      break;
    case 'snowfall':
      sky.top = '#9aa6b4'; sky.horizon = '#e2e8ee'; sky.fog = '#d6dde5'; sky.fogDensity *= 1.7; sky.sunGlow = [0.1, 0.1, 0.1];
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
    const N = Math.round((kind === 'rain' ? 1800 : 1400) * (this.density ?? 1));
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
      this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc6d2e0, transparent: true, opacity: 0.45, depthWrite: false }));
    } else {
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      this.mesh = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, opacity: 0.9, depthWrite: false }));
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
        pos[j + 3] = x + sx * 10; pos[j + 4] = y + 0.9; pos[j + 5] = z + sz * 10;
      } else {
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
