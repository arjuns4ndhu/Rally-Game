// Sideways: build 2, seeded daily / random stages plus the practice loop.
import * as THREE from 'three';
import { CarPhysics, CARS, CAR_ORDER, TUNE } from './car.js';
import { buildCarModel, carSkins } from './carModel.js';
import { Road, createTestRoad, gravelTexture, SURFACES, findShortcuts } from './track.js';
import { generateStage, stageName, isEndurance, layPieces, selfCrossing } from './stagegen.js';
import { buildGate, buildSign, buildCornerWarnings, buildShortcutMarkers } from './gates.js';
import { dateSeed, mulberry32 } from './rng.js';
import { THEMES, pickTheme, specialOf, SPECIAL_LABEL, CUSTOM_STAGES, EDIT_THEMES, EDIT_WEATHER, EDIT_PIECES, encodeStage, parseStageCode, registerStage } from './themes.js';
import { setupWorld, buildScenery } from './scenery.js';
import { CameraRig, TVCamera } from './camera.js';
import { Dust, BeamDust } from './particles.js';
import { stageK, UPGRADES, upgradedSpec, buyUpgrade, TIERS, RESTART_PENALTY, newCareer, loadCareer, saveCareer, resetCareer, seasonPlan, recordStage, standings, finishSeason, ordinal, RIVALS } from './career.js';
import { Podium } from './podium.js';
import { CoDriverVoice } from './voice.js';
import { Achievements } from './achievements.js';
import { CUSTOM, PATTERNS } from './loftcar.js';
import { buildStreet, buildTunnels, planHarbour, harbourCarve, inHarbour, buildHarbour, Fireworks } from './street.js';
import { buildCountry, buildLedge } from './country.js';
import { Net, RemoteCars, newCode, cleanCode, cleanNick, readPlayer, readRace } from './multiplayer.js';
import { AudioEngine } from './audio.js';
import { DrivingSchool } from './school.js';
import { Input, ACTIONS, BINDS, bindKey, resetKeys, isDriveKey, keyLabel, FEEL, saveFeel } from './input.js';
import { TyreMarks, buildRacingMarks } from './tyremarks.js';
import { GhostRecorder, saveGhost, loadGhost, samplePose, packGhost, unpackGhost } from './ghost.js';
import { buildPaceNotes, CoDriver } from './pacenotes.js';
import { notesHTML } from './paceicons.js';
import { Drone } from './drone.js';
import { facet, enableWobble, RetroPass, RETRO, steady } from './retro.js';

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
import { WEATHER, pickWeather, weatherTheme, blendTheme, Precip, Rain } from './weather.js';
import { planSurfaces, patchAt, buildSurfaces, buildFords, riverLine } from './surfaces.js';
import { GaragePreview, garageStatsHTML, garageCarsHTML, calendarHTML, monthLabel, canGoMonth, weekInfo, champHTML, statsHTML, champIndex, champWeekOf, weekTheme, LAUNCH, PAINTS, WHEELS, CLASSICS, MEDAL_ICON, classicOf, medalTimes, medalFor, classicsHTML, SPECIAL_PAINTS, LOCKS, unlockState, carLocked, wheelLocked, skinLocked } from './menus.js';
import { buildHazards, HAZARD_DEBUG } from './hazards.js';

const $ = (id) => document.getElementById(id);

// Errors show on screen (playtesters can screenshot them) instead of
// leaving the game silently stuck on a menu.
function showError(what, err) {
  let box = $('err-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'err-box';
    box.className = 'err-box';
    box.title = 'Tap to close';
    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  }
  const where = (err?.stack || '').split('\n').find((l) => /\.js/.test(l)) || '';
  box.textContent = `${what}: ${err?.message || err}${where ? ` (${where.trim().replace(/^at /, '').replace(/\?v=\w+/g, '').replace(/^.*\/src\//, 'src/').replace(/\)$/, '')})` : ''}. Tap to close.`;
}
// Only our own code's errors (not the host page's or browser extensions').
const ours = (err) => err instanceof Error && /\/src\/\w+\.js/.test(err.stack || '');
window.addEventListener('error', (e) => { if (ours(e.error)) showError('Something went wrong', e.error); });
window.addEventListener('unhandledrejection', (e) => { if (ours(e.reason)) showError('Something went wrong', e.reason); });
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
const beamDust = new BeamDust(scene);
const fireworks = new Fireworks(scene);
const minimap = new MiniMap($('minimap'));
const stats = new Stats();
const board = new Leaderboard();
board.init().catch(() => { /* leaderboard stays off */ });
const precip = new Precip(scene);
const rain = new Rain(scene);
// Headlights, used at night and dusk.
const headlights = [-1, 1].map(() => {
  const l = new THREE.SpotLight(0xfff0d0, 0, 90, 0.5, 0.55, 1.2);
  scene.add(l, l.target);
  return l;
});
let weather = WEATHER.clear, surfPlan = null;
let career = loadCareer(), careerRun = null;     // career progress, and the career stage being driven
let harbour = null, marina = null;               // street circuits: the marina, and its yachts
// Multiplayer: the race this page is in (host's setup), held on the grid
// until everyone has loaded, grid slot, other cars' poses for collisions.
const mp = { race: null, hold: false, slot: 0, sendT: 0, posT: 0, poses: [], seen: '', goTimer: 0, setup: null };
const net = new Net();
const remote = new RemoteCars(scene);

// ---------- Graphics quality ----------
// Auto picks Medium on phones/tablets (Low on small ones) and High elsewhere.
const QUALITY = {
  high: { ratio: 1.75, shadows: 2048, detail: 1 },
  medium: { ratio: 1.25, shadows: 1024, detail: 0.7 },
  low: { ratio: 1, shadows: 0, detail: 0.45 },
  lowest: { ratio: 0.75, shadows: 0, detail: 0.3 },     // only reached by Auto on very slow devices
};
const AUTO_STEPS = ['high', 'medium', 'low', 'lowest'];
let quality = 'auto';
try { quality = localStorage.getItem('sideways.quality') || 'auto'; } catch { /* ignore */ }
// What Auto has learned this device can manage (kept for next time).
let autoLevel = null;
try { autoLevel = AUTO_STEPS.includes(localStorage.getItem('sideways.autoq')) ? localStorage.getItem('sideways.autoq') : null; } catch { /* ignore */ }
function qualityLevel() {
  if (quality !== 'auto') return quality;
  if (autoLevel) return autoLevel;
  const touch = matchMedia('(pointer: coarse)').matches;
  if (!touch) return 'high';
  return (navigator.hardwareConcurrency || 4) <= 4 ? 'low' : 'medium';
}
// Auto mode watches the frame rate while racing and steps the graphics
// down when it stays low (scenery detail follows on the next stage).
const perf = { time: 0, frames: 0, grace: 3 };
function watchFrameRate(rawDt) {
  if (quality !== 'auto' || rawDt > 1) return;         // the tab was hidden (frames stop, then one huge gap)
  if (perf.grace > 0) { perf.grace -= rawDt; return; }  // stage just loaded
  perf.time += rawDt; perf.frames++;
  if (perf.time < 4) return;
  const fps = perf.frames / perf.time;
  perf.time = 0; perf.frames = 0;
  if (fps >= 40) return;
  const i = AUTO_STEPS.indexOf(qualityLevel());
  if (i < 0 || i >= AUTO_STEPS.length - 1) return;
  autoLevel = AUTO_STEPS[i + 1];
  try { localStorage.setItem('sideways.autoq', autoLevel); } catch { /* ignore */ }
  applyQuality(); resize();
  perf.grace = 2;                                       // let it settle before judging again
  toast(`RUNNING SLOW: GRAPHICS ${autoLevel.toUpperCase()}`, 1600);
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
  const autoOpt = document.querySelector('#opt-quality option[value="auto"]');
  if (autoOpt) autoOpt.textContent = `Auto (${qualityLevel()[0].toUpperCase()}${qualityLevel().slice(1)})`;
}
rig.drone = drone;
rig.groundAt = (x, z) => worldGround(x, z);
const dust = new Dust(scene);
const marks = new TyreMarks(scene);
const audio = new AudioEngine();
const input = new Input();
let noteTimer = 0;
const voice = new CoDriverVoice(audio);
// Pace-note signs (DiRT Rally style) across the top of the screen, and
// read out loud if the co-driver's voice is on.
const codriver = new CoDriver((list) => {
  if (codriver.mode === 'voice') voice.speak(list.map((n) => n.say).join(', '));
  const el = $('hud-note');
  el.innerHTML = notesHTML(list);
  el.setAttribute('aria-label', list.map((n) => n.text).join(', '));
  el.classList.add('on');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => el.classList.remove('on'), 3600);
});
codriver.mode = 'signs';
// (The spoken co-driver, mode 'voice', is switched off until a recorded
// voice exists: see .claude/skills/codriver-voice.)
try { if (localStorage.getItem('sideways.codriver') === 'off') codriver.mode = 'off'; } catch { /* ignore */ }

// ---------- Stage ----------
// A stage is a road plus everything built around it. Loading a new one
// disposes the old meshes.
const gravelMat = steady(new THREE.MeshStandardMaterial({ map: gravelTexture(THEMES.forest.road), roughness: 0.95, vertexColors: true, flatShading: true }));
const vergeMat = steady(new THREE.MeshStandardMaterial({ color: 0x6e6340, roughness: 1, vertexColors: true, flatShading: true }));
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
const trackMat = steady(new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true, flatShading: true }));
const stage = { kind: 'practice', seed: 0, name: '', start: 0, finish: 0, cps: [] };

function disposeGroup(g) {
  g.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { if (m === gravelMat || m === vergeMat) continue; m.map?.dispose(); m.dispose(); }
  });
}

let lampGlow = 0;
function loadStage(kind, seed = 0) {
  if (stageGroup) { scene.remove(stageGroup); disposeGroup(stageGroup); }
  marina = null;
  stageGroup = new THREE.Group();
  stage.kind = kind; stage.seed = seed;
  let flat = false, runout = 0;
  const { theme, hilliness } = kind === 'practice' ? { theme: THEMES.forest, hilliness: 1 } : pickTheme(seed);
  stage.theme = theme;
  weather = kind === 'practice' ? WEATHER.clear : pickWeather(seed, theme);
  // Themed championship weeks put every stage of the week in the same weather.
  const wt = kind === 'champ' ? weekTheme(champWeekOf(seed).weekNo) : null;
  if (wt) weather = WEATHER[wt.id === 'rain' && theme.id === 'snow' ? 'snowfall' : wt.id === 'rain' && theme.id === 'desert' ? 'night' : wt.id];
  skyPlan = kind === 'endurance' ? planSky(seed, theme) : null;
  if (skyPlan) weather = skyPlan.keys[0].w;
  if (window.__sideways?.forceWeather) { weather = WEATHER[window.__sideways.forceWeather]; skyPlan = null; }
  stage.weather = weather;
  audio.setStage(theme.id, weather.wet);
  world.applyTheme(weatherTheme(theme, weather));
  precip.set(weather.id === 'snowfall' ? 'snow' : null);
  rain.set(weather.id === 'rain', precip.density ?? 1);
  const lamps = weather.dark ? 140 : weather.id === 'dusk' || weather.id === 'fog' ? 35 : 0;
  headlights.forEach((l) => { l.intensity = lamps; });
  lampGlow = weather.dark ? 1 : lamps ? 0.45 : 0;
  model.setGlow(lampGlow);
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
    road.applyFords(def.fords);
    road.tunnels = def.tunnels || [];
    runout = def.runout;
    stage.name = def.name;
  }
  road.computeRacingLine();
  // Surface grip and dust colour follow the theme (packed snow is slippery).
  const wg = weather.grip;
  road.surfaces = {
    gravel: theme.road.sealed
      ? { ...SURFACES.gravel, name: 'tarmac', grip: theme.road.grip * wg, dust: theme.road.dust, dustK: 0.12 }
      : { ...SURFACES.gravel, grip: theme.road.grip * wg, dust: theme.road.dust, dustK: weather.wet ? 0.35 : 1 },
    verge: { ...SURFACES.verge, grip: SURFACES.verge.grip * theme.road.grip * wg, dust: theme.road.dust, dustK: weather.wet ? 0.35 : 1 },
    grass: { ...SURFACES.grass, grip: SURFACES.grass.grip * wg, dust: theme.road.dust, dustK: weather.wet ? 0.35 : 1 },
  };
  // Shortcuts (stages only): rough tracks across where the road doubles back.
  let cuts = [];
  if (kind !== 'practice' && !theme.street && !theme.lanes && !theme.cliff) {   // walled-in roads: no way across
    const st = 24, fin = road.length - runout;
    const cps = [1, 2, 3, 4].map((k) => st + (fin - st) * k / SECTORS);
    cuts = findShortcuts(road, { checkpoints: cps, start: st, finish: fin });
  }
  const rivers = (road.fords || []).map((f) => riverLine(road, f));
  // Street circuits: a marina beside a straight bit, carved into the ground.
  harbour = theme.street ? planHarbour(road, { seed, start: 24, finish: road.length - runout, tunnels: road.tunnels || [] }) : null;
  const built = buildScenery(road, kind === 'practice' ? 1 : seed, { flat, theme, hilliness, avoid: [...cuts.map((c) => c.pts), ...rivers], detail: QUALITY[qualityLevel()].detail,
    carve: harbour ? harbourCarve(harbour) : null, keepOut: harbour ? (x, z) => inHarbour(harbour, x, z, 4) : null });
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
    surfPlan = planSurfaces(road, seed, { start: st, finish: fin, theme, weather, fords: road.fords || [] });
    stageGroup.add(buildSurfaces(road, surfPlan));
    stageGroup.add(buildFords(road, road.fords));
  }
  // The racing line is always shown as dark, worn tyre tracks.
  lineMesh = buildRacingMarks(road);
  stageGroup.add(lineMesh);
  // Really sharp corners get brake boards, chevrons and braking marks.
  sharpCorners = road.findSharpCorners();
  stageGroup.add(buildCornerWarnings(road, sharpCorners));
  (road.bumps || []).forEach((b, k) => {
    if (b.at > 75) stageGroup.add(buildSign(road, b.at - 70, b.kind === 'jump' ? 'JUMP' : 'CREST', k % 2 ? -1 : 1));
  });
  (road.fords || []).forEach((f, k) => stageGroup.add(buildSign(road, f.at - 70, 'WATER', k % 2 ? 1 : -1)));

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
  hazards = kind === 'practice' || kind === 'classic' || theme.street ? null : buildHazards(road, {
    seed, theme, groundY: worldGround, start: stage.start, finish: stage.finish, cps: stage.cps, corners: road.findSharpCorners(),
  });
  if (hazards) stageGroup.add(hazards.group);
  // Crowds and hay bales (timed stages only).
  trackside = null;
  if (kind !== 'practice') {
    trackside = buildTrackside(road, { seed, corners: road.findSharpCorners(), start: stage.start, finish: stage.finish, cps: stage.cps, groundY: worldGround, detail: QUALITY[qualityLevel()].detail, level: !!theme.cliff });
    stageGroup.add(trackside.group);
    buildObstacleGrid([...builtObstacles, ...trackside.obstacles]);
  }
  // Street circuits: barriers, promenade, buildings, banners. Tunnels on
  // street and tarmac stages.
  stage.walls = 0; stage.wallSide = null;
  if (theme.street) {
    const street = buildStreet(road, { seed, tunnels: road.tunnels, start: stage.start, finish: stage.finish, groundY: worldGround, night: weather.dark ? 1 : weather.id === 'dusk' ? 0.55 : 0, harbour });
    stageGroup.add(street.group);
    if (harbour) { marina = buildHarbour(harbour, { seed }); stageGroup.add(marina.group); }
    stage.walls = street.barrier;
  }
  if (theme.lanes) {
    const lanes = buildCountry(road, { seed, start: stage.start, finish: stage.finish, groundY: worldGround });
    stageGroup.add(lanes.group);
    stage.walls = lanes.barrier;
  }
  if (theme.cliff) {
    const ledge = buildLedge(road, { side: terrain.cliffSide, steep: terrain.cliffSteep, tunnels: road.tunnels });
    stageGroup.add(ledge.group);
    stage.walls = ledge.barrier;
    stage.wallSide = ledge.wallSide;
  }
  if (road.tunnels?.length) {
    // On a mountain ledge the tunnel's drop side is open: a gallery over the view.
    const openSide = theme.cliff ? (t) => { const sg = terrain.cliffSide(road.indexAt((t.from + t.to) / 2)); return Math.abs(sg) < 0.15 ? 0 : sg > 0 ? -1 : 1; } : null;
    stageGroup.add(buildTunnels(road, road.tunnels, { rock: !theme.street, seed, openSide }));
    road.tunnels.forEach((t, k) => { if (t.from > 90) stageGroup.add(buildSign(road, t.from - 60, 'TUNNEL', k % 2 ? 1 : -1)); });
  }
  stage.lamps = headlights[0].intensity;
  scene.add(stageGroup);
  minimap.build(road, kind === 'practice'
    ? { closed: true }
    : { start: stage.start, finish: stage.finish, cps: stage.cps, shortcuts, zoom: kind === 'endurance' ? 900 : 0 });   // long stages: a closer map that follows you
  codriver.load(buildPaceNotes(road, { start: stage.start, finish: stage.kind === 'practice' ? road.length : stage.finish }));
  marks.clear();
  restartRun();
}

