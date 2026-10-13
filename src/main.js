// Sideways: build 2, seeded daily / random stages plus the practice loop.
import * as THREE from 'three';
import { CarPhysics, CARS, CAR_ORDER, TUNE } from './car.js';
import { buildCarModel } from './carModel.js';
import { Road, createTestRoad, gravelTexture, SURFACES, findShortcuts } from './track.js';
import { generateStage, stageName } from './stagegen.js';
import { buildGate, buildSign, buildCornerWarnings, buildShortcutMarkers } from './gates.js';
import { dateSeed } from './rng.js';
import { THEMES, pickTheme } from './themes.js';
import { setupWorld, buildScenery } from './scenery.js';
import { CameraRig, TVCamera } from './camera.js';
import { Dust } from './particles.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { TyreMarks, buildRacingMarks } from './tyremarks.js';
import { GhostRecorder, saveGhost, loadGhost, samplePose } from './ghost.js';
import { buildPaceNotes, CoDriver } from './pacenotes.js';
import { notesHTML } from './paceicons.js';
import { Drone } from './drone.js';
import { facet, enableWobble, RetroPass, RETRO } from './retro.js';

// Retro settings: low-res pixels, dithered colour, vertex wobble.
const retroSet = { on: true, pixels: 'light', dither: true, wobble: true };
try { Object.assign(retroSet, JSON.parse(localStorage.getItem('sideways.retro') || '{}')); } catch { /* ignore */ }
RETRO.on = retroSet.on !== false;             // master switch: triangles, textures, pixels, dither, wobble
if (RETRO.on && retroSet.wobble) enableWobble();          // must happen before anything compiles
const RETRO_LINES = { off: 0, light: 360, heavy: 240 };
import { MiniMap } from './minimap.js';
import { Stats } from './stats.js';
import { Leaderboard } from './leaderboard.js';
import { buildTrackside } from './trackside.js';
import { WEATHER, pickWeather, weatherTheme, Precip, Rain } from './weather.js';
import { planSurfaces, patchAt, buildSurfaces } from './surfaces.js';
import { GaragePreview, garageStatsHTML, garageCarsHTML, calendarHTML, monthLabel, canGoMonth, weekInfo, champHTML, statsHTML, champIndex, champWeekOf, PAINTS, WHEELS, CLASSICS, MEDAL_ICON, classicOf, medalTimes, medalFor, classicsHTML } from './menus.js';
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
const tv = new TVCamera(camera);
const minimap = new MiniMap($('minimap'));
const stats = new Stats();
const board = new Leaderboard();
board.init();
const precip = new Precip(scene);
const rain = new Rain(scene);
// Headlights, used at night and dusk.
const headlights = [-1, 1].map(() => {
  const l = new THREE.SpotLight(0xfff0d0, 0, 90, 0.5, 0.55, 1.2);
  scene.add(l, l.target);
  return l;
});
let weather = WEATHER.clear, surfPlan = null;

