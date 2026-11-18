// Title-screen pages: garage (3D preview, paint, wheels), past-stages
// calendar, weekly championship and lifetime stats. Pure UI; main.js wires
// the buttons to the game.
import * as THREE from 'three';
import { buildCarModel } from './carModel.js';
import { CARS, CAR_ORDER } from './car.js';
import { stageName } from './stagegen.js';
import { pickTheme } from './themes.js';
import { dateSeed } from './rng.js';

export const PAINTS = ['#e8542a', '#f2c230', '#2a7de8', '#1f9e5a', '#f1ede2', '#16181d', '#c4162a', '#7a3fd1', '#3fc6d1', '#d1813f'];
export const WHEELS = ['spoke', 'dish', 'mesh', 'tarmac', 'gold'];

// ---------- Unlocks ----------
// Medals on the Classic stages (and finishes) unlock special paints, gold
// wheels and a sixth car.
export const SPECIAL_PAINTS = [
  { color: '#d4af37', name: 'Gold', need: (u) => u.gold >= 1, why: 'Gold medal on any Classic' },
  { color: '#39ff14', name: 'Neon', need: (u) => u.medals >= 3, why: 'Any 3 Classic medals' },
  { color: '#0f1a3c', name: 'Midnight', need: (u) => u.finishes >= 10, why: 'Finish 10 stages' },
  { color: '#ff2fa0', name: 'Hot pink', need: (u) => u.silverPlus >= 5, why: 'Silver or better on all 5 Classics' },
];
export const LOCKS = {
  wheels: { gold: { need: (u) => u.gold >= 2, why: 'Gold on 2 Classics' } },
  cars: { brute: { need: (u) => u.gold >= 3, why: 'Gold on 3 Classics' } },
  // Car styles ("car:style"). Each car's Works style is always free.
  skins: {
    'stiletto:sunset': { need: (u) => u.finishes >= 5, why: 'Finish 5 stages' },
    'stiletto:gold': { need: (u) => u.driftKm >= 5, why: 'Drift 5 km in total' },
    'pocket:armchair': { need: (u) => u.crashes >= 20, why: 'Crash 20 times' },
    'pocket:checkers': { need: (u) => u.dailies >= 3, why: 'Play 3 daily stages' },
    'quadra:arctic': { need: (u) => u.medals >= 2, why: 'Any 2 Classic medals' },
    'quadra:redline': { need: (u) => u.air >= 30, why: '30 s of air time in total' },
    'vector:lime': { need: (u) => u.finishes >= 15, why: 'Finish 15 stages' },
    'vector:heritage': { need: (u) => u.bests >= 5, why: 'Set 5 personal bests' },
    'raider:dune': { need: (u) => u.air >= 10, why: '10 s of air time in total' },
    'raider:expedition': { need: (u) => u.distKm >= 50, why: 'Drive 50 km in total' },
    'brute:rosso': { need: (u) => u.gold >= 4, why: 'Gold on 4 Classics' },
    'brute:oro': { need: (u) => u.driftKm >= 20, why: 'Drift 20 km in total' },
  },
};
// Unlock progress from medals and lifetime stats (a stats object, or just
// the finish count).
export function unlockState(d = 0) {
  if (typeof d !== 'object' || !d) d = { finishes: d || 0 };
  const u = {
    gold: 0, silverPlus: 0, medals: 0, finishes: d.finishes || 0, bests: d.bests || 0, crashes: d.crashes || 0,
    air: d.air || 0, driftKm: (d.drift || 0) / 1000, distKm: (d.dist || 0) / 1000, dailies: (d.days || []).length,
  };
  for (const c of CLASSICS) {
    const m = medalFor(c, bestFor(c.seed)?.time);
    if (m) u.medals++;
    if (m === 'gold') u.gold++;
    if (m === 'gold' || m === 'silver') u.silverPlus++;
  }
  return u;
}
export const carLocked = (id, u) => !!(LOCKS.cars[id] && !LOCKS.cars[id].need(u));
export const wheelLocked = (w, u) => !!(LOCKS.wheels[w] && !LOCKS.wheels[w].need(u));
export const skinLocked = (car, skin, u) => { const l = LOCKS.skins[`${car}:${skin}`]; return !!(l && !l.need(u)); };
export const LAUNCH = 20260901;           // first daily in the calendar

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
export function bestFor(seed) {
  try { return JSON.parse(localStorage.getItem(`sideways.best.${seed}`) || 'null'); } catch { return null; }
}
const seedOf = (d) => dateSeed(d);
const dateOf = (seed) => new Date(Math.floor(seed / 10000), Math.floor(seed / 100) % 100 - 1, seed % 100);