// ---------- Endurance: the day moves on ----------
// Long stages change as you drive: the light fades towards evening and the
// weather can turn. Each change blends in over a few hundred metres, and the
// co-driver warns you as it starts.
const SKY_STORIES = [['clear', 'dusk', 'night'], ['clear', 'overcast', 'rain'], ['overcast', 'fog', 'clear'], ['dusk', 'night', 'night'], ['clear', 'rain', 'dusk'], ['fog', 'overcast', 'dusk'], ['overcast', 'rain', 'night']];
const SKY_CALLS = { overcast: 'CLOUDING OVER', dusk: 'SUN GOING DOWN', night: 'NIGHT FALLING · LIGHTS ON', fog: 'FOG AHEAD', rain: 'RAIN COMING', snowfall: 'SNOW COMING', clear: 'CLEARING UP' };
let skyPlan = null;
function planSky(seed, theme) {
  const r = mulberry32(((seed ^ 0x51ed27) >>> 0) + 7);
  const fix = (id) => (id === 'rain' && theme.id === 'snow' ? 'snowfall' : id === 'rain' && theme.id === 'desert' ? 'fog' : id);
  const story = SKY_STORIES[Math.floor(r() * SKY_STORIES.length)].map(fix);
  const keys = story.map((id, k) => ({ f: [0, 0.38 + r() * 0.1, 0.72 + r() * 0.1][k], w: WEATHER[id], th: weatherTheme(theme, WEATHER[id]) }))
    .filter((k, i, a) => i === 0 || k.w !== a[i - 1].w);
  return { theme, keys, last: '', called: 0 };
}
const lampsFor = (w) => (w.dark ? 140 : w.id === 'dusk' || w.id === 'fog' ? 35 : 0);
function updateSky(along) {
  const P = skyPlan, L = road.length, BL = Math.min(260, L * 0.06);
  let i = 0;
  while (i + 1 < P.keys.length && along > P.keys[i + 1].f * L - BL) i++;
  const a = P.keys[Math.max(0, i - 1)], b = P.keys[i];
  const t = i === 0 ? 0 : smoothstep(b.f * L - BL, b.f * L + BL, along);
  if (i > P.called && run.state === 'racing') { P.called = i; toast(SKY_CALLS[b.w.id] || b.w.label.toUpperCase(), 1800); }
  if (i < P.called) P.called = i;
  const key = `${i}:${Math.round(t * 40)}`;
  if (key === P.last) return;
  P.last = key;
  world.applyTheme(blendTheme(a.th, b.th, t));
  const lamps = lampsFor(a.w) + (lampsFor(b.w) - lampsFor(a.w)) * t;
  headlights.forEach((l) => { l.intensity = lamps; });
  lampGlow = Math.max(a.w.dark ? 1 : lampsFor(a.w) ? 0.45 : 0, 0) * (1 - t) + (b.w.dark ? 1 : lampsFor(b.w) ? 0.45 : 0) * t;
  model.setGlow(lampGlow);
  const wetK = (a.w.wet ? 1 - t : 0) + (b.w.wet ? t : 0);
  gravelMat.color.setScalar(1 - 0.3 * wetK);
  gravelMat.roughness = 0.95 - 0.35 * wetK;
  const wg = a.w.grip + (b.w.grip - a.w.grip) * t, th = P.theme, S = road.surfaces;
  S.gravel.grip = th.road.grip * wg; S.verge.grip = SURFACES.verge.grip * th.road.grip * wg; S.grass.grip = SURFACES.grass.grip * wg;
  for (const k of ['gravel', 'verge', 'grass']) S[k].dustK = 1 - 0.65 * wetK;
  // Rain, snow and the sounds switch over halfway through the blend.
  const now = t > 0.5 ? b.w : a.w;
  if (now !== weather) {
    weather = now; stage.weather = now; lastPatch = null;
    precip.set(now.id === 'snowfall' ? 'snow' : null);
    rain.set(now.id === 'rain', precip.density ?? 1);
    audio.setStage(th.id, now.wet);
  }
}

// ---------- Echo ----------
// Ground rising steeply on both sides of the road (a canyon or a cutting)
// throws the engine back at you. Bare rock echoes more than forest does.
let crowdNoise = 0, echoT = 0;
const echo = { k: 0, delay: 0.28 };
function measureEcho() {
  if (!terrain || !road) return;
  const y = car.y ?? 0, wall = [0, 0];
  let near = 40;
  for (const side of [-1, 1]) {
    for (const d of [10, 16, 24, 34]) {
      const rise = terrain.heightAt(car.x + roadLx * side * d, car.z + roadLz * side * d) - y;
      const k = Math.max(0, Math.min(1, (rise - 2.5) / (d * 0.55)));
      if (k > wall[side > 0 ? 1 : 0]) wall[side > 0 ? 1 : 0] = k;
      if (k > 0.5) near = Math.min(near, d);
    }
  }
  // In a tunnel: a short, hard echo all round.
  if (inTunnelAt(roadAlong)) { echo.k = 1; echo.delay = 0.09; return; }
  const rock = { desert: 1.15, alpine: 1, snow: 0.8, autumn: 0.65, forest: 0.55, street: 0.9 }[stage.theme?.id] ?? 0.7;
  echo.k = Math.min(1, (Math.min(wall[0], wall[1]) * 0.95 + Math.max(wall[0], wall[1]) * 0.25) * rock);
  echo.delay = 0.16 + near * 2 / 343 + 0.05;
}

// ---------- Handbrake assist (beginners) ----------
// At a hairpin, steering hard into it at the right sort of speed pulls the
// handbrake for a moment so the tail swings round. Once per corner per pass.
let hbAuto = 0, hbCorner = null, sharpCorners = [];
function handbrakeAssist(inp, dt) {
  if (!FEEL.hbAssist || car.gear < 1 || run.state !== 'racing') { hbAuto = 0; return inp; }
  if (hbAuto > 0) { hbAuto -= dt; return { ...inp, handbrake: true }; }
  const c = sharpCorners.find((k) => roadAlong > k.entry - 8 && roadAlong < k.apex);
  if (!c) { hbCorner = null; return inp; }
  if (c !== hbCorner && !car.drifting && car.speed > 7 && car.speed < 26 && car.steerInput * c.dir > 0.55 && inp.brake < 0.5) {
    hbCorner = c; hbAuto = 0.3;
    return { ...inp, handbrake: true };
  }
  return inp;
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
const garage = { car: 'stiletto', color: '#e8542a', wheels: 'spoke', skins: {} };
try { Object.assign(garage, JSON.parse(localStorage.getItem('sideways.garage') || '{}')); } catch { /* ignore */ }
if (!CARS[garage.car]) garage.car = 'stiletto';
try {
  const u = unlockState(JSON.parse(localStorage.getItem('sideways.stats') || '{}'));
  if (carLocked(garage.car, u)) garage.car = 'stiletto';
  // A style that's locked (e.g. saved before styles became unlocks) falls back to Works.
  for (const [c, sk] of Object.entries(garage.skins)) if (skinLocked(c, sk, u)) delete garage.skins[c];
} catch { /* ignore */ }
if (!WHEELS.includes(garage.wheels)) garage.wheels = 'spoke';
if (!garage.skins || typeof garage.skins !== 'object') garage.skins = {};
// A car that's never had a style picked starts in its Works style and colour.
if (!garage.skins[garage.car]) {
  const k = carSkins(CARS[garage.car])[0];
  if (k) { garage.skins[garage.car] = k.id; if (k.paint) garage.color = k.paint; }
}
function saveGarage() { try { localStorage.setItem('sideways.garage', JSON.stringify(garage)); } catch { /* ignore */ } }
let carId = garage.car;
const car = new CarPhysics(CARS[carId]);
// The livery editor's design (the Custom style) and your door number.
garage.livery = { pattern: 'stripes', c1: '#f1ede2', c2: '#16181d', num: 7, ...(garage.livery || {}) };
if (!PATTERNS.includes(garage.livery.pattern)) garage.livery.pattern = 'stripes';
const applyLivery = () => { Object.assign(CUSTOM, { pattern: garage.livery.pattern, c1: garage.livery.c1, c2: garage.livery.c2 }); };
const carNumber = () => Math.max(0, Math.min(99, parseInt(garage.livery.num, 10) || 0)) || 7;
applyLivery();
let model = buildCarModel(CARS[carId], { color: garage.color, wheelStyle: garage.wheels, number: carNumber(), skin: garage.skins[carId] });
scene.add(model.root);
rig.roofH = model.roofH;
rig.model = model;
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
// Someone else's run picked from the leaderboard: raced instead of your own.
let rival = null;
const ghostPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, done: false };
let ghostOn = true;
try { ghostOn = localStorage.getItem('sideways.ghostOn') !== '0'; } catch { /* ignore */ }
function refreshGhost() {
  ghostHint = -1;
  if (ghostModel) { scene.remove(ghostModel.root); ghostModel.dispose(); ghostModel = null; }
  if (mpActive()) { ghost = null; return; }            // racing real people: no ghost
  if (rival && rival.seed !== stage.seed) rival = null;
  if (rival) ghost = { car: rival.car, color: rival.color, time: rival.time, samples: rival.samples.map((sm) => sm.slice()) };
  else {
    ghost = stage.kind !== 'practice' ? loadGhost(stage.seed) : null;
    // Your own best run on this stage: it must match your saved best time.
    const mine = loadBest();
    if (ghost && !(mine && Math.abs(ghost.time - mine.time) < 0.05)) ghost = null;
  }
  if (ghost) { ghostToLift(ghost.samples); ghost.alongs = ghostAlongs(ghost.samples); }
  if (ghost && ghostOn) {
    // A ghost that can't be built is skipped; it must never stop the game.
    try {
      ghostModel = buildCarModel(CARS[ghost.car] || CARS[carId], { ghost: true, color: ghost.color || '#9fe3ff' });
      scene.add(ghostModel.root);
    } catch (err) { console.warn('ghost', err); ghostModel = null; }
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
  // Career: no free retries. Restarting a stage you were driving costs time.
  if (inCareerStage() && run.liveSeed === stage.seed && run.state === 'running') {
    career.restarts++; saveCareer(career);
    toast(`RESTART · +${RESTART_PENALTY * career.restarts}s CAREER PENALTY`, 1600);
  }
  run.liveSeed = stage.seed;
  // Career upgrades only count on career stages.
  car.setSpec(inCareerStage() && career?.up ? upgradedSpec(CARS[carId], career.up) : CARS[carId]);
  recorder.reset();
  run.state = stage.kind === 'practice' ? 'free' : 'countdown';
  run.cd = 3.8; run.cdShown = null;
  run.t = 0; run.next = 0; run.splits = []; run.penalty = 0; run.respawns = 0;
  best = loadBest();
  hazards?.reset();
  resetRocks();
  model.repair();
  seatRider();
  placeOnRoad(stage.kind === 'practice' ? 0 : road.indexAt(stage.start - 2.5));   // on the line
  $('finish').hidden = true;
  refreshGhost();
  refreshStageHud();
  if (mpActive()) mpOnGrid();
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
  if (riderFall.on && run.state === 'running') run.state = 'dnf';   // no passenger, no finish
  // 3-2-1-GO from a standstill on the line; the clock starts on GO.
  if (run.state === 'countdown') {
    if (mp.hold || flyover.on) return;   // multiplayer: on the grid until everyone's loaded; or the fly-over
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
  // Against your best; on a first run, against gold pace for the distance so far.
  const md = best ? null : stageMedal();
  const delta = best ? run.t - best.splits[k] : md ? run.t - medalTimes(md, md.d).gold * (k + 1) / SECTORS : null;
  if (k === SECTORS - 1) { finishRun(); return; }
  showSplit(`S${k + 1}`, sectorTime, delta);
  audio.beep(1040, 0.1, 'square', 0.18);
  refreshStageHud();
}

function finishRun() {
  run.state = 'finished';
  const unlockedBefore = new Set(unlockedKeys());
  const isBest = !best || run.t < best.time;
  const prev = best;
  if (isBest) {
    best = { time: run.t, splits: run.splits.slice(), car: carId, date: Date.now() };
    saveBest(best);
    recorder.nextT = 0; recorder.record(run.t, car);   // final pose on the line
    saveGhost(stage.seed, { car: carId, color: model.paint.color.getStyle(), time: run.t, samples: recorder.samples });
  }
  stats.finish(isBest);
  // Anything this run unlocked gets a line on the finish screen.
  const newly = unlockedKeys().filter((k) => !unlockedBefore.has(k));
  $('fin-unlock').hidden = !newly.length;
  $('fin-unlock').textContent = newly.length ? `Unlocked: ${newly.map(unlockName).join(', ')}. Have a look in the Garage!` : '';
  refreshGarageDot();
  if (stage.kind !== 'practice' && isBest) {
    board.submit(stage.seed, run.t, CARS[carId].name);
    // Share the run too, so others can race it.
    board.submitGhost(stage.seed, { car: carId, color: model.paint.color.getStyle(), t: run.t, d: packGhost(recorder.samples) });
  }
  lastResult = { time: run.t, splits: run.splits.slice(), prev, isBest, label: stageLabel(), respawns: run.respawns, car: CARS[carId].name, seed: stage.kind !== 'practice' ? stage.seed : null };
  audio.fanfare(isBest && !!prev);
  audio.duck(0.45, 0);                 // music steps back on the finish screen
  $('fin-stage').textContent = stageLabel();
  renderBoard();
  $('btn-next').hidden = !(stage.kind === 'champ' && champIndex(stage.seed) < 5);
  $('btn-next').textContent = 'Next stage';
  $('btn-retry').hidden = false;
  $('fin-career').hidden = true;
  if (inCareerStage()) { if (!careerRun.result) careerFinish(); showCareerFin(); }
  $('fin-mp').hidden = true;
  if (mpActive()) { net.set({ st: 'done', fin: Math.round(run.t * 1000) / 1000 }); mpShowFin(); }
  $('btn-retry').classList.toggle('btn-primary', $('btn-next').hidden);
  // Medal for this run (every timed stage has targets), and the next to chase.
  const cl = stageMedal();
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
  setTimeout(() => { if (run.state === 'finished' && running && !replay.on) $('finish').hidden = false; }, 900);
  // Achievements for this finish.
  if (stage.kind !== 'practice') {
    if (!run.respawns) ach.earn('clean');
    if (medal === 'gold' && stage.kind !== 'classic') ach.earn('gold_any');
    const sp = specialOf(stage.seed);
    if (sp && !CUSTOM_STAGES.has(stage.seed)) { ach.finishedType(sp); if (['street', 'cliff', 'country'].includes(sp)) ach.earn(sp); }
    if (stage.kind === 'endurance') ach.earn('endurance');
    if (CUSTOM_STAGES.has(stage.seed)) ach.earn('builder');
    if (stage.seed === eventInfo().seed) ach.earn('event');
    if (garage.skins[carId] === 'custom') ach.earn('designer');
    if (mpActive()) ach.earn('mp_race');
  }
  checkAch();
  refreshStageHud();
}

function setCar(id, quiet = false) {
  carId = id;
  garage.car = id; saveGarage();
  seatRider();
  scene.remove(model.root);
  model.dispose();
  car.setSpec(CARS[id]);
  applyLivery();
  model = buildCarModel(CARS[id], { color: garage.color, wheelStyle: garage.wheels, number: carNumber(), skin: garage.skins[id] });
  scene.add(model.root);
  rig.roofH = model.roofH;
  rig.model = model;
  model.setGlow(lampGlow);
  audio.setCar(CARS[id]);
  $('hud-car').textContent = CARS[id].name;
  if (net.inLobby) net.set({ car: id, color: garage.color });
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
// A message that stays until the player acts on it (e.g. the run is over).
function banner(msg, label, fn) {
  $('hud-banner-text').textContent = msg;
  $('hud-banner-btn').textContent = label;
  bannerAction = fn;
  $('hud-banner').hidden = false;
}
function clearBanner() { $('hud-banner').hidden = true; bannerAction = null; }
let bannerAction = null;
$('hud-banner-btn').addEventListener('click', (e) => { e.currentTarget.blur(); const fn = bannerAction; clearBanner(); fn?.(); });

function toast(msg, ms = 1600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

function stageLabel() {
  if (stage.kind === 'practice') return 'Practice loop';
  if (inCareerStage()) return `${careerRun.name} · SS${careerRun.stage + 1}/3 · ${stage.name}`;
  if (stage.kind === 'classic') return `${stage.name} · Classic`;
  if (stage.kind === 'champ') return `${stage.name} · Championship ${champIndex(stage.seed)}/5`;
  if (stage.kind === 'endurance') return `${stage.name} · Endurance #${stage.seed}`;
  if (specialOf(stage.seed)) return `${stage.name} · ${SPECIAL_LABEL[specialOf(stage.seed)]} #${stage.seed}`;
  if (stage.kind === 'daily') {
    const d = new Date(Math.floor(stage.seed / 10000), Math.floor(stage.seed / 100) % 100 - 1, stage.seed % 100);
    return `${stage.name} · ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return `${stage.name} · #${stage.seed}`;
}
// Medal targets: the Classics have their own; every other timed stage gets
// targets from its length, scenery and weather.
function stageMedal() {
  if (stage.kind === 'practice' || !road) return null;
  return classicOf(stage.seed) || { d: stage.finish - stage.start, k: stageK(stage.seed, (road.fords || []).length) };
}
function refreshStageHud() {
  const timed = stage.kind !== 'practice';
  $('hud-stage').textContent = stageLabel();
  $('pause-code').textContent = stage.kind === 'practice' ? '' : `Stage code ${codeFor(stage.seed)}`;
  $('btn-pcopy').hidden = stage.kind === 'practice';
  $('hud-timing').hidden = !timed;
  const md = stageMedal();
  $('hud-best').textContent = fmt(best?.time) + (ghostModel ? (rival ? ` · VS ${rival.nick.toUpperCase()}` : ' · GHOST') : '')
    + (md ? ` · GOLD ${fmt(medalTimes(md, md.d).gold)}` : '');
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
  perf.grace = 3; perf.time = 0; perf.frames = 0;
  // Sound must never stop the stage from starting.
  try { audio.init(); audio.music(musicOn); if (codriver.mode === 'voice') voice.loadClips(); } catch (err) { console.warn('audio', err); }
  if (schoolNext && kind === 'practice') school.start(); else school.stop();
  schoolNext = false;
  if (kind === 'daily' && seed == null) seed = dateSeed();
  if (kind === 'random' && seed == null) seed = 100000 + Math.floor(Math.random() * 900000);
  if (kind === 'endurance' && seed == null) seed = 3e6 + Math.floor(Math.random() * 1e6);
  const fresh = kind !== stage.kind || seed !== stage.seed || !road || stage.detail !== qualityLevel();
  if (fresh) loadStage(kind, seed);
  else restartRun();
  if (fresh && kind !== 'practice' && !mpActive() && flyover.enabled) startPreview();
  $('start').hidden = true;
  $('pause').hidden = true;
  $('hud').hidden = false;
  minimap.rebuild();                 // sized now the HUD is showing
  running = true;
  paused = false;
  flashHelp();
  toast(kind === 'practice' ? 'PRACTICE' : stage.name.toUpperCase() + (weather.id !== 'clear' ? ` · ${weather.label.toUpperCase()}` : ''), 1600);
}
function toMenu() {
  running = false; paused = false;
  stats.save();
  codriver.stop(); voice.stop();
  $('pause').hidden = true; $('finish').hidden = true; $('hud').hidden = true;
  $('start').hidden = false;
  audio.resume(); audio.idle();
  school.stop();
  clearBanner();
  refreshGarageDot();
  audio.music(musicOn);
}
function setPaused(p) {
  if (!running) return;
  paused = p;
  $('pause').hidden = !p;
  if (p) { codriver.stop(); voice.stop(); }
  if (p) audio.suspend(); else audio.resume();
}
function resetCar() {
  school.note('reset');
  if (stage.kind === 'practice') {
    const q = road.nearest(car.x, car.z, roadHint);
    placeOnRoad(q.i);
    seatRider();
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
    ...(r.seed ? [`Beat it: stage code ${codeFor(r.seed)}`] : []),
  ].join('\n');
}
// Copy text, falling back to the old textarea trick where the clipboard
// API is blocked (some embedded frames). Flashes "Copied!" on the button.
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  if (btn) {
    const was = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = was; }, 1400);
  }
}
function copyResult() { if (lastResult) copyText(shareText(lastResult), $('btn-share')); }
// A stage's shareable code: its number, or the editor code for a player-made stage.
const codeFor = (seed) => CUSTOM_STAGES.get(seed)?.code || String(seed);
const copyCode = (btn) => { if (stage.kind !== 'practice') { copyText(codeFor(stage.seed), btn); toast('STAGE CODE COPIED', 1400); } };
// Editor codes (SW-...) are kept whole; anything else keeps only its digits.
const cleanCodeText = (t) => { const m = /SW-\d\d[0-3]-[sSlrLRhHcCeEjk]+/.exec(t || ''); return m ? m[0] : (t || '').replace(/\D/g, '').slice(0, 9); };
$('btn-pcopy').addEventListener('click', (e) => { e.currentTarget.blur(); copyCode(e.currentTarget); });
$('btn-fcopy').addEventListener('click', (e) => { e.currentTarget.blur(); copyCode(e.currentTarget); });
// Pasting: keep only the digits (so "Stage code 274801" pastes fine).
$('code-in').addEventListener('input', (e) => { if (/^\s*SW/i.test(e.target.value)) return; const v = e.target.value.replace(/\D/g, '').slice(0, 9); if (v !== e.target.value) e.target.value = v; });
$('btn-paste').addEventListener('click', async () => {
  try {
    const t = await navigator.clipboard.readText();
    const v = cleanCodeText(t);
    if (!v) { toast('NO STAGE CODE ON THE CLIPBOARD', 1400); return; }
    $('code-in').value = v;
  } catch {
    // Reading the clipboard can be blocked: let them paste by hand.
    $('code-in').focus();
    toast('PASTE THE CODE INTO THE BOX', 1600);
  }
});

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
    // Race anyone else's run as a ghost.
    if (!r.me) {
      const race = document.createElement('button');
      race.className = 'btn btn-sm board-race';
      race.textContent = 'Race';
      race.title = `Race ${r.nick}'s ghost`;
      race.addEventListener('click', () => raceGhostOf(r.id, r.nick, race));
      li.append(race);
    }
    list.append(li);
  }
  const rk = board.rank(stage.seed);
  $('board-rank').textContent = rk ? `You're #${rk.pos} of ${rk.of}` : '';
  $('board-name').hidden = !!board.nick || !board.canPost;
  $('board-note').textContent = !top.length ? 'No times yet. Be the first.' :
    board.denied ? 'View-only access: the owner can invite you with edit access to post times.' : '';
}
board.on(() => { renderBoard(); if (!$('classics').hidden) renderClassics(); if (!$('event').hidden) renderEvent(); });
async function raceGhostOf(id, nick, btn) {
  btn.disabled = true; btn.textContent = '…';
  const g = await board.fetchGhost(id, stage.seed);
  const samples = g && unpackGhost(g.d);
  btn.disabled = false; btn.textContent = 'Race';
  if (!samples) { toast('NO GHOST SAVED FOR THAT RUN', 1500); return; }
  rival = { seed: stage.seed, nick, car: CARS[g.car] ? g.car : carId, color: g.color, time: g.t, samples };
  restartRun();
  toast(`RACING ${nick.toUpperCase()}'S GHOST`, 1600);
}
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
  if (mpActive()) { toast('NO RESTARTS IN A RACE · T: BACK TO CHECKPOINT', 1400); return; }
  if (stage.kind === 'practice') resetCar();
  else { restartRun(); toast('RESTART', 800); }
}

