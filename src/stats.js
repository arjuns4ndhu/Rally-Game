// Lifetime stats, kept in localStorage: runs, finishes, distance, drift
// distance, airtime, crashes, days played and distance per car.
const KEY = 'sideways.stats';

const blank = () => ({ v: 1, runs: 0, finishes: 0, dist: 0, drift: 0, air: 0, crashes: 0, bests: 0, days: [], cars: {} });

export class Stats {
  constructor() {
    this.d = blank();
    try { Object.assign(this.d, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore */ }
    this.dirty = 0;
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch { /* ignore */ }
    this.dirty = 0;
  }

  // Called every physics step while driving.
  drive(dt, car, carId) {
    const d = this.d;
    const m = car.speed * dt;
    d.dist += m;
    d.cars[carId] = (d.cars[carId] || 0) + m;
    if (car.drifting && Math.abs(car.driftAngle) > 0.2 && car.speed > 6) d.drift += m;
    if (car.air) d.air += dt;
    this.dirty += dt;
    if (this.dirty > 5) this.save();
  }

  run() { this.d.runs++; this.save(); }
  crash() { this.d.crashes++; }
  finish(isBest) { this.d.finishes++; if (isBest) this.d.bests++; this.save(); }
  day(seed) { if (!this.d.days.includes(seed)) { this.d.days.push(seed); this.save(); } }
}
