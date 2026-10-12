// Sideways: build 2, seeded daily / random stages plus the practice loop.
import * as THREE from 'three';
import { CarPhysics, CARS, CAR_ORDER, TUNE } from './car.js';
import { buildCarModel } from './carModel.js';
import { Road, createTestRoad, gravelTexture, SURFACES } from './track.js';
import { generateStage, stageName } from './stagegen.js';
import { buildGate, buildSign, buildCornerWarnings } from './gates.js';
import { dateSeed } from './rng.js';
import { setupWorld, buildScenery } from './scenery.js';
import { CameraRig } from './camera.js';
import { Dust } from './particles.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { TyreMarks, buildRacingMarks } from './tyremarks.js';
import { GhostRecorder, saveGhost, loadGhost, samplePose } from './ghost.js';
import { buildPaceNotes, CoDriver } from './pacenotes.js';

const $ = (id) => document.getElementById(id);
document.body.classList.add('scanlines');
const STEP = 1 / 120;

// ---------- Renderer / scene ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.2, 480);
const world = setupWorld(scene);
const rig = new CameraRig(camera);
const dust = new Dust(scene);
const marks = new TyreMarks(scene);
const audio = new AudioEngine();
const input = new Input();
let noteTimer = 0;
const codriver = new CoDriver((text) => {
  const el = $('hud-note');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => el.classList.remove('on'), 3200);
});
try { const m = localStorage.getItem('sideways.codriver'); if (m === 'voice' || m === 'text' || m === 'off') codriver.mode = m; } catch { /* ignore */ }

// ---------- Stage ----------
// A stage is a road plus everything built around it. Loading a new one
// disposes the old meshes.
const gravelMat = new THREE.MeshStandardMaterial({ map: gravelTexture(), roughness: 0.95 });
const vergeMat = new THREE.MeshStandardMaterial({ color: 0x6e6340, roughness: 1 });
const SECTORS = 5;
const PENALTY = 5;            // seconds added for a respawn
const RESPAWN_DIST = 25;      // metres off the road before you're put back
let road = null, terrain = null, stageGroup = null, lineMesh = null;
const stage = { kind: 'practice', seed: 0, name: '', start: 0, finish: 0, cps: [] };

function disposeGroup(g) {
  g.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { if (m === gravelMat || m === vergeMat) continue; m.map?.dispose(); m.dispose(); }
  });
}

function loadStage(kind, seed = 0) {
  if (stageGroup) { scene.remove(stageGroup); disposeGroup(stageGroup); }
  stageGroup = new THREE.Group();
  stage.kind = kind; stage.seed = seed;
  let flat = false, runout = 0;
  if (kind === 'practice') {
    road = createTestRoad();
    road.applyBumps([{ kind: 'jump', at: 100, h: 1.4, up: 20, down: 9 }, { kind: 'crest', at: 300, h: 1.2, len: 30 }]);
    flat = true;
    stage.name = 'Practice loop';
  } else {
    const def = generateStage(seed);
    road = new Road(def.points, { width: def.width, closed: false });
    road.applyBumps(def.bumps);
    runout = def.runout;
    stage.name = def.name;
  }
  road.computeRacingLine();
  const built = buildScenery(road, kind === 'practice' ? 1 : seed, { flat });
  terrain = built.terrain;
  stageGroup.add(built.group);
  stageGroup.add(road.buildRibbon(road.width + 4.5, 0.012, vergeMat, 1 / 10));
  stageGroup.add(road.buildRibbon(road.width, 0.03, gravelMat, 1 / 12));
  // The racing line is always shown as dark, worn tyre tracks.
  lineMesh = buildRacingMarks(road);
  stageGroup.add(lineMesh);
  // Really sharp corners get brake boards, chevrons and braking marks.
  stageGroup.add(buildCornerWarnings(road, road.findSharpCorners()));
  (road.bumps || []).forEach((b, k) => {
    if (b.at > 75) stageGroup.add(buildSign(road, b.at - 70, b.kind === 'jump' ? 'JUMP' : 'CREST', k % 2 ? -1 : 1));
  });

  if (kind === 'practice') {
    stage.start = stage.finish = 0; stage.cps = [];
    stageGroup.add(buildGate(road, 40, 'PRACTICE', 'start'));
  } else {
    stage.start = 24;
    stage.finish = road.length - runout;
    stage.cps = [];
    for (let k = 1; k <= SECTORS; k++) stage.cps.push(stage.start + (stage.finish - stage.start) * k / SECTORS);
    stageGroup.add(buildGate(road, stage.start, 'START', 'start'));
    for (let k = 0; k < SECTORS - 1; k++) stageGroup.add(buildGate(road, stage.cps[k], `S${k + 2}`, 'sector'));
    stageGroup.add(buildGate(road, stage.finish, 'FINISH', 'finish'));
  }
  scene.add(stageGroup);
  codriver.load(buildPaceNotes(road, { start: stage.start, finish: stage.kind === 'practice' ? road.length : stage.finish }));
  marks.clear();
  restartRun();
}