// ---------- Garage ----------
export class GaragePreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.model = null;
    this.running = false;
    this.angle = 0.6;
  }

  _init() {
    if (this.renderer) return;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    this.scene.add(new THREE.HemisphereLight(0xfff1dc, 0x3a3326, 1.6));
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.2);
    sun.position.set(-4, 7, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.8);
    rim.position.set(4, 3, -5);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48), new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.0, 4.2, 64), new THREE.MeshBasicMaterial({ color: 0xffb000 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005;
    this.scene.add(ring);
  }

  show(id, { color, wheels, skins, livery }) {
    this._init();
    if (this.model) { this.scene.remove(this.model.root); this.model.dispose(); }
    const spec = CARS[id];
    this.model = buildCarModel(spec, { color, wheelStyle: wheels, number: Math.max(0, Math.min(99, parseInt(livery?.num, 10) || 0)) || 7, skin: skins?.[id] });
    this.model.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(this.model.root);
    // Frame taller cars a little further out.
    const h = this.model.roofH || 1.2;
    this.dist = 6.2 + (h - 1.1) * 2;
    this.lookY = 0.55 + (h - 1.1) * 0.4;
  }

  setColor(c) { this.model?.setColor(c); }
  setWheels(w) { this.model?.setWheelStyle(w); }

  start() {
    this._init();
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (w && h && (this.canvas.width !== Math.round(w * this._dpr()) || this.canvas.height !== Math.round(h * this._dpr()))) {
        this.renderer.setPixelRatio(this._dpr());
        this.renderer.setSize(w, h, false);
        this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
      }
      this.angle += dt * 0.35;
      const d = this.dist || 6.2;
      this.cam.position.set(Math.sin(this.angle) * d, 2.2, Math.cos(this.angle) * d);
      this.cam.lookAt(0, this.lookY || 0.55, 0);
      // Spin the wheels slowly so the rims read.
      for (const wl of this.model?.wheels || []) wl.spin.rotation.x += dt * 1.5;
      this.renderer.render(this.scene, this.cam);
    };
    requestAnimationFrame(loop);
  }

  _dpr() { return Math.min(2, window.devicePixelRatio || 1); }
  stop() { this.running = false; }
}

