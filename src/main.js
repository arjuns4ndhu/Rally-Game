// Sideways: build 2, seeded daily / random stages plus the practice loop.
import * as THREE from 'three';
import { CarPhysics, CARS, CAR_ORDER, TUNE } from './car.js';
import { buildCarModel } from './carModel.js';
import { Road, createTestRoad, gravelTexture, SURFACES, findShortcuts } from './track.js';
import { generateStage, stageName } from './stagegen.js';
import { buildGate, buildSign, buildCornerWarnings } from './gates.js';
import { dateSeed } from './rng.js';
import { THEMES, pickTheme } from './themes.js';
import { setupWorld, buildScenery } from './scenery.js';
import { CameraRig } from './camera.js';
import { Dust } from './particles.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { TyreMarks, buildRacingMarks } from './tyremarks.js';
import { GhostRecorder, saveGhost, loadGhost, samplePose } from './ghost.js';
import { buildPaceNotes, CoDriver } from './pacenotes.js';
import { notesHTML } from './paceicons.js';
import { Drone } from './drone.js';
import { buildHazards, HAZARD_DEBUG } from './hazards.js';

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
const drone = new Drone(scene);
rig.drone = drone;
rig.groundAt = (x, z) => worldGround(x, z);
const dust = new Dust(scene);
const marks = new TyreMarks(scene);
const audio = new AudioEngine();
const input = new Input();
let noteTimer = 0;
// Pace-note signs (DiRT Rally style) across the top of the screen.
const codriver = new CoDriver((list) => {
  const el = $('hud-note');
  el.innerHTML = notesHTML(list);
  el.setAttribute('aria-label', list.map((n) => n.text).join(', '));
  el.classList.add('on');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => el.classList.remove('on'), 3600);
});
codriver.mode = 'signs';
try { if (localStorage.getItem('sideways.codriver') === 'off') codriver.mode = 'off'; } catch { /* ignore */ }

