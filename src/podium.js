// End-of-season podium: the top three cars on the steps under spotlights,
// confetti falling, the camera drifting slowly across the front.
import * as THREE from 'three';
import { buildCarModel } from './carModel.js';
import { CARS } from './car.js';

export class Podium {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.running = false;
    this.models = [];
  }

  _init() {
    if (this.renderer) return;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    const scene = this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2420, 0.9));
    const key = new THREE.SpotLight(0xfff0d8, 260, 40, 0.55, 0.5, 1.6);
    key.position.set(0, 14, 9); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    scene.add(key, key.target);
    for (const x of [-9, 9]) { const s = new THREE.SpotLight(0xffb000, 90, 30, 0.4, 0.6, 1.6); s.position.set(x, 9, 4); scene.add(s, s.target); }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.MeshStandardMaterial({ color: 0x1b1d23, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);
    // Steps: 2nd, 1st, 3rd from left to right, numbers on the fronts.
    this.steps = [[-3.3, 0.9, 2], [0, 1.4, 1], [3.3, 0.6, 3]].map(([x, h, n]) => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#f1ede2'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#16181d'; g.font = 'bold 96px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 64, 70);
      const front = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), roughness: 0.6 });
      const side = new THREE.MeshStandardMaterial({ color: n === 1 ? 0xffb000 : 0xe9e4d6, roughness: 0.6 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(3.2, h, 3.2), [side, side, side, side, front, side]);
      m.position.set(x, h / 2, 0); m.castShadow = m.receiveShadow = true;
      scene.add(m);
      return { x, h };
    });
    // Confetti: small coloured squares tumbling down.
    const N = 420, geo = new THREE.PlaneGeometry(0.09, 0.06);
    this.confetti = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), N);
    const cols = [0xffb000, 0xd8432b, 0x2a6fd8, 0xf1ede2, 0x1f9e5a, 0xff2fa0];
    this.bits = [];
    for (let i = 0; i < N; i++) {
      this.confetti.setColorAt(i, new THREE.Color(cols[i % cols.length]));
      this.bits.push({ x: (Math.random() - 0.5) * 14, y: Math.random() * 12, z: (Math.random() - 0.5) * 8, s: 0.6 + Math.random() * 0.8, a: Math.random() * 6, r: Math.random() * 6 });
    }
    scene.add(this.confetti);
  }

  // cars: up to three { car, color } in finishing order.
  show(cars) {
    this._init();
    for (const m of this.models) { this.scene.remove(m.root); m.dispose(); }
    this.models = [];
    const order = [1, 0, 2];                       // step k holds the (order[k]+1)th
    order.forEach((place, k) => {
      const c = cars[place];
      if (!c || !CARS[c.car]) return;
      const m = buildCarModel(CARS[c.car], { color: c.color, number: place + 1 });
      m.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const st = this.steps[k];
      m.root.position.set(st.x, st.h, 0);
      m.root.rotation.y = 0.5 - k * 0.35;
      this.scene.add(m.root);
      this.models.push(m);
    });
  }

  start() {
    this._init();
    if (this.running) return;
    this.running = true;
    let last = performance.now(), t = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const loop = (now) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      if (w && h && (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr))) {
        this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
        this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
      }
      const a = Math.sin(t * 0.25) * 0.5;
      // Low in the frame would hide behind the result card: aim below the cars.
      this.cam.position.set(Math.sin(a) * 15, 4.6, Math.cos(a) * 15);
      this.cam.lookAt(0, -0.6, 0);
      this.bits.forEach((b, i) => {
        b.y -= dt * b.s; b.a += dt * 3; b.r += dt * 2;
        if (b.y < 0) { b.y = 10 + Math.random() * 3; b.x = (Math.random() - 0.5) * 14; }
        v.set(b.x + Math.sin(b.a) * 0.3, b.y, b.z);
        q.setFromEuler(e.set(b.a, b.r, 0));
        this.confetti.setMatrixAt(i, m4.compose(v, q, one));
      });
      this.confetti.instanceMatrix.needsUpdate = true;
      this.renderer.render(this.scene, this.cam);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }
}