// ---------- Racing line assist ----------
// A soft, damped spring that nudges the car sideways toward the racing line.
// It only moves the car's position across the road; steering, throttle and
// drifting stay fully in the player's hands.
const ASSIST_LEVELS = { low: 0.5, medium: 1, high: 1.8 };
const assist = { on: false, level: 'medium' };
try {
  const saved = JSON.parse(localStorage.getItem('sideways.assist') || 'null');
  if (saved && saved.level in ASSIST_LEVELS) Object.assign(assist, { on: !!saved.on, level: saved.level });
} catch { /* storage unavailable: use defaults */ }
function saveAssist() {
  try { localStorage.setItem('sideways.assist', JSON.stringify(assist)); } catch { /* ignore */ }
}
function applyLineAssist(q, dt) {
  if (!assist.on || car.gear < 0) return;
  const k = ASSIST_LEVELS[assist.level];
  const lx = q.tz, lz = -q.tx;                       // road "left" unit vector
  const err = road.racingAt(q) - q.lateral;           // metres to the line (left +)
  const vLat = car.vx * lx + car.vz * lz;             // sideways speed across the road
  // Fade in with speed, fade out when well off the road.
  const fade = Math.min(1, car.speed / 8) * Math.max(0, 1 - Math.max(0, Math.abs(q.lateral) - road.width / 2) / 6);
  const kp = 1.2 * k;                                 // spring stiffness (1/s^2)
  let a = (kp * err - 1.6 * Math.sqrt(kp) * vLat) * fade;   // ~0.8 critical damping
  const cap = 2.4 * k;                                // at most ~0.25 g on Medium
  a = Math.max(-cap, Math.min(cap, a));
  car.vx += lx * a * dt;
  car.vz += lz * a * dt;
}
// ---------- Car ----------
let carId = 'stiletto';
const car = new CarPhysics(CARS[carId]);
let model = buildCarModel(CARS[carId], { color: '#e8542a', wheelStyle: 'spoke', number: 7 });
scene.add(model.root);
audio.setCar(CARS[carId]);
let roadHint = -1;
let roadAlong = 0;
let surface = SURFACES.gravel;

function placeOnRoad(i) {
  const yaw = Math.atan2(road.tx[i], road.tz[i]);
  car.reset(road.px[i], road.pz[i], yaw);
  car.y = road.py[i];
  car.groundPitch = 0; car.groundRoll = 0;
  car.vy = 0; car.air = false; car.airTime = 0; car.squash = 0;
  roadHint = i;
  roadAlong = road.cum[i];
  codriver.seek(roadAlong);
  dust.clear();
  marks.cut();
  rig.snap(car);
}

// ---------- Timing ----------
const run = { state: 'idle', t: 0, next: 0, splits: [], penalty: 0, respawns: 0 };
function bestKey() { return `sideways.best.${stage.seed}`; }
function loadBest() {
  if (stage.kind === 'practice') return null;
  try { return JSON.parse(localStorage.getItem(bestKey()) || 'null'); } catch { return null; }
}
function saveBest(rec) { try { localStorage.setItem(bestKey(), JSON.stringify(rec)); } catch { /* ignore */ } }
let best = null;

