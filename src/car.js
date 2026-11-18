// Vehicle physics for Sideways. Pure math, no Three.js.
//
// The car is a top-down "bicycle" model integrated in world space:
//   - one front axle and one rear axle, each with its own lateral tyre curve
//   - weight transfer moves load between the axles under accel / braking
//   - a friction circle lets drive / brake force eat into lateral grip
//   - arcade assists (auto counter-steer, drift boost, speed-scaled steering)
//
// Conventions: the car faces local +z. yaw = 0 faces world +z. Positive yaw
// turns the nose toward world +x, which is the car's LEFT. Positive steer = left.

const G = 9.81;

// Six cars, each modelled on a classic rally icon (shape and character only;
// no real names or badges). Balanced so that, driven the same way, all six
// finish the five Classic stages within about 1% of each other: each wins
// somewhere (the Brutale on fast gravel and tarmac, the Pocket and Dune
// Raider on snow) instead of one car being quickest everywhere.
// wheelR = tyre radius (m); offroad = 0..1 how much of the grass/verge
// penalty the car shrugs off.
export const CARS = {
  stiletto: {
    id: 'stiletto', name: 'Stiletto V6', tag: '70s mid-engine wedge · sharp, tail-happy',
    mass: 980, a: 1.18, b: 1.0, h: 0.42, inertia: 0.9,
    drive: 'RWD', frontDrive: 0,
    torque: 189, peakRpm: 6000, idleRpm: 1000, redline: 8000,
    gears: [3.0, 2.1, 1.6, 1.25, 1.0], finalDrive: 4.6,
    muF: 1.28, muR: 1.18, peakF: 0.13, peakR: 0.13, slideF: 0.82, slideR: 0.76,
    maxSteer: 0.66, steerSpeed: 6.2, counterSteer: 0.78,
    driftAssist: 1.0, throttleOversteer: 0.66, driftBoost: 2.6, dragCoef: 0.42,
    track: 1.48, length: 3.71, wheelR: 0.31, offroad: 0, bodyStyle: 'stratos', cyl: 6,
  },
  pocket: {
    id: 'pocket', name: 'Pocket 1275', tag: '60s mini box · front-drive, light & nimble',
    mass: 700, a: 0.82, b: 1.22, h: 0.45, inertia: 0.95,
    drive: 'FWD', frontDrive: 1,
    torque: 96, peakRpm: 5200, idleRpm: 950, redline: 7600,
    gears: [3.3, 2.1, 1.5, 1.2, 0.98], finalDrive: 5.2,
    muF: 1.43, muR: 1.29, peakF: 0.13, peakR: 0.14, slideF: 0.82, slideR: 0.72,
    maxSteer: 0.64, steerSpeed: 5.8, counterSteer: 0.55,
    driftAssist: 1.15, throttleOversteer: 0.1, driftBoost: 2.4, dragCoef: 0.4,
    track: 1.25, length: 3.05, wheelR: 0.27, offroad: 0, bodyStyle: 'mini', cyl: 4,
  },
  // Unlockable: gold on three Classic stages.
  brute: {
    id: 'brute', name: 'Brutale S4', tag: '80s Group B monster · 4WD, savage power, glued to the road',
    // Handles like the real thing: mid-engine (weight over the rear), a
    // rear-biased 4WD split, a light, eager tail that steps out under power
    // and grip that falls away quickly once it's sliding. Quick, but it has
    // to be driven. Less steady grip than the later WRC car; far more shove.
    mass: 1100, a: 1.3, b: 1.1, h: 0.42, inertia: 0.86,
    drive: 'AWD', frontDrive: 0.3,
    torque: 450, peakRpm: 6200, idleRpm: 1000, redline: 8200,
    gears: [2.9, 2.05, 1.55, 1.22, 0.98], finalDrive: 4.7,
    muF: 1.3, muR: 1.07, peakF: 0.13, peakR: 0.13, slideF: 0.84, slideR: 0.74,
    maxSteer: 0.66, steerSpeed: 6.0, counterSteer: 0.6,
    driftAssist: 1.0, throttleOversteer: 1.0, driftBoost: 2.7, dragCoef: 0.5,
    track: 1.56, length: 4.0, wheelR: 0.33, offroad: 0, bodyStyle: 'groupb', cyl: 4, turbo: true,
  },
  quadra: {
    id: 'quadra', name: 'Quadra 5T', tag: '80s turbo coupé · 4WD, huge torque, nose-heavy',
    mass: 1290, a: 1.0, b: 1.52, h: 0.52, inertia: 1.05,
    drive: 'AWD', frontDrive: 0.5,
    torque: 700, peakRpm: 4800, idleRpm: 900, redline: 7000,
    gears: [3.0, 2.0, 1.45, 1.15, 0.92], finalDrive: 4.6,
    muF: 1.12, muR: 1.02, peakF: 0.14, peakR: 0.15, slideF: 0.82, slideR: 0.72,
    maxSteer: 0.6, steerSpeed: 4.8, counterSteer: 0.5,
    driftAssist: 1.0, throttleOversteer: 0.55, driftBoost: 2.4, dragCoef: 0.6,
    track: 1.5, length: 4.4, wheelR: 0.33, offroad: 0, bodyStyle: 'quattro', cyl: 5, turbo: true,
  },
  vector: {
    id: 'vector', name: 'Vector WRC', tag: '00s world-rally hatch · grippy 4WD',
    mass: 1230, a: 1.25, b: 1.37, h: 0.5, inertia: 1.0,
    drive: 'AWD', frontDrive: 0.42,
    torque: 368, peakRpm: 4500, idleRpm: 900, redline: 7500,
    gears: [3.1, 2.1, 1.6, 1.28, 1.05], finalDrive: 4.4,
    muF: 1.12, muR: 1.08, peakF: 0.14, peakR: 0.15, slideF: 0.86, slideR: 0.8,
    maxSteer: 0.6, steerSpeed: 4.8, counterSteer: 0.55,
    driftAssist: 1.1, throttleOversteer: 0.4, driftBoost: 2.4, dragCoef: 0.46,
    track: 1.58, length: 4.15, wheelR: 0.32, offroad: 0, bodyStyle: 'focus', cyl: 4, turbo: true,
  },
  raider: {
    id: 'raider', name: 'Dune Raider', tag: 'Rally-raid SUV · heavy, tall, at home off-road',
    mass: 1950, a: 1.4, b: 1.45, h: 0.68, inertia: 1.1,
    drive: 'AWD', frontDrive: 0.45,
    torque: 500, peakRpm: 4200, idleRpm: 800, redline: 6600,
    gears: [3.6, 2.3, 1.6, 1.2, 0.95], finalDrive: 5.7,
    muF: 1.19, muR: 1.05, peakF: 0.16, peakR: 0.17, slideF: 0.84, slideR: 0.72,
    maxSteer: 0.55, steerSpeed: 3.8, counterSteer: 0.5,
    driftAssist: 1.1, throttleOversteer: 0.65, driftBoost: 2.2, dragCoef: 0.8,
    track: 1.7, length: 4.7, wheelR: 0.42, offroad: 0.7, bodyStyle: 'dakar', cyl: 8,
  },
};

