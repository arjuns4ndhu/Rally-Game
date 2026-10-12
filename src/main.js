// Sideways: build 1, driving test on a practice loop.
import * as THREE from 'three';
import { CarPhysics, CARS, CAR_ORDER, TUNE } from './car.js';
import { buildCarModel } from './carModel.js';
import { createTestRoad, gravelTexture, SURFACES } from './track.js';
import { setupWorld, buildScenery } from './scenery.js';
import { CameraRig } from './camera.js';
import { Dust } from './particles.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';

const $ = (id) => document.getElementById(id);
document.body.classList.add('scanlines');
const STEP = 1 / 120;

// ---------- Renderer / scene ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2500);
const world = setupWorld(scene);
const rig = new CameraRig(camera);
const dust = new Dust(scene);
const audio = new AudioEngine();
const input = new Input();

// ---------- Road ----------
const road = createTestRoad();
const gravelMat = new THREE.MeshStandardMaterial({ map: gravelTexture(), roughness: 0.95 });
const vergeMat = new THREE.MeshStandardMaterial({ color: 0x6e6340, roughness: 1 });
scene.add(road.buildRibbon(road.width + 4.5, 0.012, vergeMat, 1 / 10));
scene.add(road.buildRibbon(road.width, 0.03, gravelMat, 1 / 12));
scene.add(buildScenery(road, 1));

// Start/finish style gantry so the loop has a landmark.
(function gantry() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b1e26, flatShading: true });
  const band = new THREE.MeshStandardMaterial({ color: 0xffb000, emissive: 0x332200, flatShading: true });
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 0.4), mat);
    post.position.set(s * (road.width / 2 + 1.2), 2.5, 0);
    post.castShadow = true;
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(road.width + 3, 0.9, 0.3), band);
  beam.position.y = 4.8;
  g.add(beam);
  const i = 20;
  g.position.set(road.px[i], 0, road.pz[i]);
  g.rotation.y = Math.atan2(road.tx[i], road.tz[i]);
  scene.add(g);
})();

// ---------- Car ----------
let carId = 'vanta';
const car = new CarPhysics(CARS[carId]);
let model = buildCarModel(CARS[carId], { color: '#e8542a', wheelStyle: 'spoke', number: 7 });
scene.add(model.root);
audio.setCar(CARS[carId]);
let roadHint = -1;
let surface = SURFACES.gravel;

function placeOnRoad(i) {
  const yaw = Math.atan2(road.tx[i], road.tz[i]);
  car.reset(road.px[i], road.pz[i], yaw);
  car.y = road.py[i];
  roadHint = i;
  dust.clear();
  rig.snap(car);
}

function setCar(id) {
  carId = id;
  const color = model.paint.color.getStyle();
  scene.remove(model.root);
  model.dispose();
  car.setSpec(CARS[id]);
  model = buildCarModel(CARS[id], { color, wheelStyle: 'spoke', number: 7 });
  scene.add(model.root);
  audio.setCar(CARS[id]);
  $('hud-car').textContent = CARS[id].name;
  toast(`${CARS[id].name} · ${CARS[id].tag}`);
  buildSliders();
}

placeOnRoad(0);