// Stat bars, scaled across the line-up.
function carStats(spec) {
  return {
    Power: spec.torque * spec.gears[0] * spec.finalDrive / spec.mass,
    Grip: (spec.muF + spec.muR) / 2,
    Agility: spec.steerSpeed * spec.maxSteer / spec.inertia,
    'Rough road': 1 + (spec.offroad || 0) * 2,
  };
}
export function garageStatsHTML(id) {
  const all = CAR_ORDER.map((k) => carStats(CARS[k]));
  const mine = carStats(CARS[id]);
  return Object.keys(mine).map((k) => {
    const vals = all.map((s) => s[k]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const f = hi > lo ? 0.25 + 0.75 * (mine[k] - lo) / (hi - lo) : 0.6;
    return `<div class="bar"><span>${k}</span><i style="--f:${f.toFixed(2)}"></i></div>`;
  }).join('') + `<div class="bar"><span>Drive</span><b>${CARS[id].drive}</b></div>`;
}
export function garageCarsHTML(selected, u, fresh = new Set()) {
  return CAR_ORDER.map((k, i) => {
    const locked = carLocked(k, u);
    const isNew = !locked && fresh.has('car:' + k);
    return `<button class="car-pick${k === selected ? ' on' : ''}${locked ? ' locked' : ''}" data-car="${k}" ${locked ? `title="${esc(LOCKS.cars[k].why)}" aria-disabled="true"` : ''}>
    <b>${locked ? '🔒' : i + 1}</b><span>${esc(CARS[k].name)}${isNew ? '<i class="badge-new">NEW</i>' : ''}<small>${esc(locked ? 'Locked: ' + LOCKS.cars[k].why : CARS[k].tag || '')}</small></span></button>`;
  }).join('');
}

// ---------- Past stages calendar ----------
export function calendarHTML(year, month) {
  const today = dateSeed();
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;                 // Monday first
  const cells = [];
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) cells.push(`<div class="cal-dow">${d}</div>`);
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-empty"></div>');
  for (let d = 1; d <= days; d++) {
    const seed = seedOf(new Date(year, month, d));
    const playable = seed >= LAUNCH && seed <= today;
    const b = playable ? bestFor(seed) : null;
    const cls = ['cal-day', seed === today ? 'today' : '', b ? 'done' : '', playable ? '' : 'off'].join(' ').trim();
    cells.push(playable
      ? `<button class="${cls}" data-seed="${seed}" title="${esc(stageName(seed))}"><b>${d}</b><small>${b ? fmtTime(b.time) : esc(pickTheme(seed).theme.label)}</small></button>`
      : `<div class="${cls}"><b>${d}</b></div>`);
  }
  return cells.join('');
}
export function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
export function canGoMonth(year, month, dir) {
  const t = dateOf(dateSeed()), l = dateOf(LAUNCH);
  const m = year * 12 + month + dir;
  return m >= l.getFullYear() * 12 + l.getMonth() && m <= t.getFullYear() * 12 + t.getMonth();
}

// ---------- Weekly championship ----------
// Five stages a week, Monday to Sunday, one in each scenery theme; your
// total is your best on each added up. Seeds stay small (1,000,000 + week
// number x 50 + stage x 10 + tweak) so the stage generator mixes them well.
const EPOCH = new Date(2024, 0, 1);       // a Monday
const DAY = 86400000;
export const champIndex = (seed) => Math.floor(((seed - 1e6) % 50) / 10);   // 1..5
function weekSeeds(weekNo) {
  const used = new Set();
  return [1, 2, 3, 4, 5].map((k) => {
    const base = 1e6 + weekNo * 50 + k * 10;
    for (let j = 0; j < 10; j++) {
      const id = pickTheme(base + j).theme.id;
      if (!used.has(id)) { used.add(id); return base + j; }
    }
    return base;
  });
}
export function weekInfo(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const weekNo = Math.round((d - EPOCH) / (7 * DAY));
  return { weekNo, seeds: weekSeeds(weekNo), label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) };
}
// Themed weeks: every week in four has its own weather for all five stages.
const WEEK_THEMES = [null, { id: 'night', label: 'Night week' }, { id: 'rain', label: 'Rain week' }, { id: 'fog', label: 'Fog week' }];
export const weekTheme = (weekNo) => WEEK_THEMES[((weekNo % 4) + 4) % 4];
// The week a championship stage belongs to (for "Next stage").
export function champWeekOf(seed) {
  const weekNo = Math.floor((seed - 1e6) / 50);
  return { weekNo, seeds: weekSeeds(weekNo) };
}
export function champHTML(week) {
  let total = 0, done = 0;
  const rows = week.seeds.map((seed, k) => {
    const b = bestFor(seed);
    if (b) { total += b.time; done++; }
    const th = pickTheme(seed).theme.label;
    return `<tr><td>${k + 1}</td><td>${esc(stageName(seed))}<small>${esc(th)}</small></td><td>${b ? fmtTime(b.time) : '--:--.--'}</td>
      <td><button class="btn btn-sm${b ? '' : ' btn-primary'}" data-champ="${k}">${b ? 'Improve' : 'Drive'}</button></td></tr>`;
  }).join('');
  const sum = done === 5 ? fmtTime(total) : `${done}/5 stages`;
  return { html: `<tr><th>#</th><th>Stage</th><th>Best</th><th></th></tr>${rows}`, total: sum, complete: done === 5 };
}