export const CAR_ORDER = ['stiletto', 'pocket', 'quadra', 'vector', 'raider', 'brute'];

// Global feel knobs, shared by every car (exported so the debug panel can tweak them).
export const TUNE = {
  yawDamp: 0.6,        // arcade yaw damping
  boostHeading: 1.0,   // 0 = drift boost along velocity, 1 = along the car's nose
  transfer: 1.6,       // weight transfer multiplier
  driftGain: 3.0,      // how hard the drift controller chases its target angle
  driftAssist: 4.0,    // yaw-rate tracking strength while drifting
  driftEnter: 0.12,    // slip angle (rad) that counts as "now drifting"
  tractionPull: 0.4,   // g of sideways pull the driven wheels add toward the nose
  driftBase: 0.18,     // drift angle (rad) held with the wheel centred
  driftSteer: 0.5,    // extra angle when steering fully into the corner
};

const REVERSE_RATIO = 3.2;
const SHIFT_TIME = 0.16;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;

// Normalised tyre curve: rises to 1 at the peak slip angle, then falls off
// toward `slide` as the tyre goes into a full slide.
function tyreCurve(alpha, peak, slide) {
  const x = Math.abs(alpha) / peak;
  let f;
  if (x <= 1) f = x * (2 - x);
  else f = slide + (1 - slide) * Math.exp(-(x - 1) * 1.6);
  return Math.sign(alpha) * f;
}