// ---------- Graphics quality ----------
// Auto picks Medium on phones/tablets (Low on small ones) and High elsewhere.
const QUALITY = {
  high: { ratio: 1.75, shadows: 2048, detail: 1 },
  medium: { ratio: 1.25, shadows: 1024, detail: 0.7 },
  low: { ratio: 1, shadows: 0, detail: 0.45 },
};
let quality = 'auto';
try { quality = localStorage.getItem('sideways.quality') || 'auto'; } catch { /* ignore */ }
function qualityLevel() {
  if (quality !== 'auto') return quality;
  const touch = matchMedia('(pointer: coarse)').matches;
  if (!touch) return 'high';
  return (navigator.hardwareConcurrency || 4) <= 4 ? 'low' : 'medium';
}
function applyQuality() {
  const q = QUALITY[qualityLevel()];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.ratio));
  world.sun.castShadow = q.shadows > 0;
  if (q.shadows && world.sun.shadow.mapSize.x !== q.shadows) {
    world.sun.shadow.mapSize.set(q.shadows, q.shadows);
    world.sun.shadow.map?.dispose(); world.sun.shadow.map = null;
  }
  precip.density = q.detail;
}
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
const gravelMat = new THREE.MeshStandardMaterial({ map: gravelTexture(THEMES.forest.road), roughness: 0.95, vertexColors: true, flatShading: true });
const vergeMat = new THREE.MeshStandardMaterial({ color: 0x6e6340, roughness: 1, vertexColors: true, flatShading: true });
// Retro: per-triangle shading on a built mesh (or every mesh in a group).
function faceted(obj, amount) { obj.traverse((m) => { if (m.isMesh) m.geometry = facet(m.geometry, amount); }); return obj; }
let roadTheme = 'forest';
const SECTORS = 5;
const PENALTY = 5;            // seconds added for a respawn
const RESPAWN_DIST = 50;      // metres off the road before you're put back
let road = null, terrain = null, stageGroup = null, lineMesh = null;
let hazards = null;  // rare fallen trees / landslides
let trackside = null; // crowds, tape, hay bales, helicopter
let builtObstacles = [];
let shortcuts = [];   // Road objects for rough cut-through tracks
const trackMat = new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true, flatShading: true });
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
  weather = kind === 'practice' ? WEATHER.clear : pickWeather(seed, theme);
  if (window.__sideways?.forceWeather) weather = WEATHER[window.__sideways.forceWeather];
  stage.weather = weather;
  world.applyTheme(weatherTheme(theme, weather));
  precip.set(weather.id === 'snowfall' ? 'snow' : null);
  rain.set(weather.id === 'rain', precip.density ?? 1);
  const lamps = weather.dark ? 140 : weather.id === 'dusk' || weather.id === 'fog' ? 35 : 0;
  headlights.forEach((l) => { l.intensity = lamps; });
  // Wet gravel is darker and a little shiny.
  gravelMat.color.setScalar(weather.wet ? 0.7 : 1);
  gravelMat.roughness = weather.wet ? 0.6 : 0.95;
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
  const wg = weather.grip;
  road.surfaces = {
    gravel: { ...SURFACES.gravel, grip: theme.road.grip * wg, dust: theme.road.dust, dustK: weather.wet ? 0.35 : 1 },
    verge: { ...SURFACES.verge, grip: SURFACES.verge.grip * theme.road.grip * wg, dust: theme.road.dust, dustK: weather.wet ? 0.35 : 1 },
    grass: { ...SURFACES.grass, grip: SURFACES.grass.grip * wg, dust: theme.road.dust, dustK: weather.wet ? 0.35 : 1 },
  };
  // Shortcuts (stages only): rough tracks across where the road doubles back.
  let cuts = [];
  if (kind !== 'practice') {
    const st = 24, fin = road.length - runout;
    const cps = [1, 2, 3, 4].map((k) => st + (fin - st) * k / SECTORS);
    cuts = findShortcuts(road, { checkpoints: cps, start: st, finish: fin });
  }
  const built = buildScenery(road, kind === 'practice' ? 1 : seed, { flat, theme, hilliness, avoid: cuts.map((c) => c.pts), detail: QUALITY[qualityLevel()].detail });
  stage.detail = qualityLevel();
  terrain = built.terrain;
  builtObstacles = built.obstacles;
  buildObstacleGrid(built.obstacles);
  stageGroup.add(built.group);
  // Verge shoulders slope from the road edge down to the ground on each side.
  stageGroup.add(faceted(road.buildShoulders(terrain.heightAt, road.width / 2 - 0.2, road.width / 2 + SHOULDER, vergeMat), 0.1));
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
    stageGroup.add(faceted(sc.buildOffsetStrip(() => 0, sc.width, 0.06, trackMat, 1 / 10, Math.max(0, from - 1), Math.min(sc.n, to + 1)), 0.08));
    stageGroup.add(buildShortcutMarkers(road, sc));
    return sc;
  });
  stageGroup.add(faceted(road.buildRibbon(road.width, 0.03, gravelMat, 1 / 12), 0.05));
  // Tarmac sections, mud, puddles, ice or sand.
  surfPlan = null;
  if (kind !== 'practice') {
    const st = 24, fin = road.length - runout;
    surfPlan = planSurfaces(road, seed, { start: st, finish: fin, theme, weather });
    stageGroup.add(buildSurfaces(road, surfPlan));
  }
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
  hazards = kind === 'practice' || kind === 'classic' ? null : buildHazards(road, {
    seed, theme, groundY: worldGround, start: stage.start, finish: stage.finish, cps: stage.cps, corners: road.findSharpCorners(),
  });
  if (hazards) stageGroup.add(hazards.group);
  // Crowds and hay bales (timed stages only).
  trackside = null;
  if (kind !== 'practice') {
    trackside = buildTrackside(road, { seed, corners: road.findSharpCorners(), start: stage.start, finish: stage.finish, groundY: worldGround });
    stageGroup.add(trackside.group);
    buildObstacleGrid([...builtObstacles, ...trackside.obstacles]);
  }
  scene.add(stageGroup);
  minimap.build(road, kind === 'practice'
    ? { closed: true }
    : { start: stage.start, finish: stage.finish, cps: stage.cps, shortcuts });
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
// Garage choice (car, paint, wheels), remembered between visits.
const garage = { car: 'stiletto', color: '#e8542a', wheels: 'spoke' };
try { Object.assign(garage, JSON.parse(localStorage.getItem('sideways.garage') || '{}')); } catch { /* ignore */ }
if (!CARS[garage.car]) garage.car = 'stiletto';
if (!WHEELS.includes(garage.wheels)) garage.wheels = 'spoke';
function saveGarage() { try { localStorage.setItem('sideways.garage', JSON.stringify(garage)); } catch { /* ignore */ } }
let carId = garage.car;
const car = new CarPhysics(CARS[carId]);
let model = buildCarModel(CARS[carId], { color: garage.color, wheelStyle: garage.wheels, number: 7 });
scene.add(model.root);
rig.roofH = model.roofH;
audio.setCar(CARS[carId]);
$('hud-car').textContent = CARS[carId].name;
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
  // Only ever your own best run on this stage: it must match your saved best time.
  const mine = loadBest();
  if (ghost && !(mine && Math.abs(ghost.time - mine.time) < 0.05)) ghost = null;
  if (ghost) { ghostToLift(ghost.samples); ghost.alongs = ghostAlongs(ghost.samples); }
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
  const t = replay.on ? replay.t : run.state === 'running' || run.state === 'finished' ? run.t : 0;
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
  if (replay.on) { replay.on = false; $('hud-replay').hidden = true; document.body.classList.remove('replaying'); }
  recorder.reset();
  run.state = stage.kind === 'practice' ? 'free' : 'countdown';
  run.cd = 3.8; run.cdShown = null;
  run.t = 0; run.next = 0; run.splits = []; run.penalty = 0; run.respawns = 0;
  best = loadBest();
  hazards?.reset();
  resetRocks();
  model.repair();
  placeOnRoad(stage.kind === 'practice' ? 0 : road.indexAt(stage.start - 2.5));   // on the line
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
  // 3-2-1-GO from a standstill on the line; the clock starts on GO.
  if (run.state === 'countdown') {
    run.cd -= dt;
    const n = run.cd > 3 ? null : run.cd > 0 ? Math.ceil(run.cd) : 0;
    if (n !== run.cdShown) {
      run.cdShown = n;
      if (n != null) showCount(n ? String(n) : 'GO!', !n);
      if (n) audio.beep(520, 0.12, 'square', 0.16);
    }
    if (run.cd <= 0) {
      run.state = 'running'; run.t = 0;
      audio.beep(1040, 0.3, 'square', 0.2);
      stats.run();
      if (stage.kind === 'daily') stats.day(stage.seed);
    }
    return;
  }
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
  stats.finish(isBest);
  if (stage.kind !== 'practice' && isBest) board.submit(stage.seed, run.t, CARS[carId].name);
  lastResult = { time: run.t, splits: run.splits.slice(), prev, isBest, label: stageLabel(), respawns: run.respawns, car: CARS[carId].name };
  audio.beep(660, 0.12); setTimeout(() => audio.beep(990, 0.25), 140);
  $('fin-stage').textContent = stageLabel();
  renderBoard();
  $('btn-next').hidden = !(stage.kind === 'champ' && champIndex(stage.seed) < 5);
  $('btn-retry').classList.toggle('btn-primary', $('btn-next').hidden);
  // Classic stages: medal for this run, and the next target to chase.
  const cl = stage.kind === 'classic' ? classicOf(stage.seed) : null;
  const medal = cl ? medalFor(cl, run.t, stage.finish - stage.start) : null;
  lastResult.medal = medal;
  $('fin-medal').hidden = !cl;
  if (cl) {
    const m = medalTimes(cl, stage.finish - stage.start);
    const next = !medal ? ['bronze', m.bronze] : medal === 'bronze' ? ['silver', m.silver] : medal === 'silver' ? ['gold', m.gold] : null;
    $('fin-medal').innerHTML = (medal ? `${MEDAL_ICON[medal]} ${medal.toUpperCase()}` : 'NO MEDAL YET') +
      `<small>${next ? `${next[0][0].toUpperCase() + next[0].slice(1)} target: ${fmt(next[1])}` : 'Top medal. Now go faster than your mates.'}</small>`;
  }
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