$('btn-daily').addEventListener('click', () => pickThenStart('daily'));
// Random stages: choose the scenery, weather and hills, then find a stage
// code that gives them (the code alone still decides everything, so it can
// be shared like any other).
const GEN = {
  type: [['gravel', 'Gravel'], ['tarmac', 'Tarmac'], ['street', 'Street circuit'], ['cliff', 'Mountain edge'], ['country', 'Countryside'], ['night', 'Night forest'], ['river', 'River crossings']],
  theme: [['any', 'Any'], ['forest', 'Forest'], ['desert', 'Canyon'], ['snow', 'Snow'], ['alpine', 'Alpine'], ['autumn', 'Autumn']],
  weather: [['any', 'Any'], ['clear', 'Clear'], ['overcast', 'Overcast'], ['dusk', 'Dusk'], ['fog', 'Fog'], ['rain', 'Rain / snowfall'], ['night', 'Night']],
  hills: [['any', 'Any'], ['flat', 'Flat'], ['rolling', 'Rolling'], ['big', 'Big hills']],
};
const HILLS = { flat: [0, 0.9], rolling: [0.9, 1.25], big: [1.25, 9] };
const gen = { type: 'gravel', theme: 'any', weather: 'any', hills: 'any' };
try { Object.assign(gen, JSON.parse(localStorage.getItem('sideways.gen') || '{}')); } catch { /* ignore */ }
// Canyon stages never get rain, so that pair can't be made.
// Tarmac and night forest have their own scenery; night forest is always
// at night; river stages run through forest, autumn or alpine country.
const genBlocked = (k, v) => (k === 'weather' && v === 'rain' && gen.theme === 'desert') || (k === 'theme' && v === 'desert' && gen.weather === 'rain')
  || (k === 'theme' && v !== 'any' && ['tarmac', 'night', 'street', 'country', 'cliff'].includes(gen.type))
  || (k === 'theme' && gen.type === 'river' && ['desert', 'snow'].includes(v))
  || (k === 'weather' && gen.type === 'night' && !['any', 'night'].includes(v));
function renderGen() {
  for (const k of Object.keys(GEN)) {
    $('gen-' + k).innerHTML = GEN[k].map(([v, label]) => {
      const off = genBlocked(k, v);
      return `<button class="chip${gen[k] === v ? ' on' : ''}" role="radio" aria-checked="${gen[k] === v}" data-gen="${k}" data-v="${v}"${off ? ' disabled title="Not with this stage type"' : ''}>${label}</button>`;
    }).join('');
  }
}
// Codes: 100000-999999 gravel; 4000000+ the special types, 300000 each.
const TYPE_BASE = { tarmac: 4e6, night: 4.3e6, river: 4.6e6, street: 4.9e6, country: 5.2e6, cliff: 5.5e6 };
function genSeed() {
  for (let n = 0; n < 20000; n++) {
    const seed = gen.type in TYPE_BASE ? TYPE_BASE[gen.type] + Math.floor(Math.random() * 3e5) : 100000 + Math.floor(Math.random() * 900000);
    const { theme, hilliness } = pickTheme(seed);
    if (gen.theme !== 'any' && theme.id !== gen.theme) continue;
    if (gen.hills !== 'any' && (hilliness < HILLS[gen.hills][0] || hilliness >= HILLS[gen.hills][1])) continue;
    if (gen.weather !== 'any') {
      const w = pickWeather(seed, theme).id;
      if (!(w === gen.weather || (gen.weather === 'rain' && w === 'snowfall'))) continue;
    }
    return seed;
  }
  return null;
}
$('randomgen').addEventListener('click', (e) => {
  const c = e.target.closest('[data-gen]');
  if (!c || c.disabled) return;
  gen[c.dataset.gen] = c.dataset.v;
  if (genBlocked('weather', gen.weather)) gen.weather = 'any';
  if (genBlocked('theme', gen.theme)) gen.theme = 'any';
  try { localStorage.setItem('sideways.gen', JSON.stringify(gen)); } catch { /* ignore */ }
  renderGen();
});
$('gen-go').addEventListener('click', () => {
  const seed = genSeed();
  if (seed == null) { toast('NO STAGE LIKE THAT: TRY ANOTHER MIX', 1600); return; }
  $('randomgen').hidden = true;
  pickThenStart('random', seed);
});
$('btn-random').addEventListener('click', () => { renderGen(); openPage('randomgen'); });
$('btn-endurance').addEventListener('click', () => pickThenStart('endurance'));
// Stage codes: every stage has a number; typing it in drives that same road.
function kindOfCode(n) {
  if (!Number.isInteger(n) || n <= 0) return null;
  if (classicOf(n)) return 'classic';
  if (isEndurance(n)) return 'endurance';
  if (CUSTOM_STAGES.has(n)) return 'random';
  if (specialOf(n)) return 'random';
  if (n >= 1e6 && n < 2e6) return 'champ';
  if (n >= 100000 && n < 1e6) return 'random';
  if (n >= 20000101 && n <= 21001231) {
    const d = new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
    if (dateSeed(d) === n && n >= LAUNCH && n <= dateSeed()) return 'daily';
  }
  return null;
}
$('code-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const txt = $('code-in').value.trim();
  const def = /^SW-/i.test(txt) ? parseStageCode(txt.replace(/^sw-/, 'SW-')) : null;
  if (/^SW-/i.test(txt) && !def) { toast('THAT EDITOR CODE IS BROKEN', 1400); return; }
  const n = def ? registerStage(def) : Number(txt.replace(/\D/g, ''));
  const kind = kindOfCode(n);
  if (!kind) { toast('UNKNOWN STAGE CODE', 1400); return; }
  $('code-in').blur();
  pickThenStart(kind, n);
});
$('btn-practice').addEventListener('click', () => pickThenStart('practice'));
// Driving school: the practice loop with guided steps on top.
const school = new DrivingSchool({ root: $('school'), step: $('school-step'), text: $('school-text'), bar: $('school-bar') }, (a) => `<b>${keyLabel(BINDS[a])}</b>`);
let schoolNext = false;
$('btn-school').addEventListener('click', () => { pickThenStart('practice'); schoolNext = true; });
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-reset').addEventListener('click', () => { resetCar(); setPaused(false); });
$('btn-restart').addEventListener('click', () => { restartKey(); setPaused(false); });
$('btn-pmenu').addEventListener('click', toMenu);
$('btn-retry').addEventListener('click', () => { restartRun(); audio.music(musicOn); });   // music back up from the finish-screen level
// Straight on to the next championship stage in the same car.
$('btn-next').addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (mpActive()) { mpToLobby(); return; }
  if (careerRun?.result) { careerNext(); return; }
  start('champ', champWeekOf(stage.seed).seeds[champIndex(stage.seed)]);
});
$('btn-share').addEventListener('click', (e) => { e.currentTarget.blur(); copyResult(); });
$('btn-replay').addEventListener('click', (e) => { e.currentTarget.blur(); startReplay(); });
$('btn-replay-exit').addEventListener('click', (e) => { e.currentTarget.blur(); stopReplay(); });
$('btn-new').addEventListener('click', () => pickThenStart('random', genSeed() ?? undefined));   // same choices as last time
$('btn-fmenu').addEventListener('click', toMenu);
// Change car mid-stage: pick in the garage, then the same stage restarts from the line.
function changeCar() {
  if (!running || replay.on) return;
  const inSchool = school.active && !school.done;
  pickThenStart(stage.kind, stage.seed);
  schoolNext = inSchool;
}
$('btn-pcar').addEventListener('click', changeCar);
$('btn-fcar').addEventListener('click', changeCar);
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
  voice.muted = m; if (m) voice.stop();
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
// Steering feel and beginner help.
function showFeel() {
  $('opt-sens').value = Math.round(FEEL.sens * 100); $('opt-sens-val').textContent = `${Math.round(FEEL.sens * 100)}%`;
  $('opt-dead').value = Math.round(FEEL.dead * 100); $('opt-dead-val').textContent = `${Math.round(FEEL.dead * 100)}%`;
  $('opt-rumble').checked = FEEL.rumble; $('opt-hbassist').checked = FEEL.hbAssist;
}
showFeel();
$('opt-sens').addEventListener('input', (e) => { FEEL.sens = +e.target.value / 100; saveFeel(); showFeel(); });
$('opt-dead').addEventListener('input', (e) => { FEEL.dead = +e.target.value / 100; saveFeel(); showFeel(); });
$('opt-rumble').addEventListener('change', (e) => { FEEL.rumble = e.target.checked; saveFeel(); if (FEEL.rumble) input.rumble(0.6, 0.6, 200); });
$('opt-hbassist').addEventListener('change', (e) => { FEEL.hbAssist = e.target.checked; saveFeel(); });
$('opt-volume').addEventListener('input', (e) => { audio.init(); setVolume(+e.target.value); });
// Music volume, separate from the game: 40% is the music as mixed, 100% is
// two and a half times louder (a limiter keeps it clean).
function setMusicVolume(pct) {
  audio.setMusicVolume(pct / 40);
  $('opt-musicvol').value = pct;
  $('opt-musicvol-val').textContent = `${pct}%`;
  try { localStorage.setItem('sideways.musicvol', String(pct)); } catch { /* ignore */ }
}
let musicVol = 60;
try { const v = parseInt(localStorage.getItem('sideways.musicvol'), 10); if (v >= 0 && v <= 100) musicVol = v; } catch { /* ignore */ }
setMusicVolume(musicVol);
$('opt-musicvol').addEventListener('input', (e) => { audio.init(); setMusicVolume(+e.target.value); });
// Key rebinding (pause menu).
function renderKeys() {
  $('keybinds').innerHTML = Object.entries(ACTIONS).map(([a, label]) =>
    `<div class="keyrow"><span>${label}</span><button class="chip" data-bind="${a}">${keyLabel(BINDS[a])}</button></div>`).join('');
  const k = (a) => `<b>${keyLabel(BINDS[a])}</b>`;
  $('help-drive').innerHTML = `${k('throttle')}/${k('brake')} throttle/brake · ${k('left')}/${k('right')} steer · ${k('handbrake')} handbrake`;
}
renderKeys();
$('keybinds').addEventListener('click', (e) => {
  const b = e.target.closest('[data-bind]');
  if (!b) return;
  b.blur();
  b.textContent = 'Press a key…';
  b.classList.add('on');
  input.capture = (code) => {
    if (code !== 'Escape' && !['KeyC', 'KeyG', 'KeyR', 'KeyT', 'KeyN', 'KeyM', 'Slash', 'Enter', 'Tab'].includes(code) && !/^Digit[1-6]$/.test(code)) bindKey(b.dataset.bind, code);
    else toast('THAT KEY IS TAKEN', 1000);
    renderKeys();
  };
});
$('keys-reset').addEventListener('click', () => { resetKeys(); renderKeys(); });
// Bigger touch controls for small phones or big thumbs.
function setBigTouch(on) {
  document.body.classList.toggle('big-touch', on);
  $('opt-bigtouch').checked = on;
  try { localStorage.setItem('sideways.bigtouch', on ? '1' : '0'); } catch { /* ignore */ }
}
try { setBigTouch(localStorage.getItem('sideways.bigtouch') === '1'); } catch { /* ignore */ }
$('opt-bigtouch').addEventListener('change', (e) => setBigTouch(e.target.checked));
// Music: starts with the first click or key press, then plays on through
// every screen until it's switched off.
let musicOn = true;
try { musicOn = localStorage.getItem('sideways.music') !== '0'; } catch { /* ignore */ }
$('opt-music').checked = musicOn;
$('opt-music').addEventListener('change', (e) => {
  musicOn = e.target.checked;
  try { localStorage.setItem('sideways.music', musicOn ? '1' : '0'); } catch { /* ignore */ }
  audio.music(musicOn);
});