export class CarPhysics {
  constructor(spec) {
    this.setSpec(spec);
    this.reset(0, 0, 0);
  }

  setSpec(spec) {
    this.spec = spec;
    this.L = spec.a + spec.b;
    this.I = spec.mass * spec.a * spec.b * spec.inertia;
  }

  reset(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.vx = 0; this.vz = 0; this.yawRate = 0;
    this.steer = 0;          // actual front wheel angle (rad)
    this.steerInput = 0;     // smoothed player input (-1..1)
    this.gear = 1;
    this.rpm = this.spec.idleRpm;
    this.shiftTimer = 0;
    this.reverseTimer = 0;
    this.axSmooth = 0;       // longitudinal accel used for weight transfer
    this.aySmooth = 0;       // lateral accel (for body roll)
    // Outputs read by visuals / audio / HUD
    this.vF = 0; this.vL = 0; this.speed = 0;
    this.slipF = 0; this.slipR = 0; this.driftAngle = 0;
    this.rearSlide = 0;      // 0..1 how much the rear is sliding / spinning
    this.frontSlide = 0;
    this.wheelSpin = 0;
    this.loadF = 0; this.loadR = 0;
    this.throttle = 0; this.brake = 0;
    this.shifted = 0;        // +1 / -1 on the frame a gear change happens
    this.drifting = false;
    this.velHead = yaw; this.velHeadRate = 0;
  }

  // input: {throttle, brake, steer (-1 right .. +1 left), handbrake}
  // surface: {grip (multiplier), drag (extra decel factor)}
  step(dt, input, surface) {
    const s = this.spec;
    const m = s.mass;
    const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);

    // Local velocities: forward and left.
    let vF = this.vx * sn + this.vz * cs;
    let vL = this.vx * cs - this.vz * sn;
    const speed = Math.hypot(vF, vL);