function setCar(id, quiet = false) {
  carId = id;
  garage.car = id; saveGarage();
  scene.remove(model.root);
  model.dispose();
  car.setSpec(CARS[id]);
  model = buildCarModel(CARS[id], { color: garage.color, wheelStyle: garage.wheels, number: 7 });
  scene.add(model.root);
  rig.roofH = model.roofH;
  audio.setCar(CARS[id]);
  $('hud-car').textContent = CARS[id].name;
  if (!quiet) toast(`${CARS[id].name} · ${CARS[id].tag}`);
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
  if (stage.kind === 'classic') return `${stage.name} · Classic`;
  if (stage.kind === 'champ') return `${stage.name} · Championship ${champIndex(stage.seed)}/5`;
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
  const gap = ghostGap();
  const gEl = $('hud-gap');
  gEl.hidden = gap == null;
  if (gap != null) { gEl.textContent = fmtDelta(gap); gEl.className = `gap ${gap < 0 ? 'good' : 'bad'}`; }
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
  if (kind === 'daily' && seed == null) seed = dateSeed();
  if (kind === 'random' && seed == null) seed = 100000 + Math.floor(Math.random() * 900000);
  if (kind !== stage.kind || seed !== stage.seed || !road || stage.detail !== qualityLevel()) loadStage(kind, seed);
  else restartRun();
  $('start').hidden = true;
  $('pause').hidden = true;
  $('hud').hidden = false;
  minimap.rebuild();                 // sized now the HUD is showing
  running = true;
  paused = false;
  toast(kind === 'practice' ? 'PRACTICE' : stage.name.toUpperCase() + (weather.id !== 'clear' ? ` · ${weather.label.toUpperCase()}` : ''), 1600);
}
function toMenu() {
  running = false; paused = false;
  stats.save();
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
// Big 3-2-1-GO in the middle of the screen.
let countTimer = 0;
function showCount(text, go) {
  const el = $('hud-count');
  el.textContent = text;
  el.classList.toggle('go', !!go);
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  el.hidden = false;
  clearTimeout(countTimer);
  countTimer = setTimeout(() => { el.hidden = true; }, go ? 700 : 950);
}

// Copy a spoiler-free result to share: time plus a square per sector,
// green where you beat your previous best and red where you didn't.
let lastResult = null;
function shareText(r) {
  const squares = r.splits.map((t, k) => {
    if (!r.prev) return '⬜';
    const sec = t - (k ? r.splits[k - 1] : 0);
    const pb = r.prev.splits[k] - (k ? r.prev.splits[k - 1] : 0);
    return sec <= pb ? '🟩' : '🟥';
  }).join('');
  return [
    `SIDEWAYS · ${r.label}`,
    `⏱ ${fmt(r.time)}${r.medal ? ' ' + MEDAL_ICON[r.medal] : ''}${r.isBest && r.prev ? ' · NEW BEST' : ''}${r.respawns ? ` · ${r.respawns} reset${r.respawns > 1 ? 's' : ''}` : ''}`,
    `${squares} · ${r.car}`,
  ].join('\n');
}
async function copyResult() {
  if (!lastResult) return;
  const text = shareText(lastResult);
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  const b = $('btn-share');
  b.textContent = 'Copied!';
  setTimeout(() => { b.textContent = 'Copy result'; }, 1400);
}

// ---------- Shared leaderboard (claude.ai only) ----------
function localBests() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), m = /^sideways\.best\.(\d+)$/.exec(k);
      if (!m) continue;
      const b = JSON.parse(localStorage.getItem(k));
      if (b?.time) out[m[1]] = { time: b.time, car: CARS[b.car]?.name || '', date: b.date };
    }
  } catch { /* ignore */ }
  return out;
}
function renderBoard() {
  const box = $('fin-board');
  box.hidden = !(board.available && board.ready) || stage.kind === 'practice' || run.state !== 'finished';
  if (box.hidden) return;
  const list = $('board-list');
  list.replaceChildren();
  const top = board.top(stage.seed, 5);
  for (const r of top) {
    const li = document.createElement('li');
    li.className = r.me ? 'me' : '';
    const name = document.createElement('span');
    name.textContent = r.nick;
    const car = document.createElement('small'); car.textContent = r.car; name.append(car);
    const t = document.createElement('span'); t.textContent = fmt(r.t);
    li.append(name, t);
    list.append(li);
  }
  const rk = board.rank(stage.seed);
  $('board-rank').textContent = rk ? `You're #${rk.pos} of ${rk.of}` : '';
  $('board-name').hidden = !!board.nick || !board.canPost;
  $('board-note').textContent = !top.length ? 'No times yet. Be the first.' :
    board.denied ? 'View-only access: the owner can invite you with edit access to post times.' : '';
}
board.on(() => { renderBoard(); if (!$('classics').hidden) renderClassics(); });
$('board-name').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('board-nick').value;
  board.setNick(v, localBests());
  $('board-nick').blur();
  renderBoard();
});