function fmt(t) {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), sec = t - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
}
function fmtDelta(d) { return `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`; }

// ---------- Ghost ----------
const recorder = new GhostRecorder();
let ghost = null, ghostModel = null;
const ghostPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, done: false };
let ghostOn = true;
try { ghostOn = localStorage.getItem('sideways.ghostOn') !== '0'; } catch { /* ignore */ }
function refreshGhost() {
  if (ghostModel) { scene.remove(ghostModel.root); ghostModel.dispose(); ghostModel = null; }
  ghost = stage.kind !== 'practice' ? loadGhost(stage.seed) : null;
  if (ghost && ghostOn) {
    ghostModel = buildCarModel(CARS[ghost.car] || CARS[carId], { ghost: true, color: ghost.color || '#9fe3ff' });
    scene.add(ghostModel.root);
  }
}
function updateGhost() {
  if (!ghostModel) return;
  const t = run.state === 'running' || run.state === 'finished' ? run.t : 0;
  samplePose(ghost.samples, t, ghostPose);
  const r = ghostModel.root;
  r.position.set(ghostPose.x, ghostPose.y, ghostPose.z);
  r.rotation.order = 'YXZ';
  r.rotation.set(-Math.atan(ghostPose.pitch), ghostPose.yaw, ghostPose.roll);
}

function restartRun() {
  recorder.reset();
  run.state = stage.kind === 'practice' ? 'free' : 'ready';
  run.t = 0; run.next = 0; run.splits = []; run.penalty = 0; run.respawns = 0;
  best = loadBest();
  placeOnRoad(stage.kind === 'practice' ? 0 : road.indexAt(stage.start - 14));
  $('finish').hidden = true;
  refreshGhost();
  refreshStageHud();
}

// Back to the last checkpoint passed (or the start line) with a time penalty.
function respawn() {
  const along = run.next > 0 ? stage.cps[run.next - 1] + 4 : Math.max(stage.start - 14, 2);
  placeOnRoad(road.indexAt(along));
  if (run.state === 'running') {
    run.penalty += PENALTY; run.t += PENALTY; run.respawns++;
    toast(`+${PENALTY}s PENALTY`, 1300);
  } else toast('BACK ON THE ROAD', 1000);
  audio.thud(0.4);
}

// Called every physics step with the car's position along the road.
function updateRun(q, dt) {
  if (run.state === 'ready' && q.along >= stage.start && q.along < stage.start + 30) {
    run.state = 'running'; run.t = 0;
    audio.beep(880, 0.15);
  }
  if (run.state !== 'running') return;
  run.t += dt;
  const target = stage.cps[run.next];
  // The jump check stops a nearest-point flip across a hairpin counting as progress.
  if (q.along >= target && q.along - target < 30) passCheckpoint();
}

function passCheckpoint() {
  const k = run.next;
  run.splits.push(run.t);
  run.next++;
  const sectorTime = run.t - (k ? run.splits[k - 1] : 0);
  const delta = best ? run.t - best.splits[k] : null;
  if (k === SECTORS - 1) { finishRun(); return; }
  showSplit(`S${k + 1}`, sectorTime, delta);
  audio.beep(1040, 0.1, 'square', 0.18);
  refreshStageHud();
}