    // ---- Gear / reverse logic --------------------------------------------
    let throttle = input.throttle, brake = input.brake;
    if (this.gear > 0) {
      // Reverse only once the car has genuinely stopped (not while sliding sideways).
      if (brake > 0.5 && throttle < 0.1 && speed < 1.0) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.35) { this.gear = -1; this.reverseTimer = 0; this.shifted = -1; }
      } else this.reverseTimer = 0;
    } else {
      // In reverse: brake key drives backwards, throttle key brakes.
      if (throttle > 0.3 && vF > -0.8) { this.gear = 1; this.shifted = 1; }
      else { const t = throttle; throttle = brake; brake = t; }
    }
    this.throttle = throttle; this.brake = brake;

    // ---- Steering --------------------------------------------------------
    const target = clamp(input.steer, -1, 1);
    const returning = Math.abs(target) < Math.abs(this.steerInput) || Math.sign(target) !== Math.sign(this.steerInput);
    const rate = s.steerSpeed * (returning ? 1.6 : 1);
    this.steerInput += clamp(target - this.steerInput, -rate * dt, rate * dt);

    const beta = speed > 3 ? Math.atan2(vL, Math.abs(vF)) : 0;  // body slip angle
    const speedFactor = clamp(speed / 32, 0, 1);
    const inputLock = lerp(s.maxSteer, s.maxSteer * 0.36, speedFactor);
    let steerAngle = this.steerInput * inputLock;
    // Auto counter-steer: point the front wheels a little toward where the
    // car is actually travelling, so slides are catchable.
    if (vF > 2) steerAngle += clamp(beta, -0.9, 0.9) * s.counterSteer * clamp(speed / 10, 0, 1);
    steerAngle = clamp(steerAngle, -0.75, 0.75);
    this.steer = steerAngle;

    // ---- Loads with weight transfer --------------------------------------
    const staticF = m * G * s.b / this.L;
    const staticR = m * G * s.a / this.L;
    const transfer = m * this.axSmooth * s.h / this.L * TUNE.transfer;
    const loadF = Math.max(staticF - transfer, staticF * 0.25);
    const loadR = Math.max(staticR + transfer, staticR * 0.25);
    this.loadF = loadF; this.loadR = loadR;

    // Off-road specialists lose less on grass and verges.
    const off = s.offroad || 0;
    const grip = surface.grip + (1 - surface.grip) * off;
    const surfDrag = surface.drag * (1 - off);
    const WHEEL_R = s.wheelR || 0.32;
    const maxF = s.muF * loadF * grip;
    const maxR = s.muR * loadR * grip;

    // ---- Engine & drive force --------------------------------------------
    const ratio = this.gear > 0 ? s.gears[this.gear - 1] : REVERSE_RATIO;
    const wheelRpm = Math.abs(vF) / WHEEL_R * 60 / (2 * Math.PI);
    let rpmFromWheels = wheelRpm * ratio * s.finalDrive;
    // Launch clutch slip: let revs rise with throttle when slow.
    const launch = s.idleRpm + throttle * (s.peakRpm - s.idleRpm) * 0.8;
    let rpmTarget = Math.max(rpmFromWheels, speed < 8 ? lerp(launch, rpmFromWheels, speed / 8) : 0, s.idleRpm);
    // Wheelspin flare while the rear is sliding under power.
    rpmTarget += throttle * this.wheelSpin * 1400;
    rpmTarget = Math.min(rpmTarget, s.redline + 150);
    this.rpm = lerp(this.rpm, rpmTarget, clamp(dt * 18, 0, 1));

    // Torque curve: a broad hump peaking at peakRpm.
    const rn = (this.rpm - s.peakRpm) / s.peakRpm;
    let torque = s.torque * clamp(1 - rn * rn * 0.9, 0.35, 1);
    if (this.rpm >= s.redline) torque = 0; // limiter

    let driveForce = 0;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    else driveForce = throttle * torque * ratio * s.finalDrive * 0.85 / WHEEL_R;
    if (this.gear < 0) {
      driveForce = -driveForce;
      if (vF < -9) driveForce = 0; // reverse speed limit ~32 km/h
    }
    if (input.handbrake) driveForce *= 0.25;

    // Engine braking when off throttle (on the driven wheels).
    let engineBrake = 0;
    if (throttle < 0.05 && this.gear > 0 && vF > 1) {
      engineBrake = -(this.rpm / s.redline) * ratio * 160;
    }

    // ---- Auto gearbox ----------------------------------------------------
    this.shifted = this.shifted && this.shiftTimer > 0 ? this.shifted : 0;
    if (this.gear > 0 && this.shiftTimer <= 0) {
      if (this.rpm > s.redline * 0.93 && this.gear < s.gears.length && throttle > 0.1) {
        this.gear++; this.shiftTimer = SHIFT_TIME; this.shifted = 1;
      } else if (this.gear > 1) {
        const lower = s.gears[this.gear - 2];
        const rpmLower = wheelRpm * lower * s.finalDrive;
        const down = throttle > 0.3 ? s.redline * 0.55 : s.redline * 0.38;
        if (this.rpm < down && rpmLower < s.redline * 0.85) {
          this.gear--; this.shiftTimer = SHIFT_TIME * 0.6; this.shifted = -1;
        }
      }
    }

    // ---- Longitudinal forces per axle ------------------------------------
    const fd = s.frontDrive;
    let FxF = driveForce * fd;
    let FxR = driveForce * (1 - fd) + engineBrake;

    const dirF = vF >= 0 ? 1 : -1;
    const brakeTotal = brake * m * G * 1.05;
    let brakeF = brakeTotal * 0.62, brakeR = brakeTotal * 0.38;
    let hbForce = 0;
    if (input.handbrake) hbForce = maxR * 0.55;
    // Don't let brakes push the car backwards at a standstill.
    const stopFactor = clamp(speed / 0.6, 0, 1);
    FxF -= dirF * brakeF * stopFactor;
    FxR -= dirF * (brakeR + hbForce) * stopFactor;

    // 4WD centre diff: drive the slipping axle can't use goes to the other
    // one (60%: a viscous diff is never perfect). This is what launches the
    // 4WD cars so hard off the line.
    if (fd > 0 && fd < 1 && driveForce > 0) {
      const overR = FxR - maxR, overF = FxF - maxF;
      if (overR > 0 && overF < 0) { const k = Math.min(overR, -overF) * 0.6; FxF += k; FxR -= k; }
      else if (overF > 0 && overR < 0) { const k = Math.min(overF, -overR) * 0.6; FxR += k; FxF -= k; }
    }
    FxF = clamp(FxF, -maxF, maxF);
    FxR = clamp(FxR, -maxR, maxR);

    // ---- Lateral tyre forces --------------------------------------------
    const csS = Math.cos(steerAngle), snS = Math.sin(steerAngle);
    const lowSpeed = 2.5;
    // Front wheel frame
    const fLat = vL + this.yawRate * s.a;
    const fwF = vF * csS + fLat * snS;
    const fwL = -vF * snS + fLat * csS;
    const alphaF = Math.atan2(fwL, Math.max(Math.abs(fwF), lowSpeed));
    // Rear
    const rLat = vL - this.yawRate * s.b;
    const alphaR = Math.atan2(rLat, Math.max(Math.abs(vF), lowSpeed));

    // Friction circle (softened, arcade): longitudinal use reduces lateral grip.
    const useF = Math.abs(FxF) / (maxF + 1e-3);
    const useR = Math.abs(FxR) / (maxR + 1e-3);
    const latScaleF = 1 - 0.35 * useF * useF;
    let latScaleR = 1 - s.throttleOversteer * useR * useR;
    if (input.handbrake) latScaleR *= 0.42;

    const FyF = -maxF * latScaleF * tyreCurve(alphaF, s.peakF, s.slideF);
    const FyR = -maxR * latScaleR * tyreCurve(alphaR, s.peakR, s.slideR);

    this.slipF = alphaF; this.slipR = alphaR;
    this.frontSlide = clamp((Math.abs(alphaF) - s.peakF) / 0.3, 0, 1);
    const rearLatSlide = clamp((Math.abs(alphaR) - s.peakR * 0.8) / 0.35, 0, 1);
    this.wheelSpin = lerp(this.wheelSpin, clamp(useR * throttle * (1 - fd * 0.5) - 0.55, 0, 1) * 2 + (input.handbrake && speed > 3 ? 0.6 : 0), clamp(dt * 8, 0, 1));
    this.rearSlide = clamp(Math.max(rearLatSlide, this.wheelSpin), 0, 1) * clamp(speed / 4, 0, 1);

    // ---- Sum forces in the body frame ------------------------------------
    let Fx = FxF * csS - FyF * snS + FxR;
    let Fy = FxF * snS + FyF * csS + FyR;
    let torqueZ = s.a * (FxF * snS + FyF * csS) - s.b * FyR;

    // Aero + rolling + surface drag (along velocity).
    if (speed > 0.01) {
      const drag = s.dragCoef * speed * speed + m * 0.12 + m * surfDrag * (2.5 + speed * 0.22);
      const k = drag / speed;
      Fx -= k * vF;
      Fy -= k * vL * 0.5;
    }

    // Braking while sideways: the tyres scrub against the direction of travel,
    // which the forward-only brake force above can't do on its own.
    if (brake > 0.05 && speed > 0.5) {
      const sideways = Math.abs(vL) / speed;
      const scrub = brake * m * G * 0.5 * grip * sideways;
      Fx -= scrub * vF / speed;
      Fy -= scrub * vL / speed;
    }

    // Drift boost: a sustained drift at a sensible angle under throttle keeps
    // its speed, so sliding through corners is the fast way round.
    const absBeta = Math.abs(beta);
    if (speed > 7 && throttle > 0.2 && absBeta > 0.1 && absBeta < 0.85 && this.gear > 0) {
      const profile = Math.sin(Math.PI * clamp((absBeta - 0.1) / 0.75, 0, 1));
      const boost = s.driftBoost * m * throttle * profile * grip;
      // Push along the car's heading: part of it keeps the speed up and part
      // of it turns the velocity toward where the nose points.
      const hb = TUNE.boostHeading;
      Fx += boost * (hb + (1 - hb) * vF / speed);
      Fy += boost * (1 - hb) * vL / speed;
    }

    // Arcade yaw damping keeps spins catchable without killing rotation.
    torqueZ -= this.yawRate * this.I * TUNE.yawDamp;

    // ---- Drift controller -------------------------------------------------
    // Once the car is properly sideways, hold a drift angle chosen by the
    // player: steer into the corner for more angle, counter-steer for less,
    // lift off to rotate further, handbrake to swing the tail for hairpins.
    if (this.gear > 0 && speed > 6) {
      if (!this.drifting && absBeta > TUNE.driftEnter) this.drifting = true;
      else if (this.drifting && (absBeta < 0.05 || speed < 5)) this.drifting = false;
    } else this.drifting = false;
    if (this.drifting) {
      const d = -Math.sign(beta);                 // +1 = rotating left
      const into = this.steerInput * d;           // +1 into the corner, -1 counter
      // The angle comes from your hands: steer into the corner to hold it,
      // centre the wheel and the car straightens up under power. Lifting
      // rotates it more; braking straightens it.
      let target = TUNE.driftBase + TUNE.driftSteer * Math.max(0, into) + 0.18 * (1 - throttle) * (1 - brake) - 0.3 * brake + (input.handbrake ? 0.25 : 0);
      if (into < 0) target *= clamp(1 + into * 1.6, 0, 1);
      target = clamp(target, 0, this.spinCatch ? 0.7 : 0.85);
      const desired = this.velHeadRate + d * (target - absBeta) * TUNE.driftGain;
      // Fade out near a full spin so a big mistake can still spin you.
      // With the beginner assist on, it never lets go, so spins get caught.
      const strength = TUNE.driftAssist * s.driftAssist * (this.spinCatch ? 1.4 : clamp((1.4 - absBeta) / 0.5, 0, 1)) * grip;
      torqueZ += (desired - this.yawRate) * this.I * strength;
    }

    // ---- Integrate --------------------------------------------------------
    const axBody = Fx / m, ayBody = Fy / m;
    // World-space acceleration
    const ax = axBody * sn + ayBody * cs;
    const az = axBody * cs - ayBody * sn;
    this.vx += ax * dt;
    this.vz += az * dt;
    this.yawRate += torqueZ / this.I * dt;

    // Low speed: blend toward kinematic steering so the car turns cleanly
    // and doesn't drift around when nearly stopped.
    if (speed < 4) {
      const t = 1 - speed / 4;
      const kin = vF * Math.tan(steerAngle) / this.L;
      this.yawRate = lerp(this.yawRate, kin, t * 0.5);
      // Kill sideways creep
      const vF2 = this.vx * sn + this.vz * cs;
      let vL2 = this.vx * cs - this.vz * sn;
      vL2 *= 1 - t * 0.3;
      this.vx = vF2 * sn + vL2 * cs;
      this.vz = vF2 * cs - vL2 * sn;
    }
    // Come to a full stop rather than creeping.
    if (throttle < 0.02 && Math.hypot(this.vx, this.vz) < 0.15) {
      this.vx *= 0.8; this.vz *= 0.8; this.yawRate *= 0.8;
    }

    // Traction pull: under power the driven wheels drive along the nose, so
    // the direction of travel swings toward where the car points. Speed is
    // kept, so a slide turns into forward drive instead of just scrubbing.
    if (this.gear > 0 && throttle > 0.05 && speed > 3 && !input.handbrake) {
      const vh = Math.atan2(this.vx, this.vz);
      let b = vh - this.yaw;
      b = Math.atan2(Math.sin(b), Math.cos(b));
      const driveK = s.drive === 'AWD' ? 1.25 : s.drive === 'FWD' ? 1.4 : 1.0;
      const v = Math.hypot(this.vx, this.vz);
      // Bounded like a real force: at most ~0.5 g, more at bigger slip angles.
      const aPull = TUNE.tractionPull * G * driveK * throttle * grip * Math.min(1, Math.abs(b) / 0.35);
      const turn = -Math.sign(b) * Math.min(Math.abs(b), (aPull / v) * dt);
      const nh = vh + turn;
      this.vx = Math.sin(nh) * v; this.vz = Math.cos(nh) * v;
    }

    this.yaw += this.yawRate * dt;
    const head = Math.atan2(this.vx, this.vz);
    if (this.speed > 1) {
      let dh = head - this.velHead;
      if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI;
      this.velHeadRate = lerp(this.velHeadRate, dh / dt, clamp(dt * 20, 0, 1));
    } else this.velHeadRate = 0;
    this.velHead = head;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Outputs
    const sn2 = Math.sin(this.yaw), cs2 = Math.cos(this.yaw);
    this.vF = this.vx * sn2 + this.vz * cs2;
    this.vL = this.vx * cs2 - this.vz * sn2;
    this.speed = Math.hypot(this.vx, this.vz);
    this.driftAngle = this.speed > 3 ? Math.atan2(this.vL, Math.abs(this.vF)) : 0;
    this.axSmooth = lerp(this.axSmooth, axBody, clamp(dt * 10, 0, 1));
    this.aySmooth = lerp(this.aySmooth, ayBody, clamp(dt * 8, 0, 1));
  }
}
