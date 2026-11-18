// Test driver for balancing: drives a stage flat out within each car's grip
// and returns the time. window.__bot(carId, kind, seed, opts)
window.__bot = (carId, kind, seed, { sign = 1, gripK = 0.82, maxT = 400 } = {}) => {
  const S = window.__sideways;
  const spec = S.CARS[carId];
  S.car.setSpec(spec);
  S.loadStage(kind, seed);
  const road = S.road, stage = S.stage;
  const n = road.n;
  // Curvature per sample (rad/m).
  const kap = new Float32Array(n);
  for (let i = 1; i < n - 1; i++) {
    const a0 = Math.atan2(road.tx[i - 1], road.tz[i - 1]), a1 = Math.atan2(road.tx[i + 1], road.tz[i + 1]);
    let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    kap[i] = Math.abs(d) / Math.max(0.1, road.cum[i + 1] - road.cum[i - 1]);
  }
  const mu = (spec.muF + spec.muR) / 2 * gripK;
  const i0 = road.indexAt(stage.start - 10);
  S.placeOnRoad(i0);
  S.run.state = 'bot';                // keep the race timer out of it
  const car = S.car;
  let t = 0, hint = i0, off = 0, far = 0, vmax = 0; const trace = [];
  const dt = 1 / 30;
  while (t < maxT) {
    const q = road.nearest(car.x, car.z, hint); hint = q.i;
    if (q.along >= stage.finish) break;
    if (q.dist > road.width / 2 + 1.5) off += dt;
    const v = car.speed; far = Math.max(far, q.along); vmax = Math.max(vmax, v);
    if (Math.round(t / dt) % 150 === 0) trace.push([+t.toFixed(0), +q.along.toFixed(0), +v.toFixed(1), +q.dist.toFixed(1)]);
    // Steering: aim at a point ahead on the centreline.
    const la = 5 + v * 0.45;
    const j = road.indexAt(q.along + la);
    const dx = road.px[j] - car.x, dz = road.pz[j] - car.z;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const ang = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
    const steer = Math.max(-1, Math.min(1, sign * ang * 2.2));
    // Speed: the slowest corner within braking distance.
    const brakeD = v * v / (2 * 7) + 15;
    let vt = 99;
    for (let a = q.along; a < q.along + brakeD; a += 2) {
      const k = kap[road.indexAt(a)];
      if (k > 0.002) {
        const vc = Math.sqrt(mu * 9.81 / k);
        const dist = a - q.along;
        vt = Math.min(vt, Math.sqrt(vc * vc + 2 * 7 * dist));
      }
    }
    // Lift for crests and jumps (landing off line ends the run).
    for (const b of road.bumps || []) {
      const dist = b.at - q.along;
      if (dist > -8 && dist < brakeD) vt = Math.min(vt, Math.sqrt(17 * 17 + 2 * 7 * Math.max(0, dist - 5)));
    }
    const inp = v < vt ? { throttle: 1, brake: 0, steer, handbrake: 0 } : v > vt + 1.5 ? { throttle: 0, brake: 1, steer, handbrake: 0 } : { throttle: 0.3, brake: 0, steer, handbrake: 0 };
    // Ease off when the tail steps out, like a real driver would.
    const slide = Math.abs(car.driftAngle || 0);
    if (slide > 0.18 && inp.throttle > 0.4) inp.throttle = slide > 0.35 ? 0.15 : 0.5;
    if (q.dist > road.width / 2 - 0.5 && inp.throttle > 0.6) inp.throttle = 0.6;
    S.stepSim(dt, inp);
    t += dt;
  }
  S.run.state = 'idle';
  return { car: carId, t: +t.toFixed(2), off: +off.toFixed(1), done: t < maxT, far: +far.toFixed(0), finish: +stage.finish.toFixed(0), vmax: +vmax.toFixed(1), trace };
};