// iPhone Safari only unlocks sound on a finished tap (touchend/click), not on
// pointerdown, so keep listening until the audio context is really running.
const GESTURES = ['pointerdown', 'touchend', 'click', 'keydown'];
const firstGesture = () => {
  audio.init();
  if (!running) audio.music(musicOn);
  if (audio.ctx?.state === 'running') GESTURES.forEach((g) => window.removeEventListener(g, firstGesture, true));
};
GESTURES.forEach((g) => window.addEventListener(g, firstGesture, true));
$('opt-codriver').value = codriver.mode;
$('opt-codriver').addEventListener('change', (e) => {
  codriver.mode = e.target.value;
  if (codriver.mode === 'voice') { audio.init(); voice.loadClips(); voice.speak('left three, into, right four, long'); } else voice.stop();
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
  // Picking Auto again starts it fresh from this device's best guess.
  if (quality === 'auto') { autoLevel = null; try { localStorage.removeItem('sideways.autoq'); } catch { /* ignore */ } }
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
  if (code === 'Escape') { if (!$('clip-panel').hidden) { $('clip-close').click(); return; } if (replay.on) { stopReplay(); return; } if (running) setPaused(!paused); return; }
  if (replay.on) {
    if (code === 'Space') { replay.playing = !replay.playing; showReplayCtl(); }
    else if (code === 'ArrowLeft') replaySpeed(-1);
    else if (code === 'ArrowRight') replaySpeed(1);
    else if (code === 'KeyC') replayCam();
    else if (code === 'KeyD') { replay.auto = !replay.auto; showReplayCtl(); }
    else if (code === 'KeyV') toggleClip();
    return;
  }
  if (isDriveKey(code)) return;          // a rebound driving key wins over hotkeys
  if (key === '?' || code === 'Slash') { $('debug').hidden = !$('debug').hidden; return; }
  if (code === 'KeyN') { setMap(!mapOn); toast(mapOn ? 'MAP ON' : 'MAP OFF', 800); return; }
  if (code === 'KeyM') { setMuted(!muted); toast(muted ? 'SOUND OFF' : 'SOUND ON', 800); return; }
  if (!running) {
    if (code === 'Enter' && !$('garage').hidden) $('garage-go').click();
    else if (code === 'Enter' && !$('start').hidden) pickThenStart('daily');
    return;
  }
  if (paused) return;
  if (code === 'KeyC') { toast(rig.cycle().toUpperCase() + ' CAM', 800); school.note('camera'); }
  if (code === 'KeyG') { setAssist(!assist.on); toast(assist.on ? `LINE ASSIST ${assist.level.toUpperCase()}` : 'LINE ASSIST OFF', 1000); }
  if (code === 'KeyR') restartKey();
  if (code === 'KeyT') resetCar();
  const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(code);
  // Car is chosen in the garage before a timed stage; quick swaps only in practice.
  if (n >= 0) {
    if (stage.kind !== 'practice') toast('PICK YOUR CAR IN THE GARAGE', 1100);
    else if (carLocked(CAR_ORDER[n], unlockState(stats.d))) toast(`LOCKED: ${LOCKS.cars[CAR_ORDER[n]].why.toUpperCase()}`, 1400);
    else setCar(CAR_ORDER[n]);
  }
});
input.on('action', (act) => {
  if (act === 'camera') { toast(rig.cycle().toUpperCase() + ' CAM', 800); school.note('camera'); }
  if (act === 'reset') restartKey();
  if (act === 'pause') setPaused(!paused);
});

// One UI state on <body data-ui>: menu, page, loading, race, pause, finish
// or replay. It is worked out from which screens are showing, so it can't
// drift from them, and the CSS uses it to decide what else shows (touch
// pedals only while driving, the HUD hidden under the finish card, ...).
const PAGES = ['garage', 'past', 'champ', 'statsview', 'classics', 'randomgen', 'welcome', 'career', 'mp', 'event', 'editor', 'settings', 'ach'];
function syncUI() {
  const open = (id) => !$(id).hidden;
  document.body.dataset.ui = open('loading') ? 'loading' : open('hud-replay') ? 'replay' : open('pause') ? 'pause'
    : open('finish') ? 'finish' : open('start') ? 'menu' : PAGES.some(open) ? 'page' : open('hud') ? 'race' : 'menu';
}
{
  const watch = new MutationObserver(syncUI);
  for (const id of ['loading', 'hud-replay', 'pause', 'finish', 'start', 'hud', ...PAGES]) watch.observe($(id), { attributes: true, attributeFilter: ['hidden'] });
  syncUI();
}

// The key list in the corner is there to teach, not to stay: it shows at the
// start of each run and fades after a few seconds (it's in pause too).
let helpTimer = 0;
function flashHelp() {
  $('hud-help').classList.remove('faded');
  clearTimeout(helpTimer);
  helpTimer = setTimeout(() => $('hud-help').classList.add('faded'), 9000);
}

// Pause settings: one group open at a time, so the menu always fits.
document.querySelectorAll('.set-group').forEach((d) => d.addEventListener('toggle', () => {
  if (d.open) document.querySelectorAll('.set-group').forEach((o) => { if (o !== d) o.open = false; });
}));

// Touch UI
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) {
  document.body.classList.add('touch');
  $('touch').hidden = false;
  input.bindTouch($('touch'));
}

// Phone steering: on-screen buttons, tilting the phone, or a thumb pad.
input.bindDrag($('tc-drag'), $('tc-knob'));
async function setSteerMode(mode, fromTap = false) {
  const ok = await input.setSteerMode(mode);
  if (!ok) { if (fromTap) toast('TILT NEEDS MOTION ACCESS', 1600); mode = 'buttons'; await input.setSteerMode(mode); }
  document.body.dataset.steer = mode;
  $('tc-drag').hidden = mode !== 'drag';
  $('tc-tilt').hidden = mode !== 'tilt';
  document.querySelectorAll('#opt-steer [data-steer]').forEach((b) => { const on = b.dataset.steer === mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  try { localStorage.setItem('sideways.steer', mode); } catch { /* ignore */ }
  return ok;
}
$('opt-steer').addEventListener('click', (e) => { const b = e.target.closest('[data-steer]'); if (b) setSteerMode(b.dataset.steer, true); });
{
  let saved = 'buttons';
  try { saved = localStorage.getItem('sideways.steer') || 'buttons'; } catch { /* ignore */ }
  setSteerMode(saved).then((ok) => {
    // Tilt on iPhone needs a tap to ask for motion access: try again on the first one.
    if (!ok && saved === 'tilt') window.addEventListener('pointerup', () => setSteerMode('tilt'), { once: true });
  });
}

// Game controller: drive with it, and move around the menus with the
// D-pad/stick (A picks, B goes back).
input.on('padconnect', () => { document.body.classList.add('pad'); toast('CONTROLLER CONNECTED', 1400); });
input.on('paddisconnect', () => toast('CONTROLLER DISCONNECTED', 1400));
const MENU_LAYERS = ['loading', 'podium', 'pause', 'finish', 'garage', 'welcome', 'randomgen', 'classics', 'past', 'champ', 'career', 'mp', 'event', 'editor', 'settings', 'ach', 'statsview', 'start'];
function menuLayer() { return MENU_LAYERS.map($).find((el) => el && !el.hidden) || null; }
function focusables(root) {
  return [...root.querySelectorAll('button, input, select, summary, [tabindex="0"]')]
    .filter((el) => !el.disabled && el.offsetParent !== null && el.getClientRects().length);
}
// Move focus to the nearest control in that direction.
function padMove(dir) {
  const root = menuLayer();
  if (!root) return;
  const list = focusables(root);
  if (!list.length) return;
  const cur = list.includes(document.activeElement) ? document.activeElement : null;
  if (!cur) { list[0].focus(); return; }
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (along <= 4) continue;
    const score = along + across * 2.2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { best.focus(); best.scrollIntoView?.({ block: 'nearest' }); }
}
input.on('pad', (name) => {
  document.body.classList.add('pad');
  const racing = running && !paused && !replay.on && $('finish').hidden;
  if (replay.on) {
    if (name === 'b' || name === 'start') stopReplay();
    else if (name === 'y') replayCam();
    else if (name === 'lb') replaySpeed(-1);
    else if (name === 'rb') replaySpeed(1);
    else if (name === 'a') { replay.playing = !replay.playing; showReplayCtl(); }
    else if (name === 'x') toggleClip();
    return;
  }
  if (racing) {
    if (name === 'start') setPaused(true);
    else if (name === 'y') { toast(rig.cycle().toUpperCase() + ' CAM', 800); school.note('camera'); }
    else if (name === 'back') restartKey();
    else if (name === 'rb') resetCar();
    else if (name === 'lb') { setAssist(!assist.on); toast(assist.on ? `LINE ASSIST ${assist.level.toUpperCase()}` : 'LINE ASSIST OFF', 1000); }
    return;
  }
  // Menus, pause, finish, garage and pages.
  if (['up', 'down', 'left', 'right'].includes(name)) { padMove(name); return; }
  if (name === 'a') {
    const el = document.activeElement;
    if (el && el !== document.body && menuLayer()?.contains(el)) el.click();
    else focusables(menuLayer() || document.body)[0]?.focus();
    return;
  }
  if (name === 'start' && paused) { setPaused(false); return; }
  if (name === 'b') {
    if (paused) { setPaused(false); return; }
    const back = menuLayer()?.querySelector('[data-back]');
    if (back && !back.hidden) back.click();
  }
});

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
  rain.setViewport(retro.active ? retro.size[1] : h * renderer.getPixelRatio());
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
        input.rumble(Math.min(0.8, impact / 10), 0.5, 160);
        shakeKick = Math.max(shakeKick, Math.min(0.3, impact * 0.03));
        if (impact > 3) sparks(cx - nx * CAR_R, (car.y ?? 0) + 0.35, cz - nz * CAR_R, 6 + impact * 2, car.vx, car.vz);
      }
    }
  }
}
// Street circuits: a steel barrier along each edge. Hitting it pushes the
// car back onto the road, bouncing off the speed going into it, with sparks
// and a bang for a real hit and a scrape for a brush.
function hitBarriers() {
  if (!stage.walls || !road) return;
  const i = roadHint, lim = stage.walls - 0.95;
  const lat = (car.x - road.px[i]) * roadLx + (car.z - road.pz[i]) * roadLz;
  if (Math.abs(lat) <= lim) return;
  const s = Math.sign(lat), push = Math.abs(lat) - lim;
  if (stage.wallSide && !stage.wallSide(i, s)) return;     // an open bank, not a wall
  car.x -= roadLx * s * push; car.z -= roadLz * s * push;
  const vn = (car.vx * roadLx + car.vz * roadLz) * s;       // speed into the barrier
  if (vn <= 0) return;
  car.vx -= roadLx * s * vn * 1.25; car.vz -= roadLz * s * vn * 1.25;
  car.vx *= 0.992; car.vz *= 0.992;                         // scrub along it
  car.yawRate *= 0.85;
  const wx = car.x + roadLx * s * 0.9, wz = car.z + roadLz * s * 0.9;
  if (vn > 2) {
    audio.thud(Math.min(0.9, 0.2 + vn / 14));
    input.rumble(Math.min(1, vn / 10), 0.6, 160);
    shakeKick = Math.max(shakeKick, Math.min(0.3, vn * 0.03));
    sparks(wx, (car.y ?? 0) + 0.5, wz, 6 + vn * 3, car.vx, car.vz);
    if (vn > 5) dentAt(wx, wz, Math.min(0.2, vn * 0.015));
    if (vn > CRASH_SPEED * 1.3) crash(vn);
  } else if (car.speed > 6 && Math.random() < 0.3) sparks(wx, (car.y ?? 0) + 0.4, wz, 2, car.vx, car.vz);
}
// Multiplayer with collisions on: each car is two circles (nose and tail).
// This page only moves its own car; the other player's page does the same
// for theirs, so a hit pushes both apart.
function hitCars() {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), R = 0.95;
  for (const o of mp.poses) {
    if (Math.abs(o.x - car.x) > 6 || Math.abs(o.z - car.z) > 6) continue;
    const ox = Math.sin(o.yaw), oz = Math.cos(o.yaw);
    for (const a of [1.1, -1.1]) for (const b of [1.1, -1.1]) {
      const ax = car.x + fx * a, az = car.z + fz * a, bx = o.x + ox * b, bz = o.z + oz * b;
      const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz);
      if (d >= R * 2 || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d, over = R * 2 - d;
      car.x += nx * over * 0.5; car.z += nz * over * 0.5;
      const vrel = (car.vx - o.vx) * nx + (car.vz - o.vz) * nz;
      if (vrel >= 0) continue;
      car.vx -= nx * vrel * 0.9; car.vz -= nz * vrel * 0.9;
      car.yawRate += (fx * nz - fz * nx) * -vrel * 0.08 * Math.sign(a);
      if (-vrel > 2) {
        audio.thud(Math.min(0.9, 0.2 + -vrel / 12));
        input.rumble(Math.min(1, -vrel / 9), 0.7, 150);
        shakeKick = Math.max(shakeKick, Math.min(0.3, -vrel * 0.03));
        sparks(bx + nx * R, (car.y ?? 0) + 0.5, bz + nz * R, 6 + -vrel * 2, car.vx, car.vz);
        if (-vrel > 5) dentAt(ax - nx * R, az - nz * R, Math.min(0.18, -vrel * 0.015));
      }
    }
  }
}
function inTunnelAt(along) { return (road?.tunnels || []).some((t) => along > t.from && along < t.to); }

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
        const sp = car.speed;
        if (it.knock === 'topple') { toppleCactus(o, it, sim); continue; }
        const mass = it.sc * it.sc * it.sc;
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
        if (it.sc > 0.6) { dentAt(o.x, o.z, Math.min(0.06, slow * 0.25)); sparks(o.x, (car.y ?? 0) + 0.3, o.z, 8, car.vx, car.vz); }
        for (let n = 0; n < 4 + it.sc * 10; n++) {
          dust.emit(o.x, groundAt(o.x, o.z, 99, 0) + 0.3, o.z, (Math.random() - 0.5) * 3 + car.vx * 0.2, 0.6 + Math.random() * 1.5, (Math.random() - 0.5) * 3 + car.vz * 0.2, 0.8 + Math.random() * 0.6, 1.2, surface.dust);
        }
      }
    }
  }
}
// A cactus hit by the car snaps at the base and falls the way the car is going.
function toppleCactus(o, it, sim) {
  if (!it.mesh) { knocked.push(o); return; }        // thinned out by the detail setting
  it.m.decompose(_p, _q, _s);
  const sp = car.speed, dx = car.vx / (sp || 1), dz = car.vz / (sp || 1);
  flying.push({
    o, it, topple: true, pos: _p.clone(), base: _q.clone(), scale: _s.clone(),
    axis: new THREE.Vector3(dz, 0, -dx),             // falls along the car's travel
    ang: 0, w: Math.min(4, 0.6 + sp * 0.12),          // angle and angular speed
    v: new THREE.Vector3(car.vx * 0.25, 0, car.vz * 0.25), rest: 0,
  });
  knocked.push(o);
  it.mesh.frustumCulled = false;
  const y = worldGround(o.x, o.z);
  for (let n = 0; n < 10 + it.sc * 8; n++) {
    dust.emit(o.x, y + 0.4 + Math.random() * 1.6 * it.sc, o.z, (Math.random() - 0.5) * 3 + car.vx * 0.3, 0.5 + Math.random() * 2, (Math.random() - 0.5) * 3 + car.vz * 0.3,
      0.18 + Math.random() * 0.15, 0.9, [0.3, 0.5 + Math.random() * 0.15, 0.22]);
  }
  if (!sim) return;
  const slow = Math.min(0.12, 0.04 + 0.04 * it.sc);
  car.vx *= 1 - slow; car.vz *= 1 - slow;
  audio.thud(0.25 + 0.15 * it.sc);
  shakeKick = Math.max(shakeKick, slow);
  dentAt(o.x, o.z, 0.015);
}
const _tq = new THREE.Quaternion();
function updateFlyingRocks(dt) {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i];
    if (f.topple) {
      // Gravity pulls it over faster the further it leans; a small bounce on landing.
      if (f.ang < Math.PI / 2 - 0.08 || f.w > 0.05) {
        f.w += (2 + 7 * Math.sin(f.ang)) * dt;
        f.ang += f.w * dt;
        if (f.ang > Math.PI / 2 - 0.08) {
          f.ang = Math.PI / 2 - 0.08;
          if (f.w > 1) { f.w *= -0.25; if (!f.landed) audio.thud(0.15); f.landed = true; } else f.w = 0;
        }
      }
      f.v.multiplyScalar(Math.exp(-dt * 4));
      f.pos.addScaledVector(f.v, dt);
      f.pos.y = worldGround(f.pos.x, f.pos.z) - 0.25;
      _tq.setFromAxisAngle(f.axis, f.ang);
      f.it.mesh.setMatrixAt(f.it.idx, _m4.compose(f.pos, _q.copy(_tq).multiply(f.base), f.scale));
      f.it.mesh.instanceMatrix.needsUpdate = true;
      if (f.w === 0 && f.v.length() < 0.05) flying.splice(i, 1);
      continue;
    }
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
    if (!o.item.mesh) continue;
    o.item.mesh.setMatrixAt(o.item.idx, o.item.m);
    o.item.mesh.instanceMatrix.needsUpdate = true;
  }
  knocked.length = 0;
}

