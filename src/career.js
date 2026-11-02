// Career: seasons of four rallies, three stages each, against seven rival
// drivers. A rival's stage time comes from the stage itself (its length,
// scenery and weather) and that driver's pace, so it's the same every time
// for that stage. Each rally's finishing order scores championship points;
// the season champion moves up a class (Rookie, Pro, Legend), where the
// rivals are quicker.
import { mulberry32 } from './rng.js';
import { pickTheme } from './themes.js';
import { pickWeather } from './weather.js';

export const TIERS = [
  { id: 'rookie', label: 'Rookie', pace: 61 },     // km/h a middling rival averages
  { id: 'pro', label: 'Pro', pace: 68 },
  { id: 'legend', label: 'Legend', pace: 75 },
];
// skill: pace multiplier; spread: how much they vary stage to stage;
// risk: chance of a costly mistake on a stage.
export const RIVALS = [
  { id: 'lind', name: 'K. Lindqvist', car: 'quadra', color: '#2a6fd8', skill: 1.06, spread: 0.018, risk: 0.04 },
  { id: 'moreau', name: 'J. Moreau', car: 'vector', color: '#f1ede2', skill: 1.04, spread: 0.022, risk: 0.06 },
  { id: 'aalto', name: 'M. Aalto', car: 'stiletto', color: '#1f9e5a', skill: 1.02, spread: 0.03, risk: 0.1 },
  { id: 'castel', name: 'R. Castellan', car: 'brute', color: '#c4162a', skill: 1.0, spread: 0.035, risk: 0.14 },
  { id: 'okafor', name: 'T. Okafor', car: 'raider', color: '#f2c230', skill: 0.98, spread: 0.025, risk: 0.06 },
  { id: 'brandt', name: 'S. Brandt', car: 'quadra', color: '#16181d', skill: 0.96, spread: 0.03, risk: 0.08 },
  { id: 'vance', name: 'E. Vance', car: 'pocket', color: '#ff8a1c', skill: 0.93, spread: 0.04, risk: 0.1 },
];
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4];
const RALLY_NAMES = ['Rally Nordvik', 'Rally Sierra Alta', 'Rally Isola Verde', 'Lakeland Rally', 'Rally Dunmore', 'Rally Altavista',
  'Highland Stages', 'Rally Costa Brava Nova', 'Rally Kaskadi', 'Rally Ardenwald', 'Rally Pampas Sur', 'Glenmoor Rally'];
// Each season: two gravel rallies, one on tarmac, one with a twist.
const RALLY_TYPES = [['gravel', 'tarmac', 'gravel', 'night'], ['gravel', 'river', 'tarmac', 'street'], ['night', 'street', 'tarmac', 'river']];
const TYPE_LABEL = { gravel: 'Gravel', tarmac: 'Tarmac', night: 'Night forest', river: 'River crossings', street: 'Street circuit' };
const TYPE_BASE = { gravel: [100000, 900000], tarmac: [4e6, 3e5], night: [4.3e6, 3e5], river: [4.6e6, 3e5], street: [4.9e6, 3e5] };

export function newCareer() {
  return { v: 1, season: 1, tier: 0, rally: 0, stage: 0, points: {}, rallyTimes: [], rallyStages: [], restarts: 0, results: [], car: null };
}
export function loadCareer() {
  try {
    const c = JSON.parse(localStorage.getItem('sideways.career') || 'null');
    if (c && c.v === 1 && Number.isInteger(c.season) && c.rally >= 0 && c.rally <= 4) return c;
  } catch { /* ignore */ }
  return null;
}
export function saveCareer(c) { try { localStorage.setItem('sideways.career', JSON.stringify(c)); } catch { /* ignore */ } }
export function resetCareer() { try { localStorage.removeItem('sideways.career'); } catch { /* ignore */ } }

// The season's calendar: four rallies, each with a name, type and stage codes.
export function seasonPlan(season) {
  const r = mulberry32((season * 7477 + 12345) >>> 0);
  const types = RALLY_TYPES[(season - 1) % RALLY_TYPES.length];
  const names = RALLY_NAMES.slice();
  return types.map((type, k) => {
    const name = names.splice(Math.floor(r() * names.length), 1)[0];
    const [base, span] = TYPE_BASE[type];
    const seeds = [0, 1, 2].map(() => base + Math.floor(r() * span));
    return { name, type, label: TYPE_LABEL[type], seeds, round: k + 1 };
  });
}