// ---------- HUD ----------
const rpmEl = $('hud-rpm');
for (let i = 0; i < 20; i++) {
  const s = document.createElement('i');
  if (i >= 13) s.classList.add('mid');
  if (i >= 17) s.classList.add('red');
  rpmEl.appendChild(s);
}
const rpmSegs = [...rpmEl.children];
let toastTimer = 0;
function toast(msg, ms = 1600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

let hudAcc = 0;
function updateHud(dt) {
  hudAcc += dt;
  if (hudAcc < 1 / 30) return;
  hudAcc = 0;
  $('hud-speed').textContent = Math.round(car.speed * 3.6);
  $('hud-gear').textContent = car.gear < 0 ? 'R' : car.gear;
  const frac = (car.rpm - car.spec.idleRpm) / (car.spec.redline - car.spec.idleRpm);
  const lit = Math.round(Math.max(0, Math.min(1, frac)) * 20);
  rpmSegs.forEach((s, i) => s.classList.toggle('on', i < lit));
  const drift = Math.abs(car.driftAngle * 180 / Math.PI);
  $('hud-drift').classList.toggle('on', car.drifting && drift > 8);
  $('hud-drift-val').textContent = `${Math.round(drift)}°`;
  if (!$('debug').hidden) {
    $('dbg-read').textContent =
`speed   ${(car.speed * 3.6).toFixed(1)} km/h   gear ${car.gear}
rpm     ${car.rpm.toFixed(0)}
drift   ${(car.driftAngle * 57.3).toFixed(1)}°  ${car.drifting ? 'DRIFTING' : ''}
slip F  ${(car.slipF * 57.3).toFixed(1)}°   R ${(car.slipR * 57.3).toFixed(1)}°
load F  ${(car.loadF / 9.81).toFixed(0)} kg  R ${(car.loadR / 9.81).toFixed(0)} kg
steer   ${(car.steer * 57.3).toFixed(1)}°
surface ${surface.name}`;
  }
}

// ---------- Tuning sliders ----------
const SLIDERS = [
  ['TUNE', 'yawDamp', 0, 2, 0.05],
  ['TUNE', 'driftGain', 0, 8, 0.1],
  ['TUNE', 'driftAssist', 0, 10, 0.1],
  ['TUNE', 'driftEnter', 0.05, 0.4, 0.01],
  ['TUNE', 'boostHeading', 0, 1, 0.05],
  ['TUNE', 'transfer', 0, 3, 0.1],
  ['car', 'muF', 0.6, 1.6, 0.01],
  ['car', 'muR', 0.6, 1.6, 0.01],
  ['car', 'throttleOversteer', 0, 1.2, 0.05],
  ['car', 'driftBoost', 0, 6, 0.1],
  ['car', 'counterSteer', 0, 1, 0.05],
  ['car', 'steerSpeed', 1, 10, 0.1],
  ['car', 'torque', 100, 500, 5],
];
function buildSliders() {
  const box = $('dbg-sliders');
  box.innerHTML = '';
  for (const [scope, key, min, max, step] of SLIDERS) {
    const obj = scope === 'TUNE' ? TUNE : CARS[carId];
    const row = document.createElement('label');
    row.className = 'dbg-row';
    row.innerHTML = `<span>${key}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${obj[key]}"><output>${obj[key]}</output>`;
    const inp = row.querySelector('input'), out = row.querySelector('output');
    inp.addEventListener('input', () => { obj[key] = parseFloat(inp.value); out.textContent = inp.value; });
    // Hand focus back to the game so keys drive the car, not the slider.
    inp.addEventListener('change', () => inp.blur());
    box.appendChild(row);
  }
}
buildSliders();

// Snapshot the shipped values so the panel can put everything back.
const DEFAULTS = {
  TUNE: { ...TUNE },
  cars: Object.fromEntries(Object.entries(CARS).map(([id, spec]) => [id, { ...spec }])),
};
function resetTuning() {
  Object.assign(TUNE, DEFAULTS.TUNE);
  for (const id in CARS) Object.assign(CARS[id], DEFAULTS.cars[id]);
  car.setSpec(CARS[carId]);
  buildSliders();
  toast('TUNING RESET', 1000);
}
$('dbg-reset').addEventListener('click', (e) => { resetTuning(); e.currentTarget.blur(); });

// ---------- Game state ----------
let running = false, paused = false;

function start() {
  audio.init();
  $('start').hidden = true;
  $('hud').hidden = false;
  running = true;
  paused = false;
  toast('GO!', 900);
}
function setPaused(p) {
  if (!running) return;
  paused = p;
  $('pause').hidden = !p;
  if (p) audio.suspend(); else audio.resume();
}
function resetCar() {
  const q = road.nearest(car.x, car.z, roadHint);
  placeOnRoad(q.i);
  audio.thud(0.3);
}

$('btn-start').addEventListener('click', start);
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-reset').addEventListener('click', () => { resetCar(); setPaused(false); });
$('opt-scan').addEventListener('change', (e) => document.body.classList.toggle('scanlines', e.target.checked));

input.on('key', (code, key) => {
  if (code === 'Escape') { if (running) setPaused(!paused); return; }
  if (key === '?' || code === 'Slash') { $('debug').hidden = !$('debug').hidden; return; }
  if (!running) { if (code === 'Enter' || code === 'Space') start(); return; }
  if (paused) return;
  if (code === 'KeyC') toast(rig.cycle().toUpperCase() + ' CAM', 800);
  if (code === 'KeyR') resetCar();
  const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
  if (n >= 0) setCar(CAR_ORDER[n]);
});
input.on('action', (act) => {
  if (act === 'camera') toast(rig.cycle().toUpperCase() + ' CAM', 800);
  if (act === 'reset') resetCar();
  if (act === 'pause') setPaused(!paused);
});

// Touch UI
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) {
  document.body.classList.add('touch');
  $('touch').hidden = false;
  input.bindTouch($('touch'));
}