// Bright, short-lived sparks (metal on rock, a hard landing).
function sparks(x, y, z, n, vx = 0, vz = 0) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
    dust.emit(x, y, z, vx * 0.4 + Math.cos(a) * sp, 1 + Math.random() * 3, vz * 0.4 + Math.sin(a) * sp, 0.12 + Math.random() * 0.1, 0.25 + Math.random() * 0.25, [1, 0.72 + Math.random() * 0.2, 0.3]);
  }
}
function crash(impact) {
  stats.crash();
  sparks(car.x, (car.y ?? 0) + 0.4, car.z, 30, car.vx, car.vz);
  car.yawRate += (Math.random() - 0.5) * Math.min(3, impact * 0.15);
  audio.thud(1);
  input.rumble(1, 1, 450);
  audio.duck(0.3, 1.4);
  shakeKick = 0.45;
  dust.clear();
  for (let n = 0; n < 40; n++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
    dust.emit(car.x, (car.y ?? 0) + 0.6, car.z, Math.cos(a) * sp, 1 + Math.random() * 2, Math.sin(a) * sp, 1.4, 1.6, [0.55, 0.5, 0.42]);
  }
  toast('CRASH!', 900);
  ejectRider(impact);
}

// The armchair passenger is thrown off in a crash, and that's the run over:
// it takes a restart to put him back in his chair.
const riderFall = { on: false, obj: null, v: new THREE.Vector3(), spin: new THREE.Vector3(), rest: 0 };
function ejectRider() {
  const r = model.rider;
  if (!r || riderFall.on || replay.on) return;
  scene.attach(r);                       // keep where he is in the world
  riderFall.on = true; riderFall.obj = r; riderFall.rest = 0;
  const rnd = () => Math.random() - 0.5;
  riderFall.v.set(car.vx * 0.85 + rnd() * 3, 4 + Math.random() * 2.5, car.vz * 0.85 + rnd() * 3);
  riderFall.spin.set(rnd() * 9, rnd() * 6, rnd() * 9);
  audio.thud(0.5);
  if (run.state === 'running') run.state = 'dnf';
  const touch = document.body.classList.contains('touch');
  setTimeout(() => { if (riderFall.on) banner('PASSENGER LOST!', stage.kind === 'practice' ? (touch ? 'Pick him up' : 'Pick him up (R)') : (touch ? 'Restart' : 'Restart (R)'), restartKey); }, 950);
}
function updateRider(dt) {
  const f = riderFall;
  if (!f.on || !f.obj.parent) return;
  const o = f.obj;
  f.v.y -= 9.81 * dt;
  o.position.addScaledVector(f.v, dt);
  const g = worldGround(o.position.x, o.position.z) + 0.15;
  if (o.position.y < g) {
    o.position.y = g;
    if (f.v.y < -2) { f.v.y *= -0.3; f.v.x *= 0.55; f.v.z *= 0.55; f.spin.multiplyScalar(0.5); }
    else { f.v.set(f.v.x * Math.exp(-dt * 5), 0, f.v.z * Math.exp(-dt * 5)); f.spin.multiplyScalar(Math.exp(-dt * 6)); }
  }
  o.rotation.x += f.spin.x * dt; o.rotation.y += f.spin.y * dt; o.rotation.z += f.spin.z * dt;
}
function seatRider() {
  clearBanner();
  if (!riderFall.on) return;
  riderFall.on = false;
  if (riderFall.obj?.parent === scene) scene.remove(riderFall.obj);
  model.seatRider();
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
  inp = handbrakeAssist(inp, dt);
  car.spinCatch = FEEL.hbAssist;
  car.step(dt, inp, flying ? AIR : surface);
  // A low buzz off the road and over rough patches.
  if (!flying && car.speed > 4 && run.state === 'racing') {
    const rough = surface.name === 'grass' ? 0.22 : surface === RUBBLE ? 0.3 : surface.dustK > 1.3 ? 0.12 : 0;
    if (rough) input.rumble(rough * Math.min(1, car.speed / 20), rough, 90);
  }
  hitBarriers();
  if (mpActive() && mp.race.collisions && run.state === 'running') hitCars();
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
      if (car.airTime > 0.12) { if (car.airTime > 1.5 && run.state === 'running') ach.earn('big_air'); settleLanding(inp); onLanding(impact); }
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
  input.rumble(0.2 + k * 0.7, 0.4, 140 + k * 120);
  if (impact > 9) { car.vx *= 0.88; car.vz *= 0.88; }   // a heavy landing costs speed
  if (impact > 6) sparks(car.x, (car.y ?? 0) + 0.15, car.z, Math.min(40, impact * 3), car.vx, car.vz);   // sump on the ground
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
const replay = { on: false, t: 0, end: 0, samples: null, hint: -1, vx: 0, vz: 0, speed: 1, playing: true, auto: true, slow: 1, cam: 'tv' };
// Director controls: speed, auto slow motion on jumps and big slides, and
// a choice of cameras.
const REPLAY_SPEEDS = [0.25, 0.5, 1, 2];
const REPLAY_CAMS = [['tv', 'TV cams'], ['chase', 'Chase'], ['heli', 'Helicopter'], ['wheel', 'Wheel cam'], ['bonnet', 'Bonnet'], ['drone', 'Drone']];
function showReplayCtl() {
  $('rp-speed').textContent = replay.playing ? `${replay.speed}×` : 'PAUSED';
  $('rp-play').textContent = replay.playing ? '❚❚' : '▶';
  $('rp-auto').classList.toggle('on', replay.auto);
  $('rp-cam').textContent = REPLAY_CAMS.find((c) => c[0] === replay.cam)[1];
}
function replaySpeed(dir) {
  const i = REPLAY_SPEEDS.indexOf(replay.speed);
  replay.speed = REPLAY_SPEEDS[Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, i + dir))];
  replay.playing = true; showReplayCtl();
}
function replayCam() {
  const i = REPLAY_CAMS.findIndex((c) => c[0] === replay.cam);
  replay.cam = REPLAY_CAMS[(i + 1) % REPLAY_CAMS.length][0];
  tv.reset();
  if (replay.cam === 'chase' || replay.cam === 'bonnet') { rig.mode = replay.cam; rig.snap(car); }
  showReplayCtl();
}
const camV = new THREE.Vector3();
let heliAng = 0;
function updateReplayCam(dt) {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), y = car.y ?? 0;
  if (replay.cam === 'tv') { tv.update(car, dt, road, replay.along, worldGround, drone); return; }
  if (replay.cam === 'chase' || replay.cam === 'bonnet') { rig.mode = replay.cam; rig.update(car, dt); return; }
  if (replay.cam === 'drone') { camera.position.copy(drone.pos); camera.lookAt(car.x, y + 0.6, car.z); camera.fov = 50; camera.updateProjectionMatrix(); return; }
  if (replay.cam === 'heli') {
    heliAng += dt * 0.25;
    camV.set(car.x + Math.cos(heliAng) * 38, y + 26, car.z + Math.sin(heliAng) * 38);
    camera.position.lerp(camV, Math.min(1, dt * 3));
    camera.lookAt(car.x, y, car.z); camera.fov = 34;
  } else {
    // Wheel cam: low on the side of the car, looking forward past the wheel.
    camera.position.set(car.x + fz * 1.75 - fx * 0.3, y + 0.45, car.z - fx * 1.75 - fz * 0.3);
    camera.lookAt(car.x + fx * 12 + fz * 0.9, y + 0.3, car.z + fz * 12 - fx * 0.9); camera.fov = 62;
  }
  camera.updateProjectionMatrix();
}
// Record a clip of the replay (video, plus the game sound where it can).
let downloadsCap = null;
if (window.claude?.use) window.claude.use('downloads').then((d) => { downloadsCap = d; }).catch(() => {});
const clip = { rec: null, chunks: [], url: null, timer: 0 };
function toggleClip() {
  if (clip.rec) { clip.rec.stop(); return; }
  if (!window.MediaRecorder || !canvas.captureStream) { toast('CLIPS NOT SUPPORTED HERE', 1400); return; }
  const stream = canvas.captureStream(30);
  // Sound too, if it's playing (a stopped audio track can stall the recording).
  if (audio.ctx?.state === 'running' && !muted) { try { audio.stream()?.getAudioTracks().forEach((t) => stream.addTrack(t)); } catch { /* video only */ } }
  const type = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  let rec;
  try { rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 5e6 } : undefined); } catch { toast('CLIPS NOT SUPPORTED HERE', 1400); return; }
  clip.chunks = [];
  rec.ondataavailable = (e) => { clip.sizes = [...(clip.sizes || []), e.data.size]; if (e.data.size) clip.chunks.push(e.data); };
  rec.onstop = () => {
    clip.rec = null; clearTimeout(clip.timer);
    $('rp-clip').classList.remove('recording');
    stream.getVideoTracks().forEach((t) => t.stop());
    if (!clip.chunks.length) { toast('CLIP FAILED', 1200); return; }
    const blob = new Blob(clip.chunks, { type: rec.mimeType || 'video/webm' });
    if (clip.url) URL.revokeObjectURL(clip.url);
    clip.url = URL.createObjectURL(blob);
    const ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
    const name = `sideways-${(stage.name || 'stage').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${ext}`;
    $('clip-video').src = clip.url;
    $('clip-save').href = clip.url; $('clip-save').download = name;
    // Inside claude.ai a plain download link does nothing: hand the file over
    // through the page's downloads permission instead (the viewer confirms).
    $('clip-save').onclick = async (e) => {
      if (!downloadsCap) return;                  // a normal page: the link downloads it
      e.preventDefault();
      try { await downloadsCap.save({ filename: name, data: blob }); toast('CLIP SAVED', 1200); }
      catch (err) { if (err?.code !== 'declined') toast('COULD NOT SAVE THE CLIP HERE', 1600); }
    };
    const file = new File([blob], name, { type: blob.type });
    $('clip-share').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    $('clip-share').onclick = () => navigator.share({ files: [file], title: 'Sideways clip' }).catch(() => {});
    replay.playing = false; showReplayCtl();
    $('clip-panel').hidden = false;
  };
  rec.start(500);
  clip.rec = rec;
  clip.timer = setTimeout(() => clip.rec?.stop(), 30000);      // 30 s at most
  $('rp-clip').classList.add('recording');
  toast('RECORDING · PRESS CLIP AGAIN TO STOP', 1400);
}
$('rp-slow').addEventListener('click', (e) => { e.currentTarget.blur(); replaySpeed(-1); });
$('rp-fast').addEventListener('click', (e) => { e.currentTarget.blur(); replaySpeed(1); });
$('rp-play').addEventListener('click', (e) => { e.currentTarget.blur(); replay.playing = !replay.playing; showReplayCtl(); });
$('rp-auto').addEventListener('click', (e) => { e.currentTarget.blur(); replay.auto = !replay.auto; showReplayCtl(); });
$('rp-cam').addEventListener('click', (e) => { e.currentTarget.blur(); replayCam(); });
$('rp-clip').addEventListener('click', (e) => { e.currentTarget.blur(); toggleClip(); });
$('clip-close').addEventListener('click', () => { $('clip-panel').hidden = true; $('clip-video').pause(); replay.playing = true; showReplayCtl(); });
const replayPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, done: false };
let rigModeBeforeReplay = null;
function startReplay() {
  const smp = recorder.samples;
  if (!smp.length) return;
  rigModeBeforeReplay = rig.mode;
  replay.on = true; replay.t = 0; replay.samples = smp.slice(); replay.end = smp[smp.length - 1][0];
  replay.hint = -1; replay.vx = replay.vz = 0;
  replay.speed = 1; replay.playing = true; replay.slow = 1; replay.cam = 'tv';
  showReplayCtl();
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
  if (clip.rec) clip.rec.stop();
  $('clip-panel').hidden = true;
  rig.mode = rigModeBeforeReplay ?? rig.mode;
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
  // The director drops into slow motion for jumps and big slides.
  const drama = car.air || (car.rearSlide > 0.85 && car.speed > 14);
  replay.slow += ((replay.auto && drama ? 0.35 : 1) - replay.slow) * Math.min(1, dt * (drama ? 8 : 2.5));
  if (replay.t + dt * replay.slow < replay.end + 2) dt *= replay.slow;
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
let lastInp = { throttle: 0, brake: 0, steer: 0, handbrake: false };
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;

  const active = running && !paused && !replay.on;
  if (active) watchFrameRate((now - (frame.prev ?? now)) / 1000);
  countFrame((now - (frame.prev ?? now)) / 1000);
  frame.prev = now;
  // Replay speed: everything (the car, dust, crowds) runs slower or faster.
  if (replay.on) dt *= replay.playing ? replay.speed : 0;
  if (running && !paused && replay.on && dt > 0) updateReplay(dt);
  if (active) {
    acc += dt;
    while (acc >= STEP) {
        const inp = window.__sideways?.auto ? window.__sideways.auto() : input.update(STEP);
      stepPhysics(STEP, inp);
      lastInp = inp;
      acc -= STEP;
    }
    const ev = school.update(dt, car, lastInp);
    if (ev === 'step') audio.beep(988, 0.12);
    if (ev === 'done') {
      audio.fanfare(true);
      // Straight on to a real stage while it's fresh.
      setTimeout(() => { if (running && stage.kind === 'practice') banner('DRIVING SCHOOL DONE!', "Today's stage ▶", () => pickThenStart('daily')); }, 2200);
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
  drone.hidden = replay.on ? (replay.cam === 'tv' ? tv.kind === 'drone' : replay.cam === 'drone') : rig.mode === 'drone';
  model.setCockpit(!replay.on && rig.mode === 'cockpit');
  if (!paused) drone.update(car, dt, worldGround);
  if (replay.on) { if (!paused) updateReplayCam(Math.max(dt, 1e-4)); }
  else if (flyover.on) updatePreview();
  else rig.update(car, dt);
  world.sky.position.copy(camera.position);
  if (!paused) { dust.update(dt); updateFlyingRocks(dt); updateRider(dt); }
  if (!paused && trackside) crowdNoise = trackside.update(dt, car.x, car.z, { air: car.air && car.airTime > 0.1, speed: car.speed, dark: lampGlow > 0.6 }) || 0;
  if (!paused && (echoT -= dt) <= 0) { echoT = 0.25; measureEcho(); }
  if (skyPlan && road) updateSky(replay.on ? replay.along : roadAlong);
  // Street circuits: yachts bob; after dark, fireworks over the town.
  if (marina && harbour && stage.theme?.street) marina.update(performance.now() / 1000);
  if (!paused) {
    const fwOn = running && !!stage.theme?.street && (weather.dark || weather.id === 'dusk');
    fireworks.update(dt, fwOn, harbour ? { x: harbour.cx, z: harbour.cz, y: harbour.y } : { x: car.x, z: car.z, y: car.y ?? 0 },
      (v, delay) => setTimeout(() => { if (running) audio.thud(v * 0.6); }, delay * 1000));
  }
  mpFrame(dt);
  // Tunnels: lights on inside, back to how they were outside.
  if (road?.tunnels?.length) {
    const inside = inTunnelAt(replay.on ? replay.along : roadAlong);
    const want = Math.max(stage.lamps || 0, inside ? 110 : 0);
    if (headlights[0].intensity !== want) { headlights.forEach((l) => { l.intensity = want; }); model.setGlow(Math.max(lampGlow, inside ? 0.9 : 0)); }
    // No rain or snow under the roof.
    if (rain.group) rain.group.visible = !inside;
    if (precip.mesh) precip.mesh.visible = !inside;
  }
  if (!paused) beamDust.update(dt, car, headlights[0].intensity / 140 * (lampGlow > 0.6 ? 1 : 0), stage.theme?.id === 'nightwood' ? 2 : 0.8);
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
  if (active) audio.setEnv({ crowd: crowdNoise, echo: echo.k, delay: echo.delay });
  if (running) updateHud(dt);
  if (running && mapOn) minimap.draw(car, replay.on ? replay.along : roadAlong, ghostModel ? ghostPose : null, dt);
  retro.render(renderer, scene, camera);
}
// Boot: build today's stage behind the menu, then start the loop.
loadStage('daily', dateSeed());
requestAnimationFrame(frame);

// ---------- Frame-rate readout ----------
const fpsMeter = { on: false, n: 0, t: 0 };
try { fpsMeter.on = localStorage.getItem('sideways.fps') === '1'; } catch { /* ignore */ }
$('opt-fps').checked = fpsMeter.on;
$('hud-fps').hidden = !fpsMeter.on;
$('opt-fps').addEventListener('change', (e) => {
  fpsMeter.on = e.target.checked; $('hud-fps').hidden = !fpsMeter.on;
  try { localStorage.setItem('sideways.fps', fpsMeter.on ? '1' : '0'); } catch { /* ignore */ }
});
function countFrame(realDt) {
  if (!fpsMeter.on) return;
  fpsMeter.n++; fpsMeter.t += realDt;
  if (fpsMeter.t < 0.5) return;
  const q = qualityLevel();
  $('hud-fps').textContent = `${Math.round(fpsMeter.n / fpsMeter.t)} FPS · ${q.toUpperCase()}`;
  fpsMeter.n = 0; fpsMeter.t = 0;
}

// ---------- Offline install ----------
// As an installed app (from a real web address, not inside another page),
// a service worker keeps the game playable with no connection.
if ('serviceWorker' in navigator && document.querySelector('link[rel="manifest"]') && window.top === window.self
  && (location.protocol === 'https:' || location.hostname === 'localhost') && !navigator.webdriver) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; $('btn-install').hidden = false; });
window.addEventListener('appinstalled', () => { installPrompt = null; $('btn-install').hidden = true; toast('INSTALLED · PLAYS OFFLINE TOO', 1600); });
$('btn-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  try { await installPrompt.userChoice; } catch { /* ignore */ }
  installPrompt = null; $('btn-install').hidden = true;
});

