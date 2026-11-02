// Achievements: goals to chase across the whole game. Some are counted from
// lifetime stats (with a progress bar), the rest are moments the game marks
// as they happen (a clean run, a big jump, a won rally). Earned ones are
// kept in localStorage with the date.
const KEY = 'sideways.ach';

// need(ctx) -> [have, want] for counted ones; flag ones are earned by name.
export const ACHIEVEMENTS = [
  { id: 'first_finish', name: 'Off the line', desc: 'Finish your first stage', need: (c) => [c.s.finishes, 1] },
  { id: 'finish_25', name: 'Regular', desc: 'Finish 25 stages', need: (c) => [c.s.finishes, 25] },
  { id: 'finish_100', name: 'Lifer', desc: 'Finish 100 stages', need: (c) => [c.s.finishes, 100] },
  { id: 'days_7', name: 'Daily driver', desc: "Play 7 days' stages", need: (c) => [c.s.days.length, 7] },
  { id: 'bests_10', name: 'Getting quicker', desc: 'Set 10 personal bests', need: (c) => [c.s.bests, 10] },
  { id: 'dist_100', name: 'Long way round', desc: 'Drive 100 km', need: (c) => [Math.floor(c.s.dist / 1000), 100] },
  { id: 'drift_10', name: 'Sideways', desc: 'Drift 10 km in total', need: (c) => [Math.floor(c.s.drift / 1000), 10] },
  { id: 'air_60', name: 'Frequent flyer', desc: 'A minute in the air, all told', need: (c) => [Math.floor(c.s.air), 60] },
  { id: 'crash_50', name: 'Built for comedy', desc: 'Crash 50 times', need: (c) => [c.s.crashes, 50] },
  { id: 'gold_1', name: 'Gold standard', desc: 'Gold on a Classic stage', need: (c) => [c.u.gold, 1] },
  { id: 'gold_5', name: 'Classic hero', desc: 'Gold on all five Classics', need: (c) => [c.u.gold, 5] },
  { id: 'brute', name: 'Group B', desc: 'Unlock the Brutale S4', need: (c) => [c.u.gold, 3] },
  { id: 'clean', name: 'Clean sheet', desc: 'Finish a stage with no respawns' },
  { id: 'gold_any', name: 'Golden touch', desc: 'Gold on any stage that isn’t a Classic' },
  { id: 'big_air', name: 'Big air', desc: 'Stay in the air for 1.5 seconds on one jump' },
  { id: 'street', name: 'Harbour hero', desc: 'Finish a street circuit' },
  { id: 'cliff', name: 'Edge of the world', desc: 'Finish a mountain-edge stage' },
  { id: 'country', name: 'Sunday drive', desc: 'Finish a countryside stage' },
  { id: 'world_tour', name: 'World tour', desc: 'Finish every special stage type', need: (c) => [c.types, 6] },
  { id: 'endurance', name: 'Stamina', desc: 'Finish an endurance stage' },
  { id: 'rally_win', name: 'Rally winner', desc: 'Win a career rally' },
  { id: 'champion', name: 'Champion', desc: 'Win a career season' },
  { id: 'legend', name: 'Legend', desc: 'Reach Legend class in career' },
  { id: 'mp_race', name: 'Wheel to wheel', desc: 'Finish an online race' },
  { id: 'mp_win', name: 'Bragging rights', desc: 'Win an online race' },
  { id: 'builder', name: 'Course designer', desc: 'Drive a stage you built in the editor' },
  { id: 'event', name: 'Event entrant', desc: 'Finish the weekly event' },
  { id: 'designer', name: 'Paint shop', desc: 'Finish a stage in your own livery' },
];

export class Achievements {
  constructor(onEarn) {
    this.onEarn = onEarn;
    this.got = {};
    this.types = [];       // special stage types finished (for World tour)
    try { const d = JSON.parse(localStorage.getItem(KEY) || '{}'); this.got = d.got || {}; this.types = d.types || []; } catch { /* ignore */ }
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify({ got: this.got, types: this.types })); } catch { /* ignore */ } }

  // Mark a moment-type achievement (no-op if already earned).
  earn(id) {
    if (this.got[id] || !ACHIEVEMENTS.some((a) => a.id === id)) return;
    this.got[id] = Date.now();
    this.save();
    this.onEarn?.(ACHIEVEMENTS.find((a) => a.id === id));
  }

  finishedType(type) {
    if (type && !this.types.includes(type)) { this.types.push(type); this.save(); }
  }

  // Re-check the counted ones against current stats ({ s: stats, u: unlock state }).
  check(ctx) {
    const c = { ...ctx, types: this.types.length };
    for (const a of ACHIEVEMENTS) if (a.need && !this.got[a.id]) { const [have, want] = a.need(c); if (have >= want) this.earn(a.id); }
  }

  // For the page: every achievement with whether it's earned and progress.
  list(ctx) {
    const c = { ...ctx, types: this.types.length };
    return ACHIEVEMENTS.map((a) => {
      const p = a.need ? a.need(c) : null;
      return { ...a, at: this.got[a.id] || null, have: p ? Math.min(p[0], p[1]) : null, want: p ? p[1] : null };
    });
  }
}