// ---------- Stage ----------
// A stage is a road plus everything built around it. Loading a new one
// disposes the old meshes.
const gravelMat = new THREE.MeshStandardMaterial({ map: gravelTexture(THEMES.forest.road), roughness: 0.95 });
const vergeMat = new THREE.MeshStandardMaterial({ color: 0x6e6340, roughness: 1 });
let roadTheme = 'forest';
const SECTORS = 5;
const PENALTY = 5;            // seconds added for a respawn
const RESPAWN_DIST = 50;      // metres off the road before you're put back
let road = null, terrain = null, stageGroup = null, lineMesh = null;
let hazards = null;  // rare fallen trees / landslides
let shortcuts = [];   // Road objects for rough cut-through tracks
const trackMat = new THREE.MeshStandardMaterial({ roughness: 1 });
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
  const { theme, hilliness } = kind === 'practice' ? { theme: THEMES.forest, hilliness: 1 } : pickTheme(seed);
  stage.theme = theme;
  world.applyTheme(theme);
  if (roadTheme !== theme.id) {
    gravelMat.map.dispose();
    gravelMat.map = gravelTexture(theme.road);
    gravelMat.needsUpdate = true;
    roadTheme = theme.id;
  }
  vergeMat.color.setHex(theme.road.verge);
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
  // Surface grip and dust colour follow the theme (packed snow is slippery).
  road.surfaces = {
    gravel: { ...SURFACES.gravel, grip: theme.road.grip, dust: theme.road.dust },
    verge: { ...SURFACES.verge, grip: SURFACES.verge.grip * theme.road.grip, dust: theme.road.dust },
    grass: { ...SURFACES.grass, dust: theme.road.dust },
  };
  // Shortcuts (stages only): rough tracks across where the road doubles back.
  let cuts = [];
  if (kind !== 'practice') {
    const st = 24, fin = road.length - runout;
    const cps = [1, 2, 3, 4].map((k) => st + (fin - st) * k / SECTORS);
    cuts = findShortcuts(road, { checkpoints: cps, start: st, finish: fin });
  }
  const built = buildScenery(road, kind === 'practice' ? 1 : seed, { flat, theme, hilliness, avoid: cuts.map((c) => c.pts) });
  terrain = built.terrain;
  buildObstacleGrid(built.obstacles);
  stageGroup.add(built.group);
  // Verge shoulders slope from the road edge down to the ground on each side.
  stageGroup.add(road.buildShoulders(terrain.heightAt, road.width / 2 - 0.2, road.width / 2 + SHOULDER, vergeMat));
  // Shortcut tracks follow the ground; darker, rutted dirt.
  if (trackMat.map) trackMat.map.dispose();
  trackMat.map = gravelTexture({ base: '#6f5a42', rut: [40, 30, 20], edge: [50, 60, 30], stone: [10, 0, -10] });
  trackMat.color.set(theme.id === 'snow' ? 0xdfe6ee : 0xffffff);
  trackMat.needsUpdate = true;
  shortcuts = cuts.map((c) => {
    // Follow the ground, easing up to road level where it joins the road.
    const pts = c.pts.map(([x, z]) => {
      const nr = terrain.nearestRoad(x, z);
      const t = nr ? smoothstep(road.width / 2, road.width / 2 + 6, nr.d) : 1;
      const yRoad = nr ? road.py[nr.i] - 0.03 : 0;
      return [x, yRoad * (1 - t) + terrain.heightAt(x, z) * t, z];
    });
    const sc = new Road(pts, { width: 4.6, spacing: 2 });
    sc.hint = -1;
    // Only draw it where it's off the road surface (no dark patch on the gravel).
    let from = 0, to = sc.n;
    while (from < sc.n - 1 && road.nearest(sc.px[from], sc.pz[from], -1).dist < road.width / 2 - 0.3) from++;
    while (to > from + 1 && road.nearest(sc.px[to - 1], sc.pz[to - 1], -1).dist < road.width / 2 - 0.3) to--;
    stageGroup.add(sc.buildOffsetStrip(() => 0, sc.width, 0.06, trackMat, 1 / 10, Math.max(0, from - 1), Math.min(sc.n, to + 1)));
    return sc;
  });
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
  hazards = kind === 'practice' ? null : buildHazards(road, {
    seed, theme, groundY: worldGround, start: stage.start, finish: stage.finish, cps: stage.cps, corners: road.findSharpCorners(),
  });
  if (hazards) stageGroup.add(hazards.group);
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
rig.roofH = model.roofH;
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
  stuckTime = 0;
  roadHint = i;
  roadAlong = road.cum[i];
  codriver.seek(roadAlong);
  dust.clear();
  marks.cut();
  drone.snap(car, worldGround);
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
  ghostHint = -1;
  if (ghostModel) { scene.remove(ghostModel.root); ghostModel.dispose(); ghostModel = null; }
  ghost = stage.kind !== 'practice' ? loadGhost(stage.seed) : null;
  if (ghost) ghostToLift(ghost.samples);
  if (ghost && ghostOn) {
    ghostModel = buildCarModel(CARS[ghost.car] || CARS[carId], { ghost: true, color: ghost.color || '#9fe3ff' });
    scene.add(ghostModel.root);
  }
}
// Replace each sample's height with its lift above today's ground. Ghosts
// recorded before the road heights changed are off by a slowly varying
// amount; subtracting the lowest offset nearby removes that and keeps the
// quick rises from jumps and crests.
function ghostToLift(samples) {
  let hint = -1;
  const off = samples.map((sm) => {
    const q = road.nearest(sm[1], sm[3], hint);
    hint = q.i;
    return sm[2] - groundAt(sm[1], sm[3], Math.abs(q.lateral), q.y);
  });
  const WIN = 30;   // samples either side (1.5 s at 20 Hz)
  for (let i = 0; i < samples.length; i++) {
    let base = Infinity;
    for (let j = Math.max(0, i - WIN); j <= Math.min(samples.length - 1, i + WIN); j++) base = Math.min(base, off[j]);
    samples[i][2] = Math.max(0, off[i] - base);
  }
}
let ghostHint = -1;
function updateGhost() {
  if (!ghostModel) return;
  const t = run.state === 'running' || run.state === 'finished' ? run.t : 0;
  samplePose(ghost.samples, t, ghostPose);
  const r = ghostModel.root;
  // Today's ground plus the recorded lift (see ghostToLift).
  const q = road.nearest(ghostPose.x, ghostPose.z, ghostHint);
  ghostHint = q.i;
  const ground = groundAt(ghostPose.x, ghostPose.z, Math.abs(q.lateral), q.y);
  r.position.set(ghostPose.x, ground + ghostPose.y, ghostPose.z);
  r.rotation.order = 'YXZ';
  r.rotation.set(-Math.atan(ghostPose.pitch), ghostPose.yaw, ghostPose.roll);
}