// ---------- Resize ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dust.setViewport(h * renderer.getPixelRatio(), camera.fov);
  $('rotate').hidden = !(isTouch && h > w);
}
window.addEventListener('resize', resize);
resize();

// ---------- Dust emission ----------
const emitAcc = [0, 0];
const _w = new THREE.Vector3();
function emitDust(dt) {
  const s = car.spec;
  const sn = Math.sin(car.yaw), cs = Math.cos(car.yaw);
  const off = surface === SURFACES.grass;
  const base = Math.min(car.speed / 28, 1) * (off ? 0.6 : 0.22);
  const amount = (car.rearSlide * 1.0 * Math.min(1, car.speed / 12) + base + (off ? car.speed / 40 : 0));
  if (amount < 0.02) return;
  const col = surface.dust;
  for (let w = 0; w < 2; w++) {
    const side = w === 0 ? 1 : -1;
    // Rear wheel position in world space (left = (cos, -sin)).
    const lx = side * s.track / 2, lz = -s.b - 0.2;
    _w.set(car.x + sn * lz + cs * lx, (car.y ?? 0) + 0.25, car.z + cs * lz - sn * lx);
    emitAcc[w] += amount * dt * 34;
    while (emitAcc[w] >= 1) {
      emitAcc[w] -= 1;
      const spread = 1.2 + car.rearSlide * 2;
      const shade = 0.9 + Math.random() * 0.2;
      dust.emit(
        _w.x + (Math.random() - 0.5) * 0.4, _w.y, _w.z + (Math.random() - 0.5) * 0.4,
        car.vx * 0.25 + (Math.random() - 0.5) * spread - sn * 1.5,
        0.6 + Math.random() * 1.2,
        car.vz * 0.25 + (Math.random() - 0.5) * spread - cs * 1.5,
        0.7 + Math.random() * 0.8 + car.rearSlide * 0.6,
        1.3 + Math.random() * 1.2,
        [col[0] * shade, col[1] * shade, col[2] * shade],
      );
    }
  }
}

// ---------- Main loop ----------
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;

  const active = running && !paused;
  if (active) {
    acc += dt;
    while (acc >= STEP) {
      const inp = input.update(STEP);
      const q = road.nearest(car.x, car.z, roadHint);
      roadHint = q.i;
      surface = road.surfaceAt(Math.abs(q.lateral));
      car.step(STEP, inp, surface);
      car.y = q.y;
      acc -= STEP;
    }
    emitDust(dt);
    // Far off the road: put the car back.
    if (road.q.dist > 40) { toast('BACK ON THE ROAD', 1000); resetCar(); }
  }

  model.update(car, dt);
  world.follow(car.x, car.z);
  rig.shake = active ? (surface === SURFACES.grass ? 0.05 : 0.012) * Math.min(car.speed / 25, 1) : 0;
  rig.update(car, dt);
  if (!paused) dust.update(dt);
  audio.update(car, surface, dt, active);
  if (running) updateHud(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Exposed for automated smoke tests.
function stepSim(seconds, inp) {
  for (let t = 0; t < seconds; t += STEP) {
    const q = road.nearest(car.x, car.z, roadHint);
    roadHint = q.i;
    surface = road.surfaceAt(Math.abs(q.lateral));
    car.step(STEP, inp, surface);
    car.y = q.y;
    emitDust(STEP);
    dust.update(STEP);
  }
  model.update(car, 0.2);
  rig.snap(car);
}
window.__sideways = { car, road, input, TUNE, CARS, start, stepSim, placeOnRoad, get surface() { return surface; } };