// ---------- Loading tips and the stage fly-over ----------
const TIPS = [
  'Tap the brake as you turn in to kick the tail out, then hold the throttle to keep it sliding.',
  'Lift off mid-corner to rotate the car more; counter-steer to straighten up.',
  'The handbrake swings the tail round hairpins. Too slow for it? Try Handbrake assist in Pause → Driving.',
  'Pace notes count down from 6 (flat out) to 1 (very tight). Hairpins are tighter still.',
  'T puts you back at the last checkpoint for a 5 second penalty: quicker than limping back.',
  'Shortcuts hide where the road doubles back: rough tracks marked with arrows.',
  'Crests go light: lift a little before them or the car lands wherever it likes.',
  'Rain cuts grip and darkens the road. Brake earlier and be gentle.',
  'Tarmac grips far more than gravel: you can carry much more speed into corners.',
  'Each stage has bronze, silver and gold targets. Gold pace is shown at the top of the screen.',
  'Race a friend\'s ghost from the finish-screen leaderboard with the Race button.',
  'Multiplayer: make a private lobby and send your friends the code.',
  'C changes camera. Try the cockpit view for maximum fear.',
  'Every stage has a code (Pause menu). Share it and your friends drive exactly the same road.',
  'In career, restarting costs 10 seconds. Survive first, then go fast.',
  'Watch the replay after a finish: slow-mo, six cameras, and you can save a clip.',
];
// Before the countdown on a newly loaded stage: the camera sweeps along the
// first part of the road, high up, then drops back to the car. Any key,
// tap or button skips it.
const flyover = { on: false, enabled: true, t0: 0, dur: 6000 };
try { flyover.enabled = localStorage.getItem('sideways.preview') !== '0' && !navigator.webdriver; } catch { /* ignore */ }
$('opt-preview').checked = flyover.enabled;
$('opt-preview').addEventListener('change', (e) => {
  flyover.enabled = e.target.checked;
  try { localStorage.setItem('sideways.preview', e.target.checked ? '1' : '0'); } catch { /* ignore */ }
});
function startPreview() {
  flyover.on = true; flyover.t0 = performance.now();
  const el = $('hud-count'); el.textContent = 'STAGE PREVIEW · ANY KEY SKIPS'; el.classList.add('wait'); el.classList.remove('go'); el.hidden = false;
}
function endPreview() {
  if (!flyover.on) return;
  flyover.on = false;
  const el = $('hud-count'); el.classList.remove('wait'); el.hidden = true;
  camera.fov = 70; camera.updateProjectionMatrix();
  rig.snap(car);
}
function updatePreview() {
  const u = Math.min(1, (performance.now() - flyover.t0) / flyover.dur);
  if (u >= 1 || !running) { endPreview(); return; }
  const span = Math.min(900, (stage.finish - stage.start) * 0.5);
  const e = u * u * (3 - 2 * u);
  const a = stage.start + 40 + e * span;
  const p = road.indexAt(a), q = road.indexAt(Math.min(road.length - 1, a + 70));
  const h = 34 - 10 * Math.sin(u * Math.PI);
  camera.position.set(road.px[p] - road.tx[p] * 30 + road.tz[p] * 12, road.py[p] + h, road.pz[p] - road.tz[p] * 30 - road.tx[p] * 12);
  camera.lookAt(road.px[q], road.py[q], road.pz[q]);
  camera.fov = 55; camera.updateProjectionMatrix();
}
const skipPreview = () => { if (flyover.on) endPreview(); };
window.addEventListener('keydown', skipPreview, true);
window.addEventListener('pointerdown', skipPreview, true);
input.on('pad', skipPreview);

// ---------- Achievements and title-screen settings ----------
const ach = new Achievements((a) => {
  toast(`★ ACHIEVEMENT: ${a.name.toUpperCase()}`, 2600);
  audio.beep(1320, 0.12); setTimeout(() => audio.beep(1760, 0.16), 120);
  renderAchCount();
});
const achCtx = () => ({ s: stats.d, u: unlockState(stats.d) });
function checkAch() { ach.check(achCtx()); }
function renderAchCount() { const l = ach.list(achCtx()); $('ach-count').textContent = `${l.filter((a) => a.at).length}/${l.length}`; }
function renderAch() {
  const l = ach.list(achCtx()), n = l.filter((a) => a.at).length;
  $('ach-sub').textContent = `${n} of ${l.length} earned`;
  // Earned first (newest first), then the rest by how close you are.
  l.sort((a, b) => (!!b.at - !!a.at) || (b.at || 0) - (a.at || 0) || ((b.have ?? 0) / (b.want || 1)) - ((a.have ?? 0) / (a.want || 1)));
  $('ach-grid').innerHTML = l.map((a) => `<div class="ach${a.at ? ' got' : ''}"><b>${esc(a.name)}</b><small>${esc(a.desc)}</small>${
    a.at ? `<small>Earned ${new Date(a.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</small>`
      : a.want ? `<small>${a.have} / ${a.want}</small><div class="prog"><i style="width:${Math.round(100 * a.have / a.want)}%"></i></div>` : ''}</div>`).join('');
}
$('btn-ach').addEventListener('click', () => { checkAch(); openPage('ach'); renderAch(); });
checkAch(); renderAchCount();
// Settings from the title: the pause menu's settings panel is moved into
// this page while it's open, and put back when it closes.
const settingsPanel = document.querySelector('.pause-settings');
const settingsParent = settingsPanel.parentNode, settingsNextSib = settingsPanel.nextSibling;
function settingsHome() { if (settingsPanel.parentNode !== settingsParent) settingsParent.insertBefore(settingsPanel, settingsNextSib); }
$('btn-settings').addEventListener('click', () => { $('settings-body').appendChild(settingsPanel); openPage('settings'); });

// ---------- Track editor ----------
// Build a stage from pieces; the code holds everything, so it can be shared.
const ed = { theme: 'forest', weather: 'clear', hills: 1, pieces: 'sLlRkshSj' };
try { Object.assign(ed, JSON.parse(localStorage.getItem('sideways.editor') || '{}')); } catch { /* ignore */ }
const ED_THEME_LBL = { forest: 'Forest', desert: 'Canyon', snow: 'Snow', alpine: 'Alpine', autumn: 'Autumn', tarmac: 'Tarmac', street: 'Street', country: 'Countryside', cliff: 'Mountain edge', nightwood: 'Night forest' };
const ED_PIECE_ICON = { s: '│ Straight', S: '┃ Long straight', l: '↖ Sweeper', r: '↗ Sweeper', L: '↰ Corner', R: '↱ Corner', h: '⟲ Hairpin', H: '⟳ Hairpin', c: '⤨ Chicane L', C: '⤧ Chicane R', e: '∿ Esses L', E: '∿ Esses R', j: '⤴ Jump', k: '⌒ Crest' };
function edDef() { return parseStageCode(encodeStage(ed)); }
function renderEditor() {
  $('ed-pieces').innerHTML = Object.keys(EDIT_PIECES).map((p) => `<button class="btn btn-sm" data-piece="${p}" title="${EDIT_PIECES[p]}">${ED_PIECE_ICON[p]}</button>`).join('');
  const chips = (list, cur, attr, lbl) => list.map((v, i) => `<button class="chip${v === cur ? ' on' : ''}" data-${attr}="${v}">${lbl ? lbl(v, i) : v}</button>`).join('');
  $('ed-theme').innerHTML = chips(EDIT_THEMES, ed.theme, 'edt', (v) => ED_THEME_LBL[v]);
  $('ed-weather').innerHTML = chips(EDIT_WEATHER, ed.weather, 'edw', (v) => v[0].toUpperCase() + v.slice(1));
  $('ed-hills').innerHTML = chips(['0', '1', '2', '3'], String(ed.hills), 'edh', (v) => ['Flat', 'Rolling', 'Hilly', 'Mountains'][+v]);
  const def = edDef();
  $('ed-code').textContent = def ? def.code : '—';
  // Map from above: start green, finish chequered, jumps and crests marked.
  const { xs, zs, marks } = layPieces(ed.pieces);
  const crossing = selfCrossing(xs, zs);
  const cv = $('ed-map'), g = cv.getContext('2d'), W = cv.width;
  g.clearRect(0, 0, W, W);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const sc = (W - 40) / Math.max(maxX - minX, maxZ - minZ, 200);
  // Forward is up the map; the road's left (+x in the generator) is on the left.
  const P = (i) => [20 + (maxX - xs[i]) * sc + ((W - 40) - (maxX - minX) * sc) / 2, W - 20 - ((zs[i] - minZ) * sc + ((W - 40) - (maxZ - minZ) * sc) / 2)];
  g.lineCap = g.lineJoin = 'round';
  for (const [w, c] of [[7, 'rgba(0,0,0,0.6)'], [3.5, crossing ? '#ff6b5a' : '#f1e9da']]) {
    g.strokeStyle = c; g.lineWidth = w; g.beginPath();
    xs.forEach((_, i) => { const [u, v] = P(i); if (i) g.lineTo(u, v); else g.moveTo(u, v); }); g.stroke();
  }
  const dot = (i, c, r = 6) => { const [u, v] = P(i); g.fillStyle = c; g.beginPath(); g.arc(u, v, r, 0, Math.PI * 2); g.fill(); };
  dot(Math.min(xs.length - 1, 12), '#2bd47a'); dot(xs.length - 36, '#ffffff');
  for (const m of marks) dot(Math.round(m.at / 2), m.kind === 'jump' ? '#ffb000' : '#3fc6d1', 4);
  const km = ((xs.length - 1) * 2 / 1000).toFixed(2);
  $('ed-info').textContent = crossing ? `${km} km · The road crosses or touches itself: change some pieces to drive it.` : `${km} km · ${ed.pieces.length} pieces · green = start`;
  $('ed-info').className = `ed-info${crossing ? ' bad' : ''}`;
  $('ed-go').disabled = crossing || ed.pieces.length < 3;
  try { localStorage.setItem('sideways.editor', JSON.stringify(ed)); } catch { /* ignore */ }
}
$('btn-editor').addEventListener('click', () => { openPage('editor'); renderEditor(); });
$('editor').addEventListener('click', (e) => {
  const p = e.target.closest('[data-piece]'), t = e.target.closest('[data-edt]'), w = e.target.closest('[data-edw]'), h = e.target.closest('[data-edh]');
  if (p && ed.pieces.length < 80) ed.pieces += p.dataset.piece;
  if (t) ed.theme = t.dataset.edt;
  if (w) ed.weather = w.dataset.edw;
  if (h) ed.hills = +h.dataset.edh;
  if (p || t || w || h) renderEditor();
});
$('ed-undo').addEventListener('click', () => { ed.pieces = ed.pieces.slice(0, -1); renderEditor(); });
$('ed-clear').addEventListener('click', () => { ed.pieces = ''; renderEditor(); });
$('ed-copy').addEventListener('click', (e) => { const d = edDef(); if (d) copyText(d.code, e.currentTarget); });
$('ed-load').addEventListener('submit', (e) => {
  e.preventDefault();
  const d = parseStageCode(cleanCodeText($('ed-in').value));
  if (!d) { toast('THAT ISN\'T AN EDITOR CODE', 1400); return; }
  Object.assign(ed, { theme: d.theme, weather: d.weather, hills: d.hills, pieces: d.pieces });
  renderEditor();
});
$('ed-go').addEventListener('click', () => {
  const d = edDef();
  if (!d) return;
  d.name = 'Custom stage';
  pickThenStart('random', registerStage(d));
});

// ---------- Weekly online event ----------
// One special stage a week for everyone (the type rotates), with its own
// shared leaderboard. The code comes from the week number, so every player
// gets the same road without anything being stored.
const EVENT_TYPES = ['street', 'cliff', 'country', 'tarmac', 'night', 'river'];
function eventInfo(date = new Date()) {
  const w = weekInfo(date);
  const type = EVENT_TYPES[((w.weekNo % EVENT_TYPES.length) + EVENT_TYPES.length) % EVENT_TYPES.length];
  const seed = TYPE_BASE[type] + (((w.weekNo * 2654435761) >>> 0) % 300000);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (7 - ((date.getDay() + 6) % 7)));
  return { ...w, type, seed, end };
}
function renderEvent() {
  const ev = eventInfo();
  $('event-week').textContent = `Week of ${ev.label}`;
  $('event-stage').textContent = `${stageName(ev.seed)} · ${SPECIAL_LABEL[ev.type]} · code ${ev.seed}`;
  const days = Math.max(0, Math.ceil((ev.end - new Date()) / 86400000));
  $('event-ends').textContent = `Ends in ${days} day${days === 1 ? '' : 's'}.`;
  const mine = (() => { try { return JSON.parse(localStorage.getItem('sideways.best.' + ev.seed) || 'null'); } catch { return null; } })();
  if (!board.available) {
    $('event-table').innerHTML = '';
    $('event-you').textContent = `${mine ? `Your best: ${fmt(mine.time)}. ` : ''}The shared leaderboard is on the claude.ai page of the game.`;
    return;
  }
  const top = board.top(ev.seed, 20), r = board.rank(ev.seed);
  $('event-table').innerHTML = '<tr><th>#</th><th>Driver</th><th>Car</th><th>Time</th></tr>' + (top.length ? top.map((x, i) =>
    `<tr class="${x.me ? 'you' : ''}"><td>${i + 1}</td><td>${esc(x.nick)}</td><td>${esc(x.car || '')}</td><td>${fmt(x.t)}</td></tr>`).join('') : '<tr><td colspan="4">No times yet. Be the first!</td></tr>');
  $('event-you').textContent = r ? `You're ${ordinal(r.pos)} of ${r.of}.` : mine ? `Your best: ${fmt(mine.time)}` : 'You haven\'t set a time yet.';
}
$('btn-event').addEventListener('click', () => { openPage('event'); renderEvent(); });
$('event-go').addEventListener('click', () => pickThenStart('random', eventInfo().seed));

// ---------- Multiplayer ----------
function mpActive() { return !!(net.inLobby && mp.race && road && stage.seed === mp.race.seed && stage.kind === mp.race.kind); }
const players = () => net.peers.filter((p) => p.kind === 'viewer').map(readPlayer);
const amHost = () => { const h = net.hostPeer(); return !!h && h.sameTab; };
function myNick() { return cleanNick($('mp-nick').value) || board.nick || 'Driver'; }
const MP_STAGES = [['daily', "Today's"], ['gravel', 'Random gravel'], ['tarmac', 'Tarmac'], ['street', 'Street circuit'], ['cliff', 'Mountain edge'], ['country', 'Countryside'], ['night', 'Night forest'], ['river', 'River crossings'], ['classic', 'A Classic']];
function mpPick(type) {
  let seed;
  if (type === 'daily') seed = dateSeed();
  else if (type === 'classic') seed = CLASSICS[Math.floor(Math.random() * CLASSICS.length)].seed;
  else if (type === 'gravel') seed = 100000 + Math.floor(Math.random() * 900000);
  else seed = TYPE_BASE[type] + Math.floor(Math.random() * 3e5);
  return { type, seed, kind: kindOfCode(seed), collisions: mp.setup?.collisions ?? true };
}
function myPresence() { return { nick: myNick(), car: carId, color: garage.color, st: 'lobby' }; }
// What went wrong, in words, for the lobby screen.
const MP_ERRORS = {
  not_permitted: "This account isn't allowed into live lobbies on this page. Everyone must be signed in to claude.ai and invited from the page's Share menu by name or email (a public link can't join lobbies).",
  not_granted: "Live lobbies aren't available to this viewer. Everyone must be signed in to claude.ai and invited from the page's Share menu by name or email (a public link can't join lobbies).",
  revoked: 'Access to this page changed. Reload it.',
  limit_reached: 'Too many lobbies open in this tab. Leave one or reload, then try again.',
  upstream_error: "Couldn't reach the live lobby server. Check your connection and try again.",
  invalid_argument: 'Something in the lobby data was refused. Try a shorter name.',
};
function mpStatus(text, kind = '') {
  $('mp-status').hidden = !text;
  $('mp-status').textContent = text || '';
  $('mp-status').className = `mp-status ${kind}`;
}
net.onStatus = (connected, code) => {
  if (code) mpStatus(MP_ERRORS[code] || `Lobby problem (${code}).`, 'bad');
  else if (net.inLobby && !connected) mpStatus('Reconnecting…');
  else if (net.inLobby) renderLobby();
};
async function mpConnect() {
  if (net.room === undefined) mpStatus('Connecting to live lobbies…');
  const ok = await net.available();
  if (!ok) { mpStatus(net.timedOut ? "claude.ai's live lobby service isn't answering on this page. Reload and try again; if it keeps happening, live lobbies aren't working in this view." : MP_ERRORS.not_granted, 'bad'); renderLobby(); }
  return ok;
}
async function mpCreate() {
  if (!(await mpConnect())) return;
  mp.setup = mpPick('daily');
  mpStatus('Opening a lobby…');
  try { await net.join(newCode(), { ...myPresence(), host: true, setup: mp.setup }); } catch (e) { mpStatus(MP_ERRORS[e?.code] || `Couldn't open a lobby (${e?.code || e}).`, 'bad'); return; }
  mpStatus('');
  renderLobby();
}
async function mpJoin(code) {
  code = cleanCode(code);
  if (code.length < 4) { mpStatus('Type the lobby code your friend sent you.', 'bad'); return; }
  if (!(await mpConnect())) return;
  mpStatus('Joining…');
  try { await net.join(code, myPresence()); } catch (e) { mpStatus(MP_ERRORS[e?.code] || `Couldn't join that lobby (${e?.code || e}).`, 'bad'); return; }
  mpStatus('');
  renderLobby();
}
async function mpLeave() { await net.leave(); mp.race = null; remote.clear(); mpStatus(''); renderLobby(); }
function mpSetSetup(patch) { mp.setup = { ...mp.setup, ...patch }; net.set({ setup: mp.setup }); renderLobby(); }
function mpStartRace() {
  if (!amHost() || !mp.setup) return;
  const race = { id: Date.now().toString(36), seed: mp.setup.seed, kind: mp.setup.kind, collisions: !!mp.setup.collisions, go: false, ...(mp.setup.code ? { code: mp.setup.code } : {}) };
  mp.goTimer = performance.now();
  net.set({ host: true, race });
}
// Someone's in a new race: load it and line up on the grid.
function mpEnter(race) {
  // A player-made stage travels as its editor code: register it here first.
  if (race.code) { const d = parseStageCode(race.code); if (d && d.seed === race.seed) registerStage(d); }
  const order = players().filter((p) => p.st !== 'racing').map((p) => p.peer).sort();
  mp.race = race; mp.hold = !race.go;
  mp.slot = Math.max(0, order.indexOf(net.me()?.peer));
  net.set({ st: 'loading', rid: race.id, fin: null, p: null, a: 0 });
  careerRun = null;
  if (running) toMenu();
  hidePages();
  $('finish').hidden = true;
  launchStage({ kind: race.kind, seed: race.seed });
}
// Called from restartRun: put the car in its grid slot (two abreast,
// rows 7 m apart behind the line) and say we're ready.
function mpOnGrid() {
  const row = Math.floor(mp.slot / 2), side = mp.slot % 2 ? -1 : 1;
  const i = road.indexAt(Math.max(2, stage.start - 2.5 - row * 7));
  placeOnRoad(i);
  car.x += road.tz[i] * side * 1.8; car.z += -road.tx[i] * side * 1.8;
  mp.hold = !mp.race.go;
  if (mp.hold) { const el = $('hud-count'); el.textContent = 'WAITING FOR PLAYERS'; el.classList.add('wait'); el.classList.remove('go'); el.hidden = false; }
  net.set({ st: 'ready', rid: mp.race.id });
}
function mpGo() {
  mp.hold = false;
  const el = $('hud-count'); el.classList.remove('wait'); el.hidden = true;
}
function mpToLobby() {
  mp.race = null; mp.hold = false;
  remote.clear();
  $('hud-mp').hidden = true; $('fin-mp').hidden = true;
  net.set({ st: 'lobby', rid: '', fin: null, p: null, a: 0 });
  toMenu();
  openPage('mp'); renderLobby();
}
// Race order: finishers by time, then everyone still going by distance.
function mpStandings() {
  const ps = players().filter((p) => p.rid === mp.race?.id);
  const rank = (p) => (p.st === 'done' ? 0 : p.st === 'dnf' ? 2 : 1);
  return ps.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.fin - b.fin : b.along - a.along));
}
function mpShowFin() {
  const list = mpStandings();
  const win = list.find((p) => p.st === 'done');
  if (list.length > 1 && list.every((p) => p.st !== 'racing') && win?.me) ach.earn('mp_win');
  $('fin-mp').hidden = false;
  $('fin-mp').innerHTML = `<table>${list.map((p, k) => `<tr class="${p.me ? 'you' : ''}"><td>${k + 1}</td><td>${carDot(p.color)}${esc(p.nick)}</td><td>${
    p.st === 'done' ? (p === win ? fmt(p.fin) : '+' + fmt(p.fin - win.fin)) : p.st === 'dnf' ? 'DNF' : 'racing…'}</td></tr>`).join('')}</table>`;
  $('btn-next').hidden = false; $('btn-next').textContent = 'Lobby ▶';
  $('btn-retry').hidden = true;
}
// The lobby changed: follow the host's race, and (as host) say go once
// everyone in it has loaded.
net.onChange = () => {
  const host = net.hostPeer(), hp = host ? readPlayer(host) : null;
  const race = readRace(hp?.race);
  if (race && race.id !== mp.seen) {
    mp.seen = race.id;
    const me = net.me() ? readPlayer(net.me()) : null;
    if (!me || !['loading', 'ready', 'racing'].includes(me.st) || me.rid === race.id) mpEnter(race);
  }
  if (race && mp.race && race.id === mp.race.id && race.go && mp.hold) mpGo();
  if (amHost() && race && !race.go && mp.race?.id === race.id) {
    const inRace = players().filter((p) => p.rid === race.id);
    const ready = inRace.every((p) => p.st === 'ready');
    if ((ready && inRace.length) || performance.now() - mp.goTimer > 15000) net.set({ race: { ...race, go: true } });
  }
  if (!$('mp').hidden) renderLobby();
  if (mpActive() && run.state === 'finished') mpShowFin();
};
// Every frame: send our position, draw the others, update P1/P2.
function mpFrame(dt) {
  if (!mpActive()) { if (remote.cars.size) remote.clear(); $('hud-mp').hidden = true; mp.poses = []; return; }
  const now = performance.now();
  if (now - mp.sendT > 66 && !mp.hold) {
    mp.sendT = now;
    const r2 = (v) => Math.round(v * 100) / 100;
    const st = run.state === 'running' ? 'racing' : run.state === 'finished' ? 'done' : run.state === 'dnf' ? 'dnf' : 'ready';
    const patch = { p: [r2(car.x), r2(car.y ?? 0), r2(car.z), r2(car.yaw), r2(car.groundPitch || 0), r2(car.groundRoll || 0)], a: Math.round(roadAlong), st };
    if (st === 'done') patch.fin = Math.round(run.t * 1000) / 1000;
    net.set(patch);
  }
  // A late hold: the host said go before this page finished loading.
  remote.update(players().filter((p) => !p.me && p.rid === mp.race.id), now);
  mp.poses = remote.render(now, dt);
  if (now - mp.posT > 250 && (run.state === 'running' || run.state === 'finished')) {
    mp.posT = now;
    const list = mpStandings(), k = list.findIndex((p) => p.me);
    if (k >= 0 && list.length > 1) {
      const ahead = list[k - 1];
      const gap = ahead && ahead.st !== 'done' ? (ahead.along - roadAlong) / Math.max(car.speed, 8) : null;
      $('hud-mp').innerHTML = `P${k + 1}<small>/ ${list.length}${gap != null && gap > 0 ? ` · +${gap.toFixed(1)}s to ${esc(ahead.nick)}` : k === 0 ? ' · LEADING' : ''}</small>`;
      $('hud-mp').hidden = false;
    }
  }
}
// Everyone on the page right now (all lobbies), for the open-lobby list and
// a small readout of what claude.ai's live room reports.
function roomPeople() { try { return net.room ? net.room.peers().filter((p) => p.kind === 'viewer') : []; } catch { return []; } }
let roomWatch = null;
function watchRoom() {
  if (roomWatch || !net.room) return;
  roomWatch = net.room.onPeers(() => { if (!$('mp').hidden) renderLobby(); }, () => {});
}
function renderLobby() {
  const ok = net.room !== null;
  if (ok) watchRoom();
  const everyone = roomPeople();
  const lobbies = {};
  for (const p of everyone) { const lb = p.presence?.lb; if (typeof lb === 'string') lobbies[lb] = (lobbies[lb] || 0) + 1; }
  $('mp-diag').textContent = ok ? `Live: ${everyone.length} on this page (you included) · ${Object.keys(lobbies).length ? Object.entries(lobbies).map(([c, n]) => `${c.toUpperCase()}×${n}`).join(' ') : 'no lobbies open'} · ${net.room.connected?.() ? 'connected' : 'not connected'}` : '';
  // Open lobbies anyone can tap to join (hosts only, not yours).
  const open = everyone.filter((p) => !p.sameTab && p.presence?.host && typeof p.presence.lb === 'string' && p.presence.lb !== net.code);
  $('mp-open').innerHTML = !net.inLobby && open.length ? '<p class="hint">Open lobbies on this page:</p>' + open.map((p) => { const pl = readPlayer(p); return `<button class="btn btn-sm" data-joinlb="${esc(p.presence.lb)}">Join ${esc(pl.nick)} · ${esc(p.presence.lb.toUpperCase())}</button>`; }).join('') : '';
  $('mp-off').hidden = net.room !== null;
  $('mp-entry').hidden = !ok || net.inLobby;
  $('mp-lobby').hidden = !net.inLobby;
  $('mp-sub').textContent = net.inLobby ? `In lobby ${net.code.toUpperCase()} · ${players().length} player${players().length === 1 ? '' : 's'}` : 'Private lobbies: race your friends live';
  if (!net.inLobby) return;
  $('mp-codeval').textContent = net.code.toUpperCase();
  if (!$('mp-status').classList.contains('bad')) {
    mpStatus(players().length < 2 ? `Waiting for others. Send them the code ${net.code.toUpperCase()}; they open this same page, press Multiplayer and type it in.` : `Connected · ${players().length} players in the lobby`, players().length < 2 ? '' : 'good');
  }
  const host = net.hostPeer(), hp = host ? readPlayer(host) : null, iHost = amHost();
  const setup = iHost ? mp.setup : hp?.setup;
  $('mp-players').innerHTML = '<tr><th></th><th>Driver</th><th>Car</th><th></th></tr>' + players().map((p) =>
    `<tr class="${p.me ? 'you' : ''}"><td>${carDot(p.color)}</td><td>${esc(p.nick)}${p.peer === host?.peer ? '<span class="tag">HOST</span>' : ''}${p.me ? '<span class="tag">YOU</span>' : ''}</td><td>${esc(CARS[p.car].name)}</td><td>${{ lobby: 'in lobby', loading: 'loading…', ready: 'on the grid', racing: 'racing', done: 'finished', dnf: 'DNF' }[p.st]}</td></tr>`).join('');
  $('mp-hostctl').hidden = !iHost;
  $('mp-start').hidden = !iHost;
  if (iHost && !mp.setup) mp.setup = mpPick('daily');
  if (iHost) {
    $('mp-stage').innerHTML = MP_STAGES.map(([v, l]) => `<button class="chip${mp.setup.type === v ? ' on' : ''}" data-mps="${v}">${l}</button>`).join('');
    document.querySelectorAll('#mp-coll [data-coll]').forEach((b) => b.classList.toggle('on', (b.dataset.coll === '1') === !!mp.setup.collisions));
  }
  const seed = Number.isInteger(setup?.seed) ? setup.seed : null;
  if (seed && setup.code && !CUSTOM_STAGES.has(seed)) { const d = parseStageCode(String(setup.code)); if (d && d.seed === seed) registerStage(d); }
  $('mp-setup').textContent = seed ? `${stageTitle(kindOfCode(seed) || 'random', seed)} · code ${seed} · collisions ${setup.collisions ? 'ON' : 'OFF'}${iHost ? '' : ' · waiting for the host to start'}` : 'Waiting for the host…';
}
$('btn-mp').addEventListener('click', async () => {
  openPage('mp');
  if (!$('mp-nick').value) $('mp-nick').value = board.nick || '';
  await mpConnect();
  renderLobby();
  if (net.inLobby) net.set(myPresence());
});
$('mp-create').addEventListener('click', () => mpCreate());
$('mp-open').addEventListener('click', (e) => { const b = e.target.closest('[data-joinlb]'); if (b) mpJoin(b.dataset.joinlb); });
$('mp-joinform').addEventListener('submit', (e) => { e.preventDefault(); mpJoin($('mp-code').value); });
$('mp-leave').addEventListener('click', () => mpLeave());
$('mp-start').addEventListener('click', () => mpStartRace());
$('mp-car').addEventListener('click', () => openGarage('browse'));
$('mp-copy').addEventListener('click', () => copyText(net.code.toUpperCase()).then(() => toast('LOBBY CODE COPIED', 1000)));
$('mp-nick').addEventListener('change', () => { if (net.inLobby) net.set({ nick: myNick() }); });
$('mp-stage').addEventListener('click', (e) => { const b = e.target.closest('[data-mps]'); if (b) mpSetSetup(mpPick(b.dataset.mps)); });
$('mp-coll').addEventListener('click', (e) => { const b = e.target.closest('[data-coll]'); if (b) mpSetSetup({ collisions: b.dataset.coll === '1' }); });
$('mp-seedform').addEventListener('submit', (e) => {
  e.preventDefault();
  const txt = cleanCodeText($('mp-seed').value), def = /^SW-/.test(txt) ? parseStageCode(txt) : null;
  const n = def ? registerStage(def) : Number(txt);
  const kind = kindOfCode(n);
  if (!kind) { toast('NOT A STAGE CODE', 1200); return; }
  mpSetSetup({ type: 'code', seed: n, kind, code: def ? def.code : null });
});