// Live gap to the ghost: when did your best run reach the spot you're at now?
function ghostAlongs(samples) {
  let hint = -1, mx = -Infinity;
  return samples.map((sm) => {
    const q = road.nearest(sm[1], sm[3], hint);
    hint = q.i;
    mx = Math.max(mx, q.along);
    return mx;
  });
}
function ghostGap() {
  if (!ghost?.alongs || run.state !== 'running') return null;
  const A = ghost.alongs, sm = ghost.samples;
  if (roadAlong <= A[0] || roadAlong >= A[A.length - 1]) return null;
  let lo = 0, hi = A.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (A[mid] < roadAlong) lo = mid; else hi = mid; }
  const f = A[hi] > A[lo] ? (roadAlong - A[lo]) / (A[hi] - A[lo]) : 0;
  return run.t - (sm[lo][0] + (sm[hi][0] - sm[lo][0]) * f);
}

function restartKey() {
  if (stage.kind === 'practice') resetCar();
  else { restartRun(); toast('RESTART', 800); }
}

$('btn-daily').addEventListener('click', () => pickThenStart('daily'));
$('btn-random').addEventListener('click', () => pickThenStart('random'));
$('btn-practice').addEventListener('click', () => pickThenStart('practice'));
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-reset').addEventListener('click', () => { resetCar(); setPaused(false); });
$('btn-restart').addEventListener('click', () => { restartKey(); setPaused(false); });
$('btn-pmenu').addEventListener('click', toMenu);
$('btn-retry').addEventListener('click', () => { restartRun(); });
// Straight on to the next championship stage in the same car.
$('btn-next').addEventListener('click', (e) => { e.currentTarget.blur(); start('champ', champWeekOf(stage.seed).seeds[champIndex(stage.seed)]); });
$('btn-share').addEventListener('click', (e) => { e.currentTarget.blur(); copyResult(); });
$('btn-replay').addEventListener('click', (e) => { e.currentTarget.blur(); startReplay(); });
$('btn-replay-exit').addEventListener('click', (e) => { e.currentTarget.blur(); stopReplay(); });
$('btn-new').addEventListener('click', () => pickThenStart('random'));
$('btn-fmenu').addEventListener('click', toMenu);
{
  const ds = dateSeed(), w = pickWeather(ds, pickTheme(ds).theme);
  $('daily-name').textContent = `${stageName(ds)} · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}${w.id !== 'clear' ? ` · ${w.label}` : ''}`;
}
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
// Mini map: N key or the pause menu. Remembered between visits.
let mapOn = true;
try { mapOn = localStorage.getItem('sideways.map') !== '0'; } catch { /* ignore */ }
function setMap(on) {
  mapOn = on;
  $('minimap').hidden = !on;
  $('opt-map').checked = on;
  if (on) minimap.rebuild();
  try { localStorage.setItem('sideways.map', on ? '1' : '0'); } catch { /* ignore */ }
}
setMap(mapOn);
$('opt-map').addEventListener('change', (e) => setMap(e.target.checked));
$('opt-quality').value = quality;
$('opt-quality').addEventListener('change', (e) => {
  quality = e.target.value;
  try { localStorage.setItem('sideways.quality', quality); } catch { /* ignore */ }
  applyQuality();
  resize();
  if (stage.detail !== qualityLevel()) toast('SCENERY DETAIL: NEXT RESTART', 1400);
  e.target.blur();
});
$('opt-retro').checked = RETRO.on;
$('opt-retro').addEventListener('change', (e) => { retroSet.on = e.target.checked; saveRetro(); toast(retroSet.on ? 'RETRO ON: RELOADING' : 'RETRO OFF: RELOADING', 900); setTimeout(() => location.reload(), 700); });
document.querySelectorAll('.retro-sub').forEach((el) => el.classList.toggle('disabled', !RETRO.on));
$('opt-pixels').value = retroSet.pixels;
$('opt-pixels').addEventListener('change', (e) => { retroSet.pixels = e.target.value; retro.lines = RETRO.on ? RETRO_LINES[retroSet.pixels] : 0; saveRetro(); resize(); e.target.blur(); });
$('opt-dither').checked = !!retroSet.dither;
$('opt-dither').addEventListener('change', (e) => { retroSet.dither = e.target.checked; retro.dither = RETRO.on && retroSet.dither; saveRetro(); resize(); });
$('opt-wobble').checked = !!retroSet.wobble;
$('opt-wobble').addEventListener('change', (e) => { retroSet.wobble = e.target.checked; saveRetro(); toast('WOBBLE: RELOADING', 900); setTimeout(() => location.reload(), 700); });
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
  if (code === 'Escape' && !running && $('start').hidden && $('finish').hidden) { closePages(); return; }
  if (code === 'Escape') { if (replay.on) { stopReplay(); return; } if (running) setPaused(!paused); return; }
  if (key === '?' || code === 'Slash') { $('debug').hidden = !$('debug').hidden; return; }
  if (code === 'KeyN') { setMap(!mapOn); toast(mapOn ? 'MAP ON' : 'MAP OFF', 800); return; }
  if (code === 'KeyM') { setMuted(!muted); toast(muted ? 'SOUND OFF' : 'SOUND ON', 800); return; }
  if (!running) {
    if (code === 'Enter' && !$('garage').hidden) $('garage-go').click();
    else if (code === 'Enter' && !$('start').hidden) pickThenStart('daily');
    return;
  }
  if (paused) return;
  if (code === 'KeyC') toast(rig.cycle().toUpperCase() + ' CAM', 800);
  if (code === 'KeyG') { setAssist(!assist.on); toast(assist.on ? `LINE ASSIST ${assist.level.toUpperCase()}` : 'LINE ASSIST OFF', 1000); }
  if (code === 'KeyR') restartKey();
  if (code === 'KeyT') resetCar();
  const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(code);
  // Car is chosen in the garage before a timed stage; quick swaps only in practice.
  if (n >= 0) { if (stage.kind === 'practice') setCar(CAR_ORDER[n]); else toast('PICK YOUR CAR IN THE GARAGE', 1100); }
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
const retro = new RetroPass();
retro.lines = RETRO.on ? (RETRO_LINES[retroSet.pixels] ?? 360) : 0;
retro.dither = RETRO.on && !!retroSet.dither;
function saveRetro() { try { localStorage.setItem('sideways.retro', JSON.stringify(retroSet)); } catch { /* ignore */ } }
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  retro.setSize(w, h, renderer.getPixelRatio());
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dust.setViewport(retro.active ? retro.size[1] : h * renderer.getPixelRatio(), camera.fov);
  $('rotate').hidden = !(isTouch && h > w);
  minimap.rebuild();
}
window.addEventListener('resize', resize);
applyQuality();
resize();

