// Driving school: short guided steps on the practice loop. Each step watches
// the car and the controls and ticks itself off when the move is done.

const DEG = Math.PI / 180;

const LESSONS = [
  {
    text: (k) => `Hold ${k('throttle')} to accelerate. Get up to 50 km/h.`,
    check: (c) => Math.min(1, c.car.speed * 3.6 / 50),
  },
  {
    text: (k) => `Brake hard with ${k('brake')} until you're below 15 km/h.`,
    check: (c, s) => {
      if (c.inp.brake > 0.5) s.braked = true;
      return s.braked && c.car.speed * 3.6 < 15 ? 1 : 0;
    },
  },
  {
    text: (k) => `Steer with ${k('left')} and ${k('right')}: weave left and right.`,
    check: (c, s, dt) => {
      if (c.car.speed > 4 && Math.abs(c.inp.steer) > 0.5) {
        s.t = (s.t || 0) + dt;
        s[c.inp.steer > 0 ? 'l' : 'r'] = true;
      }
      return Math.min(s.l && s.r ? 1 : 0.9, (s.t || 0) / 2.5);
    },
  },
  {
    text: (k) => `Get some speed, then hold ${k('handbrake')} while steering to swing the tail out.`,
    check: (c) => (c.inp.handbrake && Math.abs(c.car.driftAngle) > 20 * DEG ? 1 : 0),
  },
  {
    text: (k) => `No handbrake this time: turn in and tap ${k('brake')} to kick the rear out.`,
    check: (c, s, dt) => {
      s.since = c.inp.brake > 0.3 ? 0 : (s.since ?? 9) + dt;
      return !c.inp.handbrake && s.since < 1.2 && Math.abs(c.car.driftAngle) > 17 * DEG ? 1 : 0;
    },
  },
  {
    text: (k) => `Hold a drift for 1 second: stay on ${k('throttle')} and counter-steer to balance it.`,
    check: (c, s, dt) => {
      const a = Math.abs(c.car.driftAngle);
      if (a > 14 * DEG && c.inp.throttle > 0.3) s.t = (s.t || 0) + dt;
      else if (a < 7 * DEG) s.t = 0;
      return Math.min(1, s.t || 0);       // one second of drift
    },
  },
  {
    text: () => 'Find the JUMP sign on the loop and fly over it.',
    check: (c) => (c.car.air && c.car.airTime > 0.35 ? 1 : 0),
  },
  {
    text: () => 'Press C (or the camera button) to try the other cameras.',
    check: (c, s) => (s.noted ? 1 : 0), note: 'camera',
  },
  {
    text: () => 'Off the road or stuck? Press T to get back on track. Try it now.',
    check: (c, s) => (s.noted ? 1 : 0), note: 'reset',
  },
];

export class DrivingSchool {
  constructor(els, keyName) {
    this.els = els;               // { root, step, text, bar }
    this.keyName = keyName;       // action -> "<b>W</b>"-style label
    this.active = false;
  }

  start() {
    this.active = true;
    this.i = 0;
    this.s = {};
    this.hold = 0;
    this.done = false;
    this.els.root.hidden = false;
    this.render(0);
  }

  stop() {
    this.active = false;
    this.els.root.hidden = true;
  }

  // Things the step can't see from the car: camera changes, resets.
  note(what) {
    if (this.active && !this.done && LESSONS[this.i].note === what) this.s.noted = true;
  }

  render(p) {
    const { step, text, bar, root } = this.els;
    if (this.done) {
      step.textContent = 'Complete';
      text.textContent = "That's the lot. Now go and set a time on today's stage!";
      bar.style.width = '100%';
      return;
    }
    step.textContent = `Step ${this.i + 1} of ${LESSONS.length}`;
    text.innerHTML = LESSONS[this.i].text(this.keyName);
    bar.style.width = `${Math.round(p * 100)}%`;
    root.classList.toggle('ok', p >= 1);
  }

  // Returns 'step' when a step is ticked off, 'done' when the last one is.
  update(dt, car, inp) {
    if (!this.active) return null;
    if (this.done) {
      this.hold += dt;
      if (this.hold > 6) this.stop();
      return null;
    }
    if (this.hold > 0) {                 // short pause on a finished step
      this.hold += dt;
      if (this.hold < 1.1) return null;
      this.hold = 0;
      this.i++;
      this.s = {};
      if (this.i >= LESSONS.length) { this.done = true; this.render(1); return 'done'; }
      this.render(0);
      return null;
    }
    const p = LESSONS[this.i].check({ car, inp }, this.s, dt);
    this.render(p);
    if (p >= 1) { this.hold = 0.0001; return 'step'; }
    return null;
  }
}