function finishRun() {
  run.state = 'finished';
  const isBest = !best || run.t < best.time;
  const prev = best;
  if (isBest) {
    best = { time: run.t, splits: run.splits.slice(), car: carId, date: Date.now() };
    saveBest(best);
    recorder.nextT = 0; recorder.record(run.t, car);   // final pose on the line
    saveGhost(stage.seed, { car: carId, color: model.paint.color.getStyle(), time: run.t, samples: recorder.samples });
  }
  audio.beep(660, 0.12); setTimeout(() => audio.beep(990, 0.25), 140);
  $('fin-stage').textContent = stageLabel();
  $('fin-time').textContent = fmt(run.t);
  $('fin-newbest').hidden = !isBest;
  $('fin-prev').textContent = prev ? `Best ${fmt(prev.time)} (${fmtDelta(run.t - prev.time)})` : 'First finish on this stage';
  $('fin-pen').textContent = run.respawns ? `Includes ${run.respawns} respawn${run.respawns > 1 ? 's' : ''}, +${run.penalty}s` : 'Clean run, no penalties';
  const rows = run.splits.map((t, k) => {
    const sec = t - (k ? run.splits[k - 1] : 0);
    const d = prev ? t - prev.splits[k] : null;
    return `<tr><td>S${k + 1}</td><td>${fmt(sec)}</td><td>${fmt(t)}</td><td class="${d == null ? '' : d < 0 ? 'good' : 'bad'}">${d == null ? '' : fmtDelta(d)}</td></tr>`;
  }).join('');
  $('fin-splits').innerHTML = `<tr><th>Sector</th><th>Time</th><th>Total</th><th>vs best</th></tr>${rows}`;
  setTimeout(() => { if (run.state === 'finished') $('finish').hidden = false; }, 900);
  refreshStageHud();
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

function stageLabel() {
  if (stage.kind === 'practice') return 'Practice loop';
  if (stage.kind === 'daily') {
    const d = new Date(Math.floor(stage.seed / 10000), Math.floor(stage.seed / 100) % 100 - 1, stage.seed % 100);
    return `${stage.name} · ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return `${stage.name} · #${stage.seed}`;
}
function refreshStageHud() {
  const timed = stage.kind !== 'practice';
  $('hud-stage').textContent = stageLabel();
  $('hud-timing').hidden = !timed;
  $('hud-best').textContent = fmt(best?.time) + (ghostModel ? ' · GHOST' : '');
  [...$('hud-sectors').children].forEach((el, k) => {
    el.classList.toggle('done', k < run.next);
    el.classList.toggle('now', run.state === 'running' && k === run.next);
  });
}
let splitTimer = 0;
function showSplit(label, sectorTime, delta) {
  const el = $('hud-split');
  el.innerHTML = `<span class="lbl">${label}</span> ${fmt(sectorTime)}` +
    (delta == null ? '' : ` <span class="${delta < 0 ? 'good' : 'bad'}">${fmtDelta(delta)}</span>`);
  el.classList.add('on');
  clearTimeout(splitTimer);
  splitTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

let hudAcc = 0;
function updateHud(dt) {
  hudAcc += dt;
  if (hudAcc < 1 / 30) return;
  hudAcc = 0;
  $('hud-speed').textContent = Math.round(car.speed * 3.6);
  if (stage.kind !== 'practice') $('hud-time').textContent = fmt(run.t);
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
  ['TUNE', 'tractionPull', 0, 1.2, 0.05],
  ['TUNE', 'driftBase', 0, 0.5, 0.01],
  ['TUNE', 'driftSteer', 0, 0.9, 0.01],
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

function start(kind = 'daily', seed) {
  audio.init();
  if (kind === 'daily') seed = dateSeed();
  if (kind === 'random' && seed == null) seed = 100000 + Math.floor(Math.random() * 900000);
  if (kind !== stage.kind || seed !== stage.seed || !road) loadStage(kind, seed);
  else restartRun();
  $('start').hidden = true;
  $('pause').hidden = true;
  $('hud').hidden = false;
  running = true;
  paused = false;
  toast(kind === 'practice' ? 'PRACTICE' : stage.name.toUpperCase(), 1400);
}
function toMenu() {
  running = false; paused = false;
  codriver.stop();
  $('pause').hidden = true; $('finish').hidden = true; $('hud').hidden = true;
  $('start').hidden = false;
  audio.suspend();
}
function setPaused(p) {
  if (!running) return;
  paused = p;
  $('pause').hidden = !p;
  if (p) codriver.stop();
  if (p) audio.suspend(); else audio.resume();
}
function resetCar() {
  if (stage.kind === 'practice') {
    const q = road.nearest(car.x, car.z, roadHint);
    placeOnRoad(q.i);
    audio.thud(0.3);
  } else respawn();
}
function restartKey() {
  if (stage.kind === 'practice') resetCar();
  else { restartRun(); toast('RESTART', 800); }
}

$('btn-daily').addEventListener('click', () => start('daily'));
$('btn-random').addEventListener('click', () => start('random'));
$('btn-practice').addEventListener('click', () => start('practice'));
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-reset').addEventListener('click', () => { resetCar(); setPaused(false); });
$('btn-restart').addEventListener('click', () => { restartKey(); setPaused(false); });
$('btn-pmenu').addEventListener('click', toMenu);
$('btn-retry').addEventListener('click', () => { restartRun(); });
$('btn-new').addEventListener('click', () => start('random'));
$('btn-fmenu').addEventListener('click', toMenu);
$('daily-name').textContent = `${stageName(dateSeed())} · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
function setAssist(on, level = assist.level) {
  assist.on = on; assist.level = level;
  $('opt-assist').checked = on;
  $('opt-assist-level').value = level;
  $('hud-assist').hidden = !on;
  $('hud-assist').textContent = `LINE ASSIST · ${level.toUpperCase()}`;
  saveAssist();
}
setAssist(assist.on, assist.level);
$('opt-assist').addEventListener('change', (e) => setAssist(e.target.checked));
$('opt-assist-level').addEventListener('change', (e) => { setAssist(true, e.target.value); e.target.blur(); });
// Mute: M key, the corner button or the pause menu. Remembered between visits.
let muted = false;
try { muted = localStorage.getItem('sideways.muted') === '1'; } catch { /* ignore */ }
function setMuted(m) {
  muted = m;
  audio.setMuted(m);
  codriver.muted = m;
  if (m) codriver.stop();
  $('btn-mute').setAttribute('aria-pressed', String(m));
  $('btn-mute').setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
  $('opt-mute').checked = m;
  try { localStorage.setItem('sideways.muted', m ? '1' : '0'); } catch { /* ignore */ }
}
setMuted(muted);
$('btn-mute').addEventListener('click', (e) => { audio.init(); setMuted(!muted); e.currentTarget.blur(); });
$('opt-mute').addEventListener('change', (e) => setMuted(e.target.checked));
$('opt-codriver').value = codriver.mode;
$('opt-codriver').addEventListener('change', (e) => {
  codriver.mode = e.target.value;
  codriver.stop();
  try { localStorage.setItem('sideways.codriver', codriver.mode); } catch { /* ignore */ }
  e.target.blur();
});
$('opt-ghost').checked = ghostOn;
$('opt-ghost').addEventListener('change', (e) => {
  ghostOn = e.target.checked;
  try { localStorage.setItem('sideways.ghostOn', ghostOn ? '1' : '0'); } catch { /* ignore */ }
  refreshGhost(); refreshStageHud();
});
$('opt-scan').addEventListener('change', (e) => document.body.classList.toggle('scanlines', e.target.checked));

input.on('key', (code, key) => {
  if (code === 'Escape') { if (running) setPaused(!paused); return; }
  if (key === '?' || code === 'Slash') { $('debug').hidden = !$('debug').hidden; return; }
  if (code === 'KeyM') { setMuted(!muted); toast(muted ? 'SOUND OFF' : 'SOUND ON', 800); return; }
  if (!running) { if (code === 'Enter') start('daily'); return; }
  if (paused) return;
  if (code === 'KeyC') toast(rig.cycle().toUpperCase() + ' CAM', 800);
  if (code === 'KeyG') { setAssist(!assist.on); toast(assist.on ? `LINE ASSIST ${assist.level.toUpperCase()}` : 'LINE ASSIST OFF', 1000); }
  if (code === 'KeyR') restartKey();
  if (code === 'KeyT') resetCar();
  const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(code);
  if (n >= 0) setCar(CAR_ORDER[n]);
});
input.on('action', (act) => {
  if (act === 'camera') toast(rig.cycle().toUpperCase() + ' CAM', 800);
  if (act === 'reset') restartKey();
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
  if (car.air) return;
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

// ---------- Tyre marks ----------
// Each wheel leaves a light scuff while it's on the gravel road; sliding
// wheels mark harder.
let roadLat = 0, roadLx = 1, roadLz = 0;
function layMarks() {
  const s = car.spec;
  const sn = Math.sin(car.yaw), cs = Math.cos(car.yaw);
  const y = car.y ?? 0;
  for (let w = 0; w < 4; w++) {
    const front = w < 2;
    const lx = (w % 2 ? -1 : 1) * s.track / 2, lz = front ? s.a : -s.b;
    const ox = sn * lz + cs * lx, oz = cs * lz - sn * lx;           // offset from car centre
    const lat = roadLat + ox * roadLx + oz * roadLz;                  // wheel's lateral on the road
    const on = !car.air && Math.abs(lat) < road.width / 2 && car.speed > 0.5;
    const strength = front ? car.frontSlide * 0.6 + car.brake * 0.2 : Math.max(car.rearSlide, car.brake * 0.3);
    marks.track(w, car.x + ox, y, car.z + oz, on, Math.min(1, strength));
  }
}

// ---------- Physics step ----------
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let offDist = 0;
// Ground height: the road surface near the road, blending onto the terrain.
function groundAt(x, z, lateralAbs, roadY) {
  const t = smoothstep(road.width / 2 + 1.5, road.width / 2 + 5, lateralAbs);
  return t <= 0 ? roadY : roadY * (1 - t) + terrain.heightAt(x, z) * t;
}
function stepPhysics(dt, inp) {
  const q = road.nearest(car.x, car.z, roadHint);
  roadHint = q.i;
  const lat = q.lateral, roadY = q.y, tx = q.tx, tz = q.tz;
  // A lap of the closed practice loop wraps the distance back to zero.
  if (road.closed && q.along < roadAlong - road.length / 2) codriver.seek(q.along);
  roadAlong = q.along;
  offDist = q.dist;
  // Far off the road: put the car back (at the last checkpoint on a stage).
  if (offDist > (stage.kind === 'practice' ? 40 : RESPAWN_DIST)) { resetCar(); return; }
  surface = road.surfaceAt(Math.abs(lat));
  roadLat = lat; roadLx = tz; roadLz = -tx;
  if (run.state === 'finished') { inp = { throttle: 0, brake: 0.35, steer: 0, handbrake: false }; }
  // Tiny hops over kinks in the ground keep their grip; real flights don't.
  const flying = car.air && car.airTime > 0.06;
  car.step(dt, inp, flying ? AIR : surface);
  if (flying) {
    // A little air control, and the spin bleeds off slowly.
    car.yawRate += inp.steer * 0.9 * dt;
    car.yawRate *= 1 - 0.6 * dt;
  } else applyLineAssist(q, dt);
  updateRun(q, dt);
  if (run.state === 'running') recorder.record(run.t, car);

  // Height and slope. Sample the ground ahead/behind and to the sides.
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  const latAbs = Math.abs(lat);
  const h0 = groundAt(car.x, car.z, latAbs, roadY);
  // Road slope along its tangent, plus terrain slope when off it.
  const iA = road.idx(roadHint - 1), iB = road.idx(roadHint + 1);
  const roadGrade = (road.py[iB] - road.py[iA]) / Math.max(1, road.cum[iB] - road.cum[iA] || 4);
  const along1 = fx * tx + fz * tz;    // how much the car points along the road
  const offT = smoothstep(road.width / 2 + 1.5, road.width / 2 + 5, latAbs);
  let pitch = roadGrade * along1, roll = 0;
  if (offT > 0) {
    const hf = terrain.heightAt(car.x + fx * 1.6, car.z + fz * 1.6), hb = terrain.heightAt(car.x - fx * 1.6, car.z - fz * 1.6);
    const hl = terrain.heightAt(car.x + fz * 0.9, car.z - fx * 0.9), hr = terrain.heightAt(car.x - fz * 0.9, car.z + fx * 0.9);
    pitch = pitch * (1 - offT) + ((hf - hb) / 3.2) * offT;
    roll = ((hl - hr) / 1.8) * offT;
  }
  // Vertical motion: follow the ground until it falls away faster than
  // gravity can pull the car down, then fly until it catches up.
  const G = 9.81;
  if (!car.air) {
    const vyGround = (h0 - car.y) / dt;
    const needAccel = (vyGround - car.vy) / dt;
    if (needAccel < -G - 4 && car.speed > 6) {
      car.air = true; car.airTime = 0;
    } else {
      car.vy = vyGround;
      car.y = h0;
    }
  }
  if (car.air) {
    car.airTime += dt;
    car.vy -= G * dt;
    car.y += car.vy * dt;
    // Nose follows the arc; the body levels out across.
    car.groundPitch = Math.atan2(car.vy, Math.max(car.speed, 1)) * 0.8;
    car.groundRoll *= 1 - 2 * dt;
    if (car.y <= h0) {
      const vyGround = pitch * car.vF;
      const impact = Math.max(0, vyGround - car.vy);
      car.y = h0; car.vy = vyGround; car.air = false;
      if (car.airTime > 0.12) onLanding(impact);
    }
    return;
  }
  car.groundPitch = Math.atan(pitch);
  car.groundRoll = Math.atan(roll);
  // Gravity along the slope: uphill slows you, downhill speeds you up.
  const g = G * pitch / Math.sqrt(1 + pitch * pitch);
  car.vx -= fx * g * dt;
  car.vz -= fz * g * dt;
}
const AIR = { name: 'air', grip: 0.02, drag: 0, dust: [0.7, 0.6, 0.5] };

// Landing: thump, dust, camera kick and a body squash, scaled by impact speed.
let shakeKick = 0;
function onLanding(impact) {
  if (impact < 1.5) return;
  const k = Math.min(1, impact / 8);
  shakeKick = Math.max(shakeKick, 0.06 + k * 0.3);
  car.squash = 0.04 + k * 0.1;
  audio.thud(0.25 + k * 0.6);
  if (impact > 9) { car.vx *= 0.88; car.vz *= 0.88; }   // a heavy landing costs speed
  const col = surface.dust;
  for (let n = 0; n < 10 + k * 26; n++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4 * k;
    dust.emit(car.x + Math.cos(a) * 1.2, car.y + 0.2, car.z + Math.sin(a) * 1.8,
      car.vx * 0.3 + Math.cos(a) * sp, 0.8 + Math.random() * 1.5, car.vz * 0.3 + Math.sin(a) * sp,
      1 + Math.random() * 1.2, 1.4 + Math.random(), col);
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
      stepPhysics(STEP, input.update(STEP));
      acc -= STEP;
    }
    emitDust(dt);
    layMarks();
    marks.flush();
    if (run.state !== 'finished') codriver.update(roadAlong, car.speed);
  }

  model.update(car, dt);
  updateGhost();
  world.follow(car.x, car.z);
  shakeKick *= Math.exp(-dt * 7);
  car.squash = (car.squash || 0) * Math.exp(-dt * 9);
  rig.shake = active ? (car.air ? 0 : (surface === SURFACES.grass ? 0.05 : 0.012) * Math.min(car.speed / 25, 1)) + shakeKick : 0;
  rig.update(car, dt);
  world.sky.position.copy(camera.position);
  if (!paused) dust.update(dt);
  audio.update(car, car.air && car.airTime > 0.06 ? AIR : surface, dt, active);
  if (running) updateHud(dt);
  renderer.render(scene, camera);
}
// Boot: build today's stage behind the menu, then start the loop.
loadStage('daily', dateSeed());
requestAnimationFrame(frame);

// Exposed for automated smoke tests.
function stepSim(seconds, inp) {
  for (let t = 0; t < seconds; t += STEP) {
    stepPhysics(STEP, inp);
    emitDust(STEP);
    layMarks();
    dust.update(STEP);
  }
  marks.flush();
  model.update(car, 0.2);
  rig.snap(car);
}
window.__sideways = {
  codriver,
  get ghostModel() { return ghostModel; }, recorder, loadGhost, onLanding, renderer, scene, camera, marks, assist, setAssist, car, input, TUNE, CARS, start, stepSim, placeOnRoad, loadStage, run, stage,
  get road() { return road; }, get terrain() { return terrain; }, get lineMesh() { return lineMesh; }, get surface() { return surface; }, get best() { return best; },
};