// ---------- Dust emission ----------
const emitAcc = [0, 0];
const _w = new THREE.Vector3();
function emitDust(dt) {
  if (car.air) return;
  if (surface.splash && car.speed > 4) splash(dt);
  const s = car.spec;
  const sn = Math.sin(car.yaw), cs = Math.cos(car.yaw);
  const off = surface.name === 'grass';
  const base = Math.min(car.speed / 28, 1) * (off ? 0.6 : 0.22);
  const amount = (car.rearSlide * 1.0 * Math.min(1, car.speed / 12) + base + (off ? car.speed / 40 : 0)) * (surface.dustK ?? 1);
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

// Puddles throw spray up from all four wheels.
let splashAcc = 0, wasSplash = false;
function splash(dt) {
  const s = car.spec, sn = Math.sin(car.yaw), cs = Math.cos(car.yaw);
  splashAcc += dt * car.speed * 6;
  if (!wasSplash) { audio.splash?.(Math.min(1, car.speed / 20)); }
  while (splashAcc >= 1) {
    splashAcc -= 1;
    const side = Math.random() < 0.5 ? 1 : -1, lz = Math.random() < 0.5 ? s.a : -s.b, lx = side * s.track / 2;
    dust.emit(car.x + sn * lz + cs * lx, (car.y ?? 0) + 0.2, car.z + cs * lz - sn * lx,
      car.vx * 0.3 + cs * side * (1 + Math.random() * 3), 1.5 + Math.random() * 2.5, car.vz * 0.3 - sn * side * (1 + Math.random() * 3),
      0.5 + Math.random() * 0.6, 0.7 + Math.random() * 0.5, [0.8, 0.86, 0.92]);
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
        if (o.knock) continue;                                   // handled by knockRocks()
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
// ---------- Knockable rocks ----------
// Small boulders get punted out of the way: they cost you a bit of speed
// (more for bigger ones), fly off, bounce and roll to a stop.
const flying = [], knocked = [];
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
function knockRocks(sim = true) {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), off = car.spec.length * 0.3;
  if (car.speed < 1.5) return;
  for (const k of [off, 0, -off]) {
    const cx = car.x + fx * k, cz = car.z + fz * k;
    const gx = Math.floor(cx / OB_CELL), gz = Math.floor(cz / OB_CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = obGrid.get(`${gx + dx},${gz + dz}`);
      if (!list) continue;
      for (const o of list) {
        if (!o.knock || o.gone) continue;
        const ex = o.x - cx, ez = o.z - cz, d = Math.hypot(ex, ez);
        if (d >= CAR_R + o.r) continue;
        o.gone = true;
        const it = o.item;
        it.m.decompose(_p, _q, _s);
        const nx = d > 1e-3 ? ex / d : fx, nz = d > 1e-3 ? ez / d : fz;
        const sp = car.speed, mass = it.sc * it.sc * it.sc;
        const kick = 1.2 / (0.6 + mass);
        flying.push({
          o, it, pos: _p.clone(), quat: _q.clone(), scale: _s.clone(), r: o.r,
          v: new THREE.Vector3(car.vx * kick * 0.8 + nx * sp * 0.35 * kick, (1.5 + Math.random() * 2.5) * Math.min(1.5, kick) * Math.min(1, sp / 12), car.vz * kick * 0.8 + nz * sp * 0.35 * kick),
          spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14).multiplyScalar(Math.min(1, sp / 15)),
          rest: 0,
        });
        knocked.push(o);
        it.mesh.frustumCulled = false;               // it can leave its tile's bounds
        if (!sim) continue;                          // replays don't touch the car
        const slow = Math.min(0.25, 0.15 * mass + 0.01 * it.sc);
        car.vx *= 1 - slow; car.vz *= 1 - slow;
        car.yawRate += (fx * nz - fz * nx) * slow * 2.5;
        audio.thud(Math.min(0.7, 0.12 + mass * 0.5));
        shakeKick = Math.max(shakeKick, Math.min(0.2, slow));
        if (it.sc > 0.6) dentAt(o.x, o.z, Math.min(0.06, slow * 0.25));
        for (let n = 0; n < 4 + it.sc * 10; n++) {
          dust.emit(o.x, groundAt(o.x, o.z, 99, 0) + 0.3, o.z, (Math.random() - 0.5) * 3 + car.vx * 0.2, 0.6 + Math.random() * 1.5, (Math.random() - 0.5) * 3 + car.vz * 0.2, 0.8 + Math.random() * 0.6, 1.2, surface.dust);
        }
      }
    }
  }
}
function updateFlyingRocks(dt) {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i];
    f.v.y -= 9.81 * dt;
    f.pos.addScaledVector(f.v, dt);
    const g = worldGround(f.pos.x, f.pos.z) + f.scale.y * 0.6;
    if (f.pos.y < g) {
      f.pos.y = g;
      if (f.v.y < -1.5) { f.v.y *= -0.35; f.v.x *= 0.7; f.v.z *= 0.7; f.spin.multiplyScalar(0.7); }
      else { f.v.y = 0; f.v.x *= Math.exp(-dt * 3); f.v.z *= Math.exp(-dt * 3); f.spin.multiplyScalar(Math.exp(-dt * 3)); }
    }
    _e.set(f.spin.x * dt, f.spin.y * dt, f.spin.z * dt);
    f.quat.multiply(_q.setFromEuler(_e));
    f.it.mesh.setMatrixAt(f.it.idx, _m4.compose(f.pos, f.quat, f.scale));
    f.it.mesh.instanceMatrix.needsUpdate = true;
    f.o.x = f.pos.x; f.o.z = f.pos.z;
    if (Math.hypot(f.v.x, f.v.y, f.v.z) < 0.3 && f.pos.y <= g + 0.01) { if ((f.rest += dt) > 0.3) flying.splice(i, 1); }
    else f.rest = 0;
  }
}
const _m4 = new THREE.Matrix4();
// Put every knocked rock back (restart / replay).
function resetRocks() {
  flying.length = 0;
  for (const o of knocked) {
    o.gone = false;
    o.x = o.item.x; o.z = o.item.z;
    o.item.mesh.setMatrixAt(o.item.idx, o.item.m);
    o.item.mesh.instanceMatrix.needsUpdate = true;
  }
  knocked.length = 0;
}