// ---------- Career ----------
const podium = new Podium($('podium-canvas'));
function inCareerStage() { return !!careerRun && stage.seed === careerRun.seed && stage.kind === 'random'; }
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const carDot = (c) => `<span class="car-dot" style="background:${/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#888'}"></span>`;
function renderCareer() {
  if (!career) career = newCareer();
  const plan = seasonPlan(career.season);
  $('career-eyebrow').textContent = `Season ${career.season} · ${TIERS[career.tier].label} class${career.titles ? ` · ${career.titles} title${career.titles > 1 ? 's' : ''}` : ''}`;
  $('career-cal').innerHTML = '<tr><th>#</th><th>Rally</th><th>Result</th></tr>' + plan.map((r, k) => {
    const res = career.results.find((x) => x.rally === k);
    const now = k === career.rally;
    const status = res ? `${ordinal(res.pos)}` : now ? (career.stage ? `SS${career.stage + 1} next` : 'Next') : '';
    return `<tr class="${now ? 'now' : ''}"><td>${k + 1}</td><td>${esc(r.name)}<small>${r.label} · 3 stages</small></td><td>${status}</td></tr>`;
  }).join('');
  $('career-table').innerHTML = '<tr><th>Pos</th><th>Driver</th><th>Pts</th></tr>' + standings(career).map((x, i) =>
    `<tr class="${x.you ? 'you' : ''}"><td>${i + 1}</td><td>${carDot(x.you ? garage.color : x.color)}${esc(x.name)}<small>${x.you ? CARS[career.car || carId].name : CARS[x.car].name}</small></td><td>${x.pts}</td></tr>`).join('');
  const L = career.lastRally && career.showLast ? career.lastRally : null;
  $('career-last').hidden = !L;
  if (L) {
    const me = L.cls.findIndex((x) => x.you), win = L.cls[0].t;
    $('career-last').innerHTML = `<b>${esc(plan[L.rally]?.name || 'Rally')}: you finished ${ordinal(me + 1)}</b> (+${[25, 18, 15, 12, 10, 8, 6, 4][me] || 0} pts)` +
      `<ol>${L.cls.map((x, i) => `<li class="${x.you ? 'you' : ''}">${esc(x.name)} <small>${i ? '+' + fmt(x.t - win) : fmt(x.t)}</small></li>`).join('')}</ol>`;
  }
  // Service park: credits and upgrades.
  $('career-credits').textContent = career.credits || 0;
  $('career-shop').innerHTML = UPGRADES.map((u) => {
    const lvl = career.up?.[u.id] || 0, cost = u.cost[lvl];
    return `<div class="shop-item"><b>${u.name}</b><small>${u.desc}</small><span class="pips">${'■'.repeat(lvl)}${'□'.repeat(u.cost.length - lvl)}</span>` +
      (cost == null ? '<button class="btn btn-sm" disabled>Maxed</button>' : `<button class="btn btn-sm" data-buy="${u.id}"${(career.credits || 0) < cost ? ' disabled' : ''}>Buy ${cost}</button>`) + '</div>';
  }).join('');
  const done = career.rally >= 4;
  $('career-go').textContent = done ? 'Season finale ▶' : career.stage ? `Continue: ${plan[career.rally].name}, SS${career.stage + 1} ▶` : `Start ${plan[career.rally].name} ▶`;
  $('career-sub').textContent = `Season ${career.season} · ${TIERS[career.tier].label} · round ${Math.min(4, career.rally + 1)} of 4`;
}
function startCareerStage() {
  if (!career) career = newCareer();
  saveCareer(career);
  const r = seasonPlan(career.season)[career.rally];
  careerRun = { seed: r.seeds[career.stage], stage: career.stage, rally: career.rally, name: r.name, result: null };
  // Pick the car at the start of each rally; it's the same car for all three stages.
  if (career.stage === 0) pickThenStart('random', careerRun.seed);
  else { if (running) toMenu(); hidePages(); launchStage({ kind: 'random', seed: careerRun.seed }); }
}
function careerFinish() {
  const res = recordStage(career, { seed: stage.seed, dist: stage.finish - stage.start, fords: (road.fords || []).length }, run.t);
  career.car = carId;
  career.showLast = res.rallyDone;
  saveCareer(career);
  careerRun.result = res;
  if (res.award?.pos === 1) ach.earn('rally_win');
  const pen = res.t - run.t;
  careerRun.html = `SS${careerRun.stage + 1}: ${ordinal(res.stagePos)} of 8 · ${res.rallyDone ? 'Rally result' : 'Rally'}: ${ordinal(res.rallyPos)}` +
    `<small>${pen ? `Includes +${pen}s for restarts · ` : ''}${res.rallyPos === 1 ? `Leading by ${fmt(Math.abs(res.rallyGap))}` : `${fmt(res.rallyGap)} behind the leader`}${res.award ? ` · +${res.award.pts} championship points · +${res.award.prize} credits` : ''}</small>`;
}
// The career result on the finish screen (the first finish is the one that counts).
function showCareerFin() {
  const res = careerRun.result;
  $('fin-career').hidden = false;
  $('fin-career').innerHTML = careerRun.html;
  $('btn-next').hidden = false;
  $('btn-next').textContent = res.seasonDone ? 'Season finale ▶' : res.rallyDone ? 'Rally results ▶' : 'Next stage ▶';
  $('btn-retry').hidden = true;
}
function careerNext() {
  const res = careerRun.result;
  careerRun = null;
  if (res.seasonDone) { toMenu(); showPodium(); return; }
  if (res.rallyDone) { toMenu(); openPage('career'); renderCareer(); return; }
  startCareerStage();
}
function showPodium() {
  const fin = finishSeason(career);
  if (fin.pos === 1) ach.earn('champion');
  if (fin.next.tier >= 2) ach.earn('legend');
  const top = fin.table.slice(0, 3).map((x) => (x.you ? { car: career.car || carId, color: garage.color } : { car: x.car, color: x.color }));
  $('start').hidden = true;
  $('podium').hidden = false;
  podium.show(top); podium.start();
  $('podium-eyebrow').textContent = `Season ${career.season} · ${TIERS[career.tier].label} class`;
  $('podium-title').textContent = fin.pos === 1 ? 'CHAMPION!' : `${ordinal(fin.pos).toUpperCase()} OVERALL`;
  $('podium-list').innerHTML = fin.table.slice(0, 3).map((x) => `<li class="${x.you ? 'you' : ''}">${esc(x.name)} · ${x.pts} pts</li>`).join('') +
    (fin.pos > 3 ? `<li value="${fin.pos}" class="you">You · ${fin.table[fin.pos - 1].pts} pts</li>` : '');
  $('podium-note').textContent = fin.promoted ? `Promoted: ${TIERS[fin.next.tier].label} class next season, against quicker rivals.`
    : fin.pos === 1 ? 'Top class champion. Can you defend it?' : `Same class next season: win the title to move up.`;
  audio.init(); audio.fanfare(fin.pos <= 3);
  $('podium-go').onclick = () => {
    career = fin.next; saveCareer(career);
    podium.stop(); $('podium').hidden = true;
    openPage('career'); renderCareer();
  };
}
$('career-shop').addEventListener('click', (e) => {
  const b = e.target.closest('[data-buy]');
  if (!b || !career) return;
  if (buyUpgrade(career, b.dataset.buy)) { saveCareer(career); audio.beep(880, 0.1); renderCareer(); }
});
$('btn-career').addEventListener('click', () => { if (career) career.showLast = false; openPage('career'); renderCareer(); });
$('career-go').addEventListener('click', () => { if (career && career.rally >= 4) { hidePages(); showPodium(); } else startCareerStage(); });
// New career: press twice (browser pop-ups are blocked inside claude.ai, so
// the button itself asks "Sure?" for a few seconds).
let resetArmed = 0;
$('career-reset').addEventListener('click', (e) => {
  const b = e.currentTarget, started = career && (career.rally || career.stage || career.season > 1 || career.credits);
  if (started && Date.now() > resetArmed) {
    resetArmed = Date.now() + 4000;
    b.textContent = 'Sure? Tap again to wipe it';
    b.classList.add('btn-danger');
    setTimeout(() => { if (Date.now() > resetArmed) { b.textContent = 'New career'; b.classList.remove('btn-danger'); } }, 4100);
    return;
  }
  resetArmed = 0;
  b.textContent = 'New career'; b.classList.remove('btn-danger');
  resetCareer(); career = newCareer(); saveCareer(career); renderCareer();
  toast('NEW CAREER STARTED', 1200);
});
if (career) renderCareer();