// ---------- Stats ----------
export function statsHTML(d) {
  const fav = Object.entries(d.cars || {}).sort((a, b) => b[1] - a[1])[0];
  const tiles = [
    ['Runs started', d.runs],
    ['Stages finished', d.finishes],
    ['Personal bests', d.bests],
    ['Distance', `${(d.dist / 1000).toFixed(1)} km`],
    ['Drifting', `${(d.drift / 1000).toFixed(1)} km`],
    ['Air time', `${d.air.toFixed(1)} s`],
    ['Crashes', d.crashes],
    ['Dailies played', (d.days || []).length],
    ['Favourite car', fav ? CARS[fav[0]]?.name || fav[0] : '—'],
  ];
  return tiles.map(([k, v]) => `<div class="stat"><small>${k}</small><b>${esc(v)}</b></div>`).join('');
}

// ---------- Classic stages ----------
// Five fixed stages, one per scenery theme, identical for everyone and
// never rotating, so times can be compared with friends. Hazard-free.
// Medal targets come from average speed over the stage (slower on snow
// and in the rain).
export const CLASSICS = [
  { seed: 900031, theme: 'Forest', d: 2572, k: 1 },
  { seed: 900122, theme: 'Canyon', d: 2190, k: 1 },
  { seed: 900228, theme: 'Snow', d: 2928, k: 0.9 },
  { seed: 900016, theme: 'Alpine', d: 2524, k: 1 },
  { seed: 900151, theme: 'Autumn', d: 2124, k: 0.93 },
];
export const MEDAL_ICON = { gold: '🥇', silver: '🥈', bronze: '🥉' };
export const classicOf = (seed) => CLASSICS.find((c) => c.seed === seed) || null;
export function medalTimes(c, d = c.d) {
  const [g, s, b] = [78, 66, 54].map((kmh) => d / (kmh / 3.6 * c.k));
  return { gold: g, silver: s, bronze: b };
}
export function medalFor(c, t, d) {
  if (t == null) return null;
  const m = medalTimes(c, d);
  return t <= m.gold ? 'gold' : t <= m.silver ? 'silver' : t <= m.bronze ? 'bronze' : null;
}
export function classicsHTML(weatherOf) {
  const rows = CLASSICS.map((c, i) => {
    const b = bestFor(c.seed), m = medalTimes(c), medal = medalFor(c, b?.time);
    return `<tr><td>${esc(stageName(c.seed))}<small>${c.theme} · ${esc(weatherOf(c.seed))} · ${(c.d / 1000).toFixed(1)} km</small></td>
      <td class="medals"><span>🥇 ${fmtTime(m.gold)}</span><span>🥈 ${fmtTime(m.silver)}</span><span>🥉 ${fmtTime(m.bronze)}</span></td>
      <td>${b ? `${medal ? MEDAL_ICON[medal] + ' ' : ''}${fmtTime(b.time)}` : '--:--.--'}</td>
      <td><button class="btn btn-sm${b ? '' : ' btn-primary'}" data-classic="${i}">${b ? 'Improve' : 'Drive'}</button></td></tr>`;
  }).join('');
  return `<tr><th>Stage</th><th>Targets</th><th>Your best</th><th></th></tr>${rows}`;
}