function crash(impact) {
  stats.crash();
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
  if (!onShortcut && Math.abs(lat) < road.width / 2) {
    const pt = patchAt(surfPlan, roadAlong, lat);
    if (pt) surface = pt === lastPatch ? lastPatchSurf : patchSurface(pt);
  }
  if (hazards) {
    if (run.state !== 'finished') hazards.update(dt, roadAlong, hazardFx);
    hazardObs = hazards.obstacles();
    if (hazards.rubbleAt(car.x, car.z)) surface = RUBBLE;
  } else hazardObs = [];
  roadLat = lat; roadLx = tz; roadLz = -tx;
  if (run.state === 'finished') { inp = { throttle: 0, brake: 0.35, steer: 0, handbrake: false }; }
  if (run.state === 'countdown') { inp = { throttle: 0, brake: 0, steer: inp.steer, handbrake: true }; }
  // Tiny hops over kinks in the ground keep their grip; real flights don't.
  const flying = car.air && car.airTime > 0.06;
  car.step(dt, inp, flying ? AIR : surface);
  collide();
  knockRocks();
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
  if (run.state === 'running' || run.state === 'free') stats.drive(dt, car, carId);

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
// Patch surfaces take the weather's grip too.
let lastPatch = null, lastPatchSurf = null;
function patchSurface(pt) {
  lastPatch = pt;
  lastPatchSurf = { ...pt, grip: pt.grip * weather.grip };
  return lastPatchSurf;
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

// ---------- Replay ----------
// Plays the run you just finished back on your car, filmed by trackside TV
// cameras and the drone. Hazards happen again at the same moments, and your
// previous best's ghost races alongside.
const replay = { on: false, t: 0, end: 0, samples: null, hint: -1, vx: 0, vz: 0 };
const replayPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, done: false };
function startReplay() {
  const smp = recorder.samples;
  if (!smp.length) return;
  replay.on = true; replay.t = 0; replay.samples = smp.slice(); replay.end = smp[smp.length - 1][0];
  replay.hint = -1; replay.vx = replay.vz = 0;
  $('finish').hidden = true;
  $('hud-replay').hidden = false;
  document.body.classList.add('replaying');
  hazards?.reset();
  resetRocks();
  dust.clear();
  tv.reset();
  samplePose(replay.samples, 0, replayPose);
  applyReplayPose(0);
  drone.snap(car, worldGround);
}
function stopReplay() {
  if (!replay.on) return;
  replay.on = false;
  $('hud-replay').hidden = true;
  document.body.classList.remove('replaying');
  hazards?.update(0, 1e9, null);                  // everything back to how it ended
  samplePose(replay.samples, replay.end, replayPose);   // car back where the run finished
  applyReplayPose(0);
  car.vx = car.vz = 0; car.speed = 0; car.yawRate = 0;
  rig.snap(car);
  if (run.state === 'finished') $('finish').hidden = false;
}
function applyReplayPose(dt) {
  const px = car.x, pz = car.z;
  car.x = replayPose.x; car.y = replayPose.y; car.z = replayPose.z; car.yaw = replayPose.yaw;
  car.groundPitch = replayPose.pitch; car.groundRoll = replayPose.roll;
  // Velocity from the motion (smoothed), for dust and the camera.
  if (dt > 0) {
    const vx = (car.x - px) / dt, vz = (car.z - pz) / dt;
    const jump = Math.hypot(vx, vz) > 80;           // a respawn: don't streak
    const k = Math.min(1, dt * 10);
    replay.vx = jump ? 0 : replay.vx + (vx - replay.vx) * k;
    replay.vz = jump ? 0 : replay.vz + (vz - replay.vz) * k;
  }
  car.vx = replay.vx; car.vz = replay.vz;
  car.speed = Math.hypot(car.vx, car.vz);
  const sn = Math.sin(car.yaw), cs = Math.cos(car.yaw);
  car.vF = car.vx * sn + car.vz * cs; car.vL = car.vx * cs - car.vz * sn;
  const slip = car.speed > 3 ? Math.abs(Math.atan2(car.vL, Math.abs(car.vF))) : 0;
  car.rearSlide = Math.min(1, slip / 0.5);
  car.steer = 0; car.wheelSpin = 0; car.axSmooth = 0; car.aySmooth = 0;
  const q = road.nearest(car.x, car.z, replay.hint);
  replay.hint = q.i;
  replay.along = q.along;
  car.air = car.y - groundAt(car.x, car.z, Math.abs(q.lateral), q.y) > 0.3;
  surface = road.surfaceAt(Math.abs(q.lateral));
}
function updateReplay(dt) {
  replay.t += dt;
  samplePose(replay.samples, replay.t, replayPose);
  applyReplayPose(dt);
  hazards?.update(dt, replay.along, hazardFx);
  hazardObs = [];
  knockRocks(false);
  emitDust(dt);
  $('replay-time').textContent = fmt(Math.min(replay.t, replay.end));
  if (replay.t > replay.end + 2) stopReplay();
}

// ---------- Main loop ----------
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;

  const active = running && !paused && !replay.on;
  if (running && !paused && replay.on) updateReplay(dt);
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
  drone.hidden = replay.on ? tv.kind === 'drone' : rig.mode === 'drone';
  if (!paused) drone.update(car, dt, worldGround);
  if (replay.on) { if (!paused) tv.update(car, dt, road, replay.along, worldGround, drone); }
  else rig.update(car, dt);
  world.sky.position.copy(camera.position);
  if (!paused) { dust.update(dt); updateFlyingRocks(dt); }
  if (!paused && trackside) trackside.update(dt, car.x, car.z);
  if (!paused) { precip.update(dt, camera, { x: car.vx, z: car.vz }); rain.update(dt, camera, { x: car.vx, z: car.vz }, car.y); }
  wasSplash = !!surface.splash;
  if (headlights[0].intensity > 0) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), y = (car.y ?? 0), f = car.spec.length / 2 + 0.25;
    headlights.forEach((l, k) => {
      const side = k ? 1 : -1;
      l.position.set(car.x + fx * f + fz * side * 0.6, y + 0.7, car.z + fz * f - fx * side * 0.6);
      l.target.position.set(car.x + fx * 30 + fz * side * 1.5, y - 1.0 + (car.groundPitch || 0) * 30, car.z + fz * 30 - fx * side * 1.5);
    });
  }
  audio.update(car, car.air && car.airTime > 0.06 ? AIR : surface, dt, active);
  if (running) updateHud(dt);
  if (running && mapOn) minimap.draw(car, replay.on ? replay.along : roadAlong, ghostModel ? ghostPose : null, dt);
  retro.render(renderer, scene, camera);
}
// Boot: build today's stage behind the menu, then start the loop.
loadStage('daily', dateSeed());
requestAnimationFrame(frame);