// ---------- Menu pages ----------
const preview = new GaragePreview($('garage-view'));
function openPage(id) {
  $('start').hidden = true;
  $(id).hidden = false;
  $(id).querySelector('[data-back]')?.focus();
}
function hidePages() {
  clearPeek();
  if (!$('garage').hidden) markUnlocksSeen();     // NEW badges go once you've seen them
  for (const id of ['garage', 'past', 'champ', 'statsview', 'classics', 'randomgen', 'welcome', 'career', 'mp', 'event', 'editor', 'settings', 'ach']) $(id).hidden = true;
  preview.stop();
  settingsHome();
}
function closePages() {
  if (pendingStart && !$('garage').hidden) pendingStart = null;
  hidePages();
  $('start').hidden = false;
}
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', closePages));

// Unlockables you haven't looked at yet get a NEW badge, and the Garage
// button gets a dot while there's something new in it.
let seen;
try { seen = new Set(JSON.parse(localStorage.getItem('sideways.seen') || '[]')); } catch { seen = new Set(); }
function unlockedKeys(u = unlockState(stats.d)) {
  return [
    ...Object.keys(LOCKS.cars).filter((k) => !carLocked(k, u)).map((k) => 'car:' + k),
    ...Object.keys(LOCKS.wheels).filter((w) => !wheelLocked(w, u)).map((w) => 'wheels:' + w),
    ...Object.keys(LOCKS.skins).filter((k) => !skinLocked(...k.split(':'), u)).map((k) => 'skin:' + k),
    ...SPECIAL_PAINTS.filter((p) => p.need(u)).map((p) => 'paint:' + p.color),
  ];
}
const unlockName = (k) => {
  const [kind, id, sub] = k.split(':');
  if (kind === 'car') return CARS[id].name;
  if (kind === 'skin') return `${CARS[id].name} ${carSkins(CARS[id]).find((x) => x.id === sub)?.name || sub} style`;
  if (kind === 'wheels') return `${id[0].toUpperCase() + id.slice(1)} wheels`;
  return `${SPECIAL_PAINTS.find((p) => p.color === id)?.name || 'Special'} paint`;
};
function freshUnlocks() { return new Set(unlockedKeys().filter((k) => !seen.has(k))); }
function refreshGarageDot() { $('btn-garage').classList.toggle('has-new', freshUnlocks().size > 0); }
function markUnlocksSeen() {
  for (const k of unlockedKeys()) seen.add(k);
  try { localStorage.setItem('sideways.seen', JSON.stringify([...seen])); } catch { /* ignore */ }
  refreshGarageDot();
}
function renderGarage() {
  const u = unlockState(stats.d);
  const fresh = freshUnlocks();
  $('garage-cars').innerHTML = garageCarsHTML(garage.car, u, fresh);
  $('garage-stats').innerHTML = garageStatsHTML(garage.car);
  $('garage-paint').innerHTML = PAINTS.map((c) => `<button class="swatch${c === garage.color ? ' on' : ''}" style="background:${c}" data-paint="${c}" aria-label="Paint ${c}"></button>`).join('') +
    SPECIAL_PAINTS.map((p) => { const ok = p.need(u); return `<button class="swatch special${p.color === garage.color ? ' on' : ''}${ok ? '' : ' locked'}${ok && fresh.has('paint:' + p.color) ? ' is-new' : ''}" style="background:${p.color}" data-paint="${p.color}" ${ok ? '' : `data-why="${p.why}"`} title="${p.name}${ok ? '' : ': ' + p.why}" aria-label="${p.name} paint${ok ? '' : ' (locked)'}">${ok ? '' : '🔒'}</button>`; }).join('');
  $('garage-wheels').innerHTML = WHEELS.map((w) => { const lk = wheelLocked(w, u); return `<button class="chip${w === garage.wheels ? ' on' : ''}${lk ? ' locked' : ''}" data-wheels="${w}" ${lk ? `data-why="${LOCKS.wheels[w].why}"` : ''}>${lk ? '🔒 ' : ''}${w}${!lk && fresh.has('wheels:' + w) ? ' <i class="badge-new">NEW</i>' : ''}</button>`; }).join('');
  $('garage-color').value = garage.color;
  // Styles: each car's Works livery is free, the others unlock by playing.
  const skins = carSkins(CARS[garage.car]);
  $('garage-skin-row').hidden = !skins.length;
  const cur = garage.skins[garage.car] || skins[0]?.id;
  $('garage-skin').innerHTML = skins.map((k) => {
    const key = `${garage.car}:${k.id}`, lk = skinLocked(garage.car, k.id, u);
    return `<button class="chip${k.id === cur ? ' on' : ''}${lk ? ' locked' : ''}" data-skin="${k.id}" ${lk ? `data-why="${LOCKS.skins[key].why}"` : ''}>${lk ? '🔒 ' : ''}${k.name}${!lk && fresh.has('skin:' + key) ? ' <i class="badge-new">NEW</i>' : ''}</button>`;
  }).join('');
  // Livery editor, for the Custom style.
  $('garage-livery-row').hidden = cur !== 'custom';
  const LBL = { stripes: 'Twin stripes', wide: 'Wide stripe', side: 'Side stripe', racing: 'Stripes + side', twotone: 'Two-tone', roof: 'Roof', hoops: 'Hoops', arrows: 'Arrows', checks: 'Checks', none: 'None' };
  $('liv-pattern').innerHTML = PATTERNS.map((p) => `<button class="chip${p === garage.livery.pattern ? ' on' : ''}" data-liv="${p}">${LBL[p]}</button>`).join('');
  $('liv-c1').value = garage.livery.c1; $('liv-c2').value = garage.livery.c2; $('liv-num').value = carNumber();
}
// Rebuild the car (and the preview) with the current livery design.
function liveryChanged() {
  saveGarage();
  setCar(garage.car, true);
  preview.show(garage.car, garage);
}
$('liv-pattern').addEventListener('click', (e) => {
  const b = e.target.closest('[data-liv]');
  if (!b) return;
  e.stopPropagation();
  garage.livery.pattern = b.dataset.liv;
  liveryChanged(); renderGarage();
});
$('liv-c1').addEventListener('change', (e) => { garage.livery.c1 = e.target.value; liveryChanged(); });
$('liv-c2').addEventListener('change', (e) => { garage.livery.c2 = e.target.value; liveryChanged(); });
$('liv-num').addEventListener('change', (e) => { garage.livery.num = Math.max(0, Math.min(99, parseInt(e.target.value, 10) || 7)); liveryChanged(); });
// The garage doubles as the car picker: you always land here first, and
// every stage goes through it so you choose your car before you drive.
let pendingStart = null;
let starting = false;                      // a stage is being built: ignore other start requests
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
  if (careerRun && seed === careerRun.seed) return `${careerRun.name} · SS${careerRun.stage + 1}/3`;
  if (kind === 'random' && seed == null) return 'Random stage';
  if (kind === 'endurance' && seed == null) return 'Endurance stage';
  if (kind === 'endurance') return `${stageName(seed)} · Endurance`;
  if (specialOf(seed)) return `${stageName(seed)} · ${SPECIAL_LABEL[specialOf(seed)]}`;
  if (kind === 'daily' && seed == null) seed = dateSeed();
  const name = stageName(seed);
  if (kind === 'classic') return `${name} · Classic`;
  if (kind === 'champ') return `${name} · Championship ${champIndex(seed)}/5`;
  return name;
}
function pickThenStart(kind, seed) {
  if (starting) return;
  if (running) toMenu();
  hidePages();                 // e.g. the career page, which would sit on top of the garage
  pendingStart = { kind, seed };
  openGarage('pick', stageTitle(kind, seed));
}
$('btn-garage').addEventListener('click', () => openGarage('browse'));
$('garage-go').addEventListener('click', (e) => {
  e.currentTarget.blur();
  clearPeek();
  if ($('garage').hidden) return;          // a second click, tap or Enter after the stage already started
  const p = pendingStart;
  pendingStart = null;
  if (!p) { closePages(); return; }
  hidePages();                             // straight to the stage, no flash of the title menu
  launchStage(p);
});
// Building a stage takes a moment and blocks the page, so show the loading
// screen first and let it paint (two frames) before starting.
function launchStage(p) {
  const needLoad = p.seed == null || p.kind !== stage.kind || p.seed !== stage.seed;
  const go = () => {
    try { start(p.kind, p.seed); } catch (err) { showError('The stage could not start', err); toMenu(); }
    $('loading').hidden = true;
    starting = false;
  };
  if (!needLoad) { go(); return; }
  starting = true;
  $('loading-name').textContent = stageTitle(p.kind, p.seed);
  $('loading-tip').innerHTML = `<b>Tip:</b> ${TIPS[Math.floor(Math.random() * TIPS.length)]}`;
  $('loading').hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(go));
}

// Locked cars, paints, wheels and styles can be tried on in the preview:
// the preview shows them with a label saying how to unlock them, but your
// own setup doesn't change, so Continue drives what you've actually got.
let peek = null;
function showPeek(el, why) {
  document.querySelectorAll('#garage .peek').forEach((x) => x.classList.remove('peek'));
  el.classList.add('peek');
  peek = el;
  $('garage-peek-why').textContent = `Unlock: ${why}`;
  $('garage-peek').hidden = false;
}
function clearPeek() {
  if (!peek) return;
  peek.classList.remove('peek');
  peek = null;
  $('garage-peek').hidden = true;
  preview.show(garage.car, garage);
  $('garage-stats').innerHTML = garageStatsHTML(garage.car);
}
function peekLocked(el) {
  const u = unlockState(stats.d);
  if (el.dataset.car && carLocked(el.dataset.car, u)) {
    const id = el.dataset.car;
    preview.show(id, { color: garage.color, wheels: garage.wheels, skins: {} });
    $('garage-stats').innerHTML = garageStatsHTML(id);
    showPeek(el, LOCKS.cars[id].why);
    return true;
  }
  if (!el.dataset.why) return false;
  // Start from your own setup, then swap in the one locked thing.
  preview.show(garage.car, garage);
  $('garage-stats').innerHTML = garageStatsHTML(garage.car);
  if (el.dataset.paint) preview.setColor(el.dataset.paint);
  if (el.dataset.wheels) preview.setWheels(el.dataset.wheels);
  if (el.dataset.skin) {
    const k = carSkins(CARS[garage.car]).find((x) => x.id === el.dataset.skin);
    preview.show(garage.car, { color: k.paint || garage.color, wheels: garage.wheels, skins: { [garage.car]: k.id } });
  }
  showPeek(el, el.dataset.why);
  return true;
}
$('garage').addEventListener('click', (e) => {
  const item = e.target.closest('[data-car], [data-paint], [data-wheels], [data-skin]');
  if (item && peekLocked(item)) return;
  if (item) clearPeek();
  const sk = e.target.closest('[data-skin]');
  if (sk) {
    // A style comes with its own paint; the paint can still be changed after.
    const k = carSkins(CARS[garage.car]).find((x) => x.id === sk.dataset.skin);
    garage.skins[garage.car] = k.id;
    if (k.paint) garage.color = k.paint;
    setCar(garage.car, true);
    preview.show(garage.car, garage);
    saveGarage(); renderGarage();
    return;
  }
  const c = e.target.closest('[data-car]'), p = e.target.closest('[data-paint]'), w = e.target.closest('[data-wheels]');
  if (c) {
    // First time in a car: start it in its Works style and colours.
    const id = c.dataset.car;
    if (!garage.skins[id]) {
      const k = carSkins(CARS[id])[0];
      if (k) { garage.skins[id] = k.id; if (k.paint) garage.color = k.paint; }
    }
    setCar(id, true); preview.show(garage.car, garage);
  }
  if (p) { garage.color = p.dataset.paint; model.setColor(garage.color); preview.setColor(garage.color); }
  if (w) { garage.wheels = w.dataset.wheels; model.setWheelStyle(garage.wheels); preview.setWheels(garage.wheels); }
  if (c || p || w) { saveGarage(); renderGarage(); }
});
$('garage-color').addEventListener('input', (e) => {
  clearPeek();
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
  const wt = weekTheme(week.weekNo);
  $('champ-week').textContent = `Week of ${week.label}${wt ? ` · ${wt.label}` : ''}`;
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
  get obGrid() { return obGrid; }, flying, auto: null, forceWeather: null, get weather() { return weather; }, get skyPlan() { return skyPlan; }, updateSky, get trackside() { return trackside; }, get harbour() { return harbour; }, hitBarriers, flyover, net, mp, mpActive, mpCreate, mpJoin, mpStartRace, mpToLobby, remote, inTunnelAt, get career() { return career; }, set career(c) { career = c; }, get careerRun() { return careerRun; }, startCareerStage, careerNext, showPodium, renderCareer, finishRun, echo, measureEcho, replay, startReplay, stopReplay, replayCam, toggleClip, clip, get surfPlan() { return surfPlan; }, drone, rig, HAZARD_DEBUG, get model() { return model; }, get hazards() { return hazards; }, worldGround,
  get shortcuts() { return shortcuts; }, get onShortcut() { return onShortcut; },
  get obstacleCount() { let n = 0; obGrid.forEach((l) => (n += l.length)); return n; }, collide,
  codriver, crash, get riderFall() { return riderFall; },
  get ghostModel() { return ghostModel; }, board, raceGhostOf, FEEL, handbrakeAssist, get sharpCorners() { return sharpCorners; }, recorder, loadGhost, onLanding, renderer, scene, camera, marks, assist, setAssist, car, input, TUNE, CARS, start, stepSim, placeOnRoad, loadStage, run, stage,
  get road() { return road; }, get terrain() { return terrain; }, get lineMesh() { return lineMesh; }, get surface() { return surface; }, get best() { return best; },
};
// After everything above is set up: mark the Garage button if there's something new.
refreshGarageDot();
// First visit: a simple welcome instead of the full menu.
{
  let welcomed = false;
  try { welcomed = localStorage.getItem('sideways.welcomed') === '1'; } catch { /* ignore */ }
  const markWelcomed = () => { try { localStorage.setItem('sideways.welcomed', '1'); } catch { /* ignore */ } };
  if (!welcomed && !(stats.d.runs > 0)) openPage('welcome');
  $('wel-school').addEventListener('click', () => { markWelcomed(); $('welcome').hidden = true; $('btn-school').click(); });
  $('wel-daily').addEventListener('click', () => { markWelcomed(); $('welcome').hidden = true; $('btn-daily').click(); });
  $('wel-skip').addEventListener('click', markWelcomed);
}