function restartRun() {
  recorder.reset();
  run.state = stage.kind === 'practice' ? 'free' : 'ready';
  run.t = 0; run.next = 0; run.splits = []; run.penalty = 0; run.respawns = 0;
  best = loadBest();
  hazards?.reset();
  model.repair();
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
  rig.roofH = model.roofH;
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
  $('btn-mute').setAttribute('aria-pressed', String(m));
  $('btn-mute').setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
  $('opt-mute').checked = m;
  try { localStorage.setItem('sideways.muted', m ? '1' : '0'); } catch { /* ignore */ }
}
setMuted(muted);
$('btn-mute').addEventListener('click', (e) => { audio.init(); setMuted(!muted); e.currentTarget.blur(); });
$('opt-mute').addEventListener('change', (e) => setMuted(e.target.checked));
// Master volume (pause menu), remembered between visits.
function setVolume(pct) {
  audio.setVolume(pct / 100);
  $('opt-volume').value = pct;
  $('opt-volume-val').textContent = `${pct}%`;
  try { localStorage.setItem('sideways.volume', String(pct)); } catch { /* ignore */ }
}
let volume = 80;
try { const v = parseInt(localStorage.getItem('sideways.volume'), 10); if (v >= 0 && v <= 100) volume = v; } catch { /* ignore */ }
setVolume(volume);
$('opt-volume').addEventListener('input', (e) => { audio.init(); setVolume(+e.target.value); });
$('opt-codriver').value = codriver.mode;
$('opt-codriver').addEventListener('change', (e) => {
  codriver.mode = e.target.value;
  if (codriver.mode === 'off') $('hud-note').classList.remove('on');
  try { localStorage.setItem('sideways.codriver', codriver.mode); } catch { /* ignore */ }
  e.target.blur();
});
$('opt-ghost').checked = ghostOn;
$('opt-ghost').addEventListener('change', (e) => {
  ghostOn = e.target.checked;
  try { localStorage.setItem('sideways.ghostOn', ghostOn ? '1' : '0'); } catch { /* ignore */ }
  refreshGhost(); refreshStageHud();
});
let droneOn = true;
try { droneOn = localStorage.getItem('sideways.drone') !== '0'; } catch { /* ignore */ }
drone.enabled = droneOn;
$('opt-drone').checked = droneOn;
$('opt-drone').addEventListener('change', (e) => {
  drone.enabled = e.target.checked;
  try { localStorage.setItem('sideways.drone', e.target.checked ? '1' : '0'); } catch { /* ignore */ }
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
  const off = surface.name === 'grass';
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

// ---------- Crashes ----------
// Tree trunks and big rocks are solid. A hard hit is a crash: a thump, dust
// and a big loss of speed, but you keep going. Light knocks just bounce you
// off. R still restarts from the start.
const OB_CELL = 10, CAR_R = 0.85, CRASH_SPEED = 8.5;   // m/s into the obstacle (~30 km/h)
let obGrid = new Map(), stuckTime = 0, hazardObs = [];
function buildObstacleGrid(list) {
  obGrid = new Map();
  for (const o of list) {
    const k = `${Math.floor(o.x / OB_CELL)},${Math.floor(o.z / OB_CELL)}`;
    if (!obGrid.has(k)) obGrid.set(k, []);
    obGrid.get(k).push(o);
  }
}
function collide() {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), off = car.spec.length * 0.3;
  for (const k of [off, 0, -off]) {
    const cx = car.x + fx * k, cz = car.z + fz * k;
    const gx = Math.floor(cx / OB_CELL), gz = Math.floor(cz / OB_CELL);
    const lists = hazardObs.length ? [hazardObs] : [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = obGrid.get(`${gx + dx},${gz + dz}`);
      if (l) lists.push(l);
    }
    for (const list of lists) {
      for (const o of list) {
        const ex = cx - o.x, ez = cz - o.z, d = Math.hypot(ex, ez), min = CAR_R + o.r;
        if (d >= min || d < 1e-4) continue;
        const nx = ex / d, nz = ez / d;
        car.x += nx * (min - d); car.z += nz * (min - d);       // push out
        const vn = car.vx * nx + car.vz * nz;
        if (vn >= 0) continue;
        const impact = -vn;
        // Bounce: kill the speed into it, scrub some along it, add a little spin.
        // A hard hit is a crash: much bigger speed loss, but you carry on.
        const hard = impact > CRASH_SPEED;
        if (impact > 3) dentAt(cx - nx * CAR_R, cz - nz * CAR_R, Math.min(hard ? 0.26 : 0.12, impact * 0.013));
        car.vx -= 1.15 * vn * nx; car.vz -= 1.15 * vn * nz;
        const keep = hard ? 0.35 : 0.8;
        car.vx *= keep; car.vz *= keep;
        if (hard) { crash(impact); continue; }
        car.yawRate += (fx * nz - fz * nx) * impact * 0.12 * Math.sign(k || 1);
        audio.thud(Math.min(0.8, 0.15 + impact / 12));
        shakeKick = Math.max(shakeKick, Math.min(0.3, impact * 0.03));
      }
    }
  }
}
// Cosmetic dent where the car touched something (world x/z).
function dentAt(wx, wz, depth) {
  const dx = wx - car.x, dz = wz - car.z, c = Math.cos(car.yaw), sn = Math.sin(car.yaw);
  model.dent(dx * c - dz * sn, 0.5 + Math.random() * 0.3, dx * sn + dz * c, depth);
}
function crash(impact) {
  car.yawRate += (Math.random() - 0.5) * Math.min(3, impact * 0.15);
  audio.thud(1);
  shakeKick = 0.45;
  dust.clear();
  for (let n = 0; n < 40; n++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
    dust.emit(car.x, (car.y ?? 0) + 0.6, car.z, Math.cos(a) * sp, 1 + Math.random() * 2, Math.sin(a) * sp, 1.4, 1.6, [0.55, 0.5, 0.42]);
  }
  toast('CRASH!', 900);
}

// ---------- Physics step ----------
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let offDist = 0;
// Ground height: the road surface near the road, blending onto the terrain.
// Matches the shoulder strips: flat to the road edge, then a straight slope
// to the ground SHOULDER metres out.
const SHOULDER = 3.6;
function shoulderT(lateralAbs) {
  return Math.max(0, Math.min(1, (lateralAbs - road.width / 2) / SHOULDER));
}
function groundAt(x, z, lateralAbs, roadY) {
  const t = shoulderT(lateralAbs);
  return t <= 0 ? roadY : roadY * (1 - t) + terrain.heightAt(x, z) * t;
}
function stepPhysics(dt, inp) {
  const q = road.nearest(car.x, car.z, roadHint);
  roadHint = q.i;
  const lat = q.lateral, roadY = q.y, tx = q.tx, tz = q.tz;
  // A lap of the closed practice loop wraps the distance back to zero.
  if (road.closed && q.along < roadAlong - road.length / 2) codriver.seek(q.along);
  // Rejoining from a shortcut skips ahead: don't flash the missed pace notes.
  if (q.along - roadAlong > 40) codriver.seek(q.along);
  roadAlong = q.along;
  offDist = q.dist;
  // On a shortcut track? Then it's fine to be far from the main road.
  onShortcut = false;
  for (const sc of shortcuts) {
    const qs = sc.nearest(car.x, car.z, sc.hint);
    sc.hint = qs.i;
    if (qs.dist < sc.width / 2 + 0.8) { onShortcut = true; break; }
  }
  // Far off the road: put the car back (at the last checkpoint on a stage).
  if (!onShortcut && offDist > (stage.kind === 'practice' ? 80 : RESPAWN_DIST)) { resetCar(); return; }
  surface = onShortcut ? SHORTCUT : road.surfaceAt(Math.abs(lat));
  if (hazards) {
    if (run.state !== 'finished') hazards.update(dt, roadAlong, hazardFx);
    hazardObs = hazards.obstacles();
    if (hazards.rubbleAt(car.x, car.z)) surface = RUBBLE;
  } else hazardObs = [];
  roadLat = lat; roadLx = tz; roadLz = -tx;
  if (run.state === 'finished') { inp = { throttle: 0, brake: 0.35, steer: 0, handbrake: false }; }
  // Tiny hops over kinks in the ground keep their grip; real flights don't.
  const flying = car.air && car.airTime > 0.06;
  car.step(dt, inp, flying ? AIR : surface);
  collide();
  // Stuck off the road (crawling for 4 s while trying to drive): put back.
  if (q.dist > road.width / 2 + 3 && car.speed < 1.5 && (inp.throttle > 0.5 || inp.brake > 0.5) ) {
    stuckTime += dt;
    if (stuckTime > 4) { stuckTime = 0; toast('STUCK', 900); resetCar(); return; }
  } else stuckTime = 0;
  if (flying) {
    // A little air control, and the spin bleeds off slowly.
    car.yawRate += inp.steer * 0.5 * dt;
    car.yawRate *= Math.exp(-3 * dt);   // no grip to keep it spinning
  } else if (!onShortcut) applyLineAssist(q, dt);
  updateRun(q, dt);
  if (run.state === 'running') recorder.record(run.t, car);

  // Height and slope.
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  const latAbs = Math.abs(lat);
  const h0 = groundAt(car.x, car.z, latAbs, roadY);
  const along1 = fx * tx + fz * tz;    // how much the car points along the road
  const offT = shoulderT(latAbs);
  const lx = tz, lz = -tx;
  // Ground height near the car, using the road frame found above so it
  // matches the road surface and shoulders exactly.
  const groundNear = (dx, dz) => {
    const la = lat + dx * lx + dz * lz;
    return groundAt(car.x + dx, car.z + dz, Math.abs(la), roadHeightAlong(roadAlong + dx * tx + dz * tz));
  };
  // Ground gradient (rise per metre in x and z), from central differences.
  const E = 1.2;
  const gx = (groundNear(E, 0) - groundNear(-E, 0)) / (2 * E);
  const gz = (groundNear(0, E) - groundNear(0, -E)) / (2 * E);
  const pitch = gx * fx + gz * fz;            // uphill along the nose
  const rollT = gx * fz - gz * fx;            // rise toward the car's left
  const G = 9.81;
  // Only real jumps and crests on the road can launch the car; everywhere
  // else it stays planted, however steep or lumpy the ground is.
  let launchZone = false;
  if (offT < 0.5 && !onShortcut) {
    for (const bp of road.bumps || []) {
      const rel = roadAlong - bp.at;
      if (bp.kind === 'jump' ? rel > -4 && rel < 7 : Math.abs(rel) < bp.len / 2 + 3) { launchZone = true; break; }
    }
  }
  if (!car.air) {
    const vyGround = gx * car.vx + gz * car.vz;
    let launch = false;
    if (launchZone && car.speed > 6) {
      const W = 4;
      const yBack = roadHeightAlong(roadAlong - W * along1), yMid = roadHeightAlong(roadAlong), yFwd = roadHeightAlong(roadAlong + W * along1);
      const curv = (yBack - 2 * yMid + yFwd) / (W * W);
      launch = curv * car.vF * car.vF < -G * 1.7;
    }
    car.vy = vyGround;
    if (launch) { car.air = true; car.airTime = 0; }
    else car.y = h0;
  }
  if (car.air) {
    car.airTime += dt;
    car.vy -= G * dt;
    car.y += car.vy * dt;
    // Nose follows the arc; the body levels out across.
    car.groundPitch = Math.atan2(car.vy, Math.max(car.speed, 1)) * 0.8;
    car.groundRoll *= 1 - 2 * dt;
    if (car.y <= h0) {
      const vyGround = gx * car.vx + gz * car.vz;
      const impact = Math.max(0, vyGround - car.vy);
      car.y = h0; car.vy = vyGround; car.air = false;
      if (car.airTime > 0.12) { settleLanding(inp); onLanding(impact); }
    }
    return;
  }
  // Body follows the slope, smoothed so lumpy ground doesn't make it shake.
  const kS = 1 - Math.exp(-dt * 14);
  car.groundPitch += (Math.atan(pitch) - car.groundPitch) * kS;
  car.groundRoll += (Math.atan(rollT) - car.groundRoll) * kS;
  // Gravity pulls straight down the slope (not along the nose), so a car
  // sliding sideways on a hill drifts downhill naturally.
  const gg = G / Math.sqrt(1 + gx * gx + gz * gz);
  car.vx -= gx * gg * dt;
  car.vz -= gz * gg * dt;
}
// Road surface height at a distance along the centreline.
function roadHeightAlong(sAlong) {
  if (road.closed) sAlong = ((sAlong % road.length) + road.length) % road.length;
  sAlong = Math.max(0, Math.min(road.length - 0.01, sAlong));
  const i = Math.max(1, road.indexAt(sAlong));
  const s0 = road.cum[i - 1], s1 = road.cum[i];
  const t = s1 > s0 ? (sAlong - s0) / (s1 - s0) : 0;
  return road.py[i - 1] + (road.py[i] - road.py[i - 1]) * Math.max(0, Math.min(1, t));
}
// Landslide dirt: loose and draggy.
const RUBBLE = { name: 'rubble', grip: 0.7, drag: 0.35, dust: [0.6, 0.52, 0.42] };
const hazardFx = {
  dust: (...a) => dust.emit(...a),
  thud: (v) => audio.thud(v),
  shake: (v) => { shakeKick = Math.max(shakeKick, v); },
  creak: () => { audio.thud(0.25); toast('TREE DOWN!', 1200); },
  rumble: () => { audio.thud(0.7); setTimeout(() => audio.thud(0.5), 250); setTimeout(() => audio.thud(0.6), 600); toast('LANDSLIDE!', 1200); },
};
// Ground height anywhere (road, shoulders or terrain), for the camera,
// drone and hazards.
function worldGround(x, z) {
  if (!terrain) return 0;
  const nr = terrain.nearestRoad(x, z);
  if (!nr) return terrain.heightAt(x, z);
  return groundAt(x, z, nr.d, road.py[nr.i]);
}
const AIR = { name: 'air', grip: 0.02, drag: 0, dust: [0.7, 0.6, 0.5] };
// Shortcut tracks: rough and loose, a gamble against the distance saved.
const SHORTCUT = { name: 'track', grip: 0.82, drag: 0.07, dust: [0.5, 0.42, 0.32] };
let onShortcut = false;

// After a flight, line the car up with where it's going unless the player is
// clearly steering into a slide, so a landing doesn't fling you off the road.
function settleLanding(inp) {
  const vh = Math.atan2(car.vx, car.vz);
  let b = vh - car.yaw;
  b = Math.atan2(Math.sin(b), Math.cos(b));
  const keep = Math.abs(inp.steer) > 0.5 ? 0.6 : 0.2;     // fraction of slip kept
  car.yaw = vh - b * keep;
  car.yawRate *= 0.3;
  car.drifting = false;
}

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
      stepPhysics(STEP, window.__sideways?.auto ? window.__sideways.auto() : input.update(STEP));
      acc -= STEP;
    }
    emitDust(dt);
    layMarks();
    marks.flush();
    if (run.state !== 'finished') codriver.update(roadAlong, car.speed);
  }

  model.update(car, dt);
  updateGhost();
  world.follow(car.x, car.y ?? 0, car.z);
  shakeKick *= Math.exp(-dt * 7);
  car.squash = (car.squash || 0) * Math.exp(-dt * 9);
  rig.shake = active ? (car.air ? 0 : (surface.name === 'grass' ? 0.05 : 0.012) * Math.min(car.speed / 25, 1)) + shakeKick : 0;
  drone.hidden = rig.mode === 'drone';
  if (!paused) drone.update(car, dt, worldGround);
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
  drone.snap(car, worldGround);
  rig.snap(car);
}
window.__sideways = {
  auto: null, drone, rig, HAZARD_DEBUG, get model() { return model; }, get hazards() { return hazards; }, worldGround,
  get shortcuts() { return shortcuts; }, get onShortcut() { return onShortcut; },
  get obstacleCount() { let n = 0; obGrid.forEach((l) => (n += l.length)); return n; }, collide,
  codriver,
  get ghostModel() { return ghostModel; }, recorder, loadGhost, onLanding, renderer, scene, camera, marks, assist, setAssist, car, input, TUNE, CARS, start, stepSim, placeOnRoad, loadStage, run, stage,
  get road() { return road; }, get terrain() { return terrain; }, get lineMesh() { return lineMesh; }, get surface() { return surface; }, get best() { return best; },
};