// ---------- Menu pages ----------
const preview = new GaragePreview($('garage-view'));
function openPage(id) {
  $('start').hidden = true;
  $(id).hidden = false;
  $(id).querySelector('[data-back]')?.focus();
}
function closePages() {
  if (pendingStart && !$('garage').hidden) pendingStart = null;
  for (const id of ['garage', 'past', 'champ', 'statsview', 'classics']) $(id).hidden = true;
  preview.stop();
  $('start').hidden = false;
}
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', closePages));

function renderGarage() {
  $('garage-cars').innerHTML = garageCarsHTML(garage.car);
  $('garage-stats').innerHTML = garageStatsHTML(garage.car);
  $('garage-paint').innerHTML = PAINTS.map((c) => `<button class="swatch${c === garage.color ? ' on' : ''}" style="background:${c}" data-paint="${c}" aria-label="Paint ${c}"></button>`).join('');
  $('garage-wheels').innerHTML = WHEELS.map((w) => `<button class="chip${w === garage.wheels ? ' on' : ''}" data-wheels="${w}">${w}</button>`).join('');
  $('garage-color').value = garage.color;
}
// The garage doubles as the car picker: you always land here first, and
// every stage goes through it so you choose your car before you drive.
let pendingStart = null;
function openGarage(mode, label = '') {
  pendingStart = mode === 'pick' ? pendingStart : null;
  $('garage-for').textContent = mode === 'pick' ? `Next: ${label}` : 'Choose your car';
  $('garage-go').textContent = mode === 'pick' ? 'Drive ▶' : 'Continue ▶';
  $('garage-back').hidden = mode === 'boot';
  openPage('garage');
  renderGarage();
  preview.show(garage.car, garage);
  preview.start();
  $('garage-go').focus();
}
function stageTitle(kind, seed) {
  if (kind === 'practice') return 'Practice loop';
  if (kind === 'random' && seed == null) return 'Random stage';
  if (kind === 'daily' && seed == null) seed = dateSeed();
  const name = stageName(seed);
  if (kind === 'classic') return `${name} · Classic`;
  if (kind === 'champ') return `${name} · Championship ${champIndex(seed)}/5`;
  return name;
}
function pickThenStart(kind, seed) {
  if (running) toMenu();
  pendingStart = { kind, seed };
  openGarage('pick', stageTitle(kind, seed));
}
$('btn-garage').addEventListener('click', () => openGarage('browse'));
$('garage-go').addEventListener('click', (e) => {
  e.currentTarget.blur();
  const p = pendingStart;
  pendingStart = null;
  closePages();
  if (p) start(p.kind, p.seed);
});
$('garage').addEventListener('click', (e) => {
  const c = e.target.closest('[data-car]'), p = e.target.closest('[data-paint]'), w = e.target.closest('[data-wheels]');
  if (c) { setCar(c.dataset.car, true); preview.show(garage.car, garage); }
  if (p) { garage.color = p.dataset.paint; model.setColor(garage.color); preview.setColor(garage.color); }
  if (w) { garage.wheels = w.dataset.wheels; model.setWheelStyle(garage.wheels); preview.setWheels(garage.wheels); }
  if (c || p || w) { saveGarage(); renderGarage(); }
});
$('garage-color').addEventListener('input', (e) => {
  garage.color = e.target.value; model.setColor(garage.color); preview.setColor(garage.color); saveGarage();
  document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.paint === garage.color));
});