const THEME_K = { forest: 1, desert: 1, alpine: 0.97, autumn: 0.95, snow: 0.9, tarmac: 1.1, nightwood: 0.93 };
const WEATHER_K = { rain: 0.93, snowfall: 0.95, night: 0.94, fog: 0.95, dusk: 0.99 };
// A rival's time on a stage ({ seed, dist }), in seconds.
export function rivalTime(rival, tier, st) {
  const { theme } = pickTheme(st.seed);
  const w = pickWeather(st.seed, theme).id;
  const k = (THEME_K[theme.id] ?? 1) * (WEATHER_K[w] ?? 1) * (st.fords ? 0.97 : 1);
  const base = st.dist / (TIERS[tier].pace / 3.6 * k);
  const r = mulberry32(((st.seed * 2654435761) ^ (rival.id.charCodeAt(0) * 40503 + rival.id.length * 977)) >>> 0);
  const g = (r() + r() + r() - 1.5) * 2;                       // roughly normal, -3..3
  let t = base / rival.skill * (1 + g * rival.spread);
  if (r() < rival.risk) t += 6 + r() * 16;                     // an off, a spin, a puncture
  return t;
}

// Classification of a stage or a whole rally: [{ id, name, t, you }] fastest first.
export function classify(career, stages, playerTimes) {
  const rows = RIVALS.map((rv) => ({ id: rv.id, name: rv.name, car: rv.car, color: rv.color, t: stages.reduce((s, st) => s + rivalTime(rv, career.tier, st), 0) }));
  rows.push({ id: 'you', name: 'You', you: true, t: playerTimes.reduce((s, t) => s + t, 0) });
  return rows.sort((a, b) => a.t - b.t);
}

// Championship table: [{ id, name, pts, you }] most points first.
export function standings(career) {
  const rows = RIVALS.map((rv) => ({ id: rv.id, name: rv.name, car: rv.car, color: rv.color, pts: career.points[rv.id] || 0 }));
  rows.push({ id: 'you', name: 'You', you: true, pts: career.points.you || 0 });
  return rows.sort((a, b) => b.pts - a.pts || (a.you ? -1 : b.you ? 1 : 0));
}

// Record a finished stage. Returns { stagePos, rallyPos, rallyGap, rallyDone }.
export const RESTART_PENALTY = 10;
export function recordStage(career, st, time) {
  const t = time + career.restarts * RESTART_PENALTY;
  career.rallyTimes.push(t);
  career.rallyStages.push(st);
  career.restarts = 0;
  const stageCls = classify(career, [st], [t]);
  const rallyCls = classify(career, career.rallyStages, career.rallyTimes);
  const stagePos = stageCls.findIndex((x) => x.you) + 1;
  const rallyPos = rallyCls.findIndex((x) => x.you) + 1;
  const rallyGap = rallyPos === 1 ? rallyCls[0].t - rallyCls[1].t : rallyCls[rallyPos - 1].t - rallyCls[0].t;
  career.stage++;
  const rallyDone = career.stage >= 3;
  let award = null;
  if (rallyDone) {
    rallyCls.forEach((x, i) => { career.points[x.id] = (career.points[x.id] || 0) + (POINTS[i] || 0); });
    award = { cls: rallyCls, pos: rallyPos, pts: POINTS[rallyPos - 1] || 0 };
    career.results.push({ rally: career.rally, pos: rallyPos });
    career.lastRally = { cls: rallyCls.map(({ id, name, t, you }) => ({ id, name, t, you })), rally: career.rally };
    career.rally++; career.stage = 0; career.rallyTimes = []; career.rallyStages = [];
  }
  return { t, stagePos, rallyPos, rallyGap, rallyDone, award, seasonDone: career.rally >= 4 };
}

// After the last rally: who won, and the next season (up a class for the
// champion, the same class otherwise).
export function finishSeason(career) {
  const table = standings(career);
  const pos = table.findIndex((x) => x.you) + 1;
  const promoted = pos === 1 && career.tier < TIERS.length - 1;
  const next = { ...newCareer(), season: career.season + 1, tier: career.tier + (promoted ? 1 : 0), car: career.car, titles: (career.titles || 0) + (pos === 1 ? 1 : 0) };
  return { table, pos, promoted, next };
}

export const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