const cal = { y: new Date().getFullYear(), m: new Date().getMonth() };
function renderCalendar() {
  $('cal-month').textContent = monthLabel(cal.y, cal.m);
  $('cal-grid').innerHTML = calendarHTML(cal.y, cal.m);
  $('cal-prev').disabled = !canGoMonth(cal.y, cal.m, -1);
  $('cal-next').disabled = !canGoMonth(cal.y, cal.m, 1);
}
function shiftMonth(dir) {
  if (!canGoMonth(cal.y, cal.m, dir)) return;
  cal.m += dir;
  if (cal.m < 0) { cal.m = 11; cal.y--; } else if (cal.m > 11) { cal.m = 0; cal.y++; }
  renderCalendar();
}
$('btn-past').addEventListener('click', () => { openPage('past'); renderCalendar(); });
$('cal-prev').addEventListener('click', () => shiftMonth(-1));
$('cal-next').addEventListener('click', () => shiftMonth(1));
$('cal-grid').addEventListener('click', (e) => {
  const d = e.target.closest('[data-seed]');
  if (!d) return;
  closePages();
  pickThenStart('daily', +d.dataset.seed);
});

let week = weekInfo();
function renderChamp() {
  week = weekInfo();
  $('champ-week').textContent = `Week of ${week.label}`;
  const c = champHTML(week);
  $('champ-table').innerHTML = c.html;
  $('champ-total').textContent = c.total;
  // Continue: the first stage you haven't finished yet.
  const next = week.seeds.findIndex((sd) => !localStorage.getItem(`sideways.best.${sd}`));
  champNext = next < 0 ? 0 : next;
  $('champ-continue').textContent = next < 0 ? 'Run it again from stage 1 ▶' : `Continue: stage ${next + 1} of 5 ▶`;
}
let champNext = 0;
$('champ-continue').addEventListener('click', () => { closePages(); pickThenStart('champ', week.seeds[champNext]); });
$('btn-champ').addEventListener('click', () => { openPage('champ'); renderChamp(); });
$('champ-table').addEventListener('click', (e) => {
  const b = e.target.closest('[data-champ]');
  if (!b) return;
  closePages();
  pickThenStart('champ', week.seeds[+b.dataset.champ]);
});

function renderClassics() {
  $('classics-table').innerHTML = classicsHTML((seed) => pickWeather(seed, pickTheme(seed).theme).label);
  // Leader of each classic on the shared board, as text (other people's names).
  if (board.available && board.ready) {
    $('classics-table').querySelectorAll('[data-classic]').forEach((b) => {
      const c = CLASSICS[+b.dataset.classic], top = board.top(c.seed, 1)[0];
      if (!top) return;
      const td = b.closest('tr').children[0], div = document.createElement('div');
      div.className = 'leader';
      div.append('Leader: ');
      const nm = document.createElement('b'); nm.textContent = `${top.nick} ${fmt(top.t)}`;
      div.append(nm);
      td.append(div);
    });
  }
}
$('btn-classics').addEventListener('click', () => { openPage('classics'); renderClassics(); });
$('classics-table').addEventListener('click', (e) => {
  const b = e.target.closest('[data-classic]');
  if (!b) return;
  closePages();
  pickThenStart('classic', CLASSICS[+b.dataset.classic].seed);
});
$('btn-stats').addEventListener('click', () => { stats.save(); openPage('statsview'); $('stats-grid').innerHTML = statsHTML(stats.d); });

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
  get obGrid() { return obGrid; }, flying, auto: null, forceWeather: null, get weather() { return weather; }, get surfPlan() { return surfPlan; }, drone, rig, HAZARD_DEBUG, get model() { return model; }, get hazards() { return hazards; }, worldGround,
  get shortcuts() { return shortcuts; }, get onShortcut() { return onShortcut; },
  get obstacleCount() { let n = 0; obGrid.forEach((l) => (n += l.length)); return n; }, collide,
  codriver,
  get ghostModel() { return ghostModel; }, recorder, loadGhost, onLanding, renderer, scene, camera, marks, assist, setAssist, car, input, TUNE, CARS, start, stepSim, placeOnRoad, loadStage, run, stage,
  get road() { return road; }, get terrain() { return terrain; }, get lineMesh() { return lineMesh; }, get surface() { return surface; }, get best() { return best; },
};
