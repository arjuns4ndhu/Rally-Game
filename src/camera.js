// Camera rigs: chase, bonnet, far chase. Cycled with C.
import * as THREE from 'three';

export const CAMERA_MODES = ['chase', 'cockpit', 'bonnet', 'far', 'drone'];
const RIGS = {
  chase: { dist: 6.4, height: 2.3, look: 1.0, ahead: 3, fov: 62, stiff: 6.5 },
  far: { dist: 11.5, height: 4.4, look: 1.2, ahead: 5, fov: 58, stiff: 5 },
};

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.dir = new THREE.Vector2(0, 1);
    this.shake = 0;
    this._v = new THREE.Vector3();
  }

  cycle() {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    return this.mode;
  }

  snap(car) { this.update(car, 1, true); }

  update(car, dt, snap = false) {
    const cam = this.cam;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const y = car.y ?? 0;

    if (this.mode === 'drone' && this.drone) {
      // Filmed from the chase drone, looking at the car.
      cam.position.copy(this.drone.pos);
      cam.position.y -= 0.3;
      this.look.set(car.x, y + 0.6, car.z);
      cam.lookAt(this.look);
      cam.fov = THREE.MathUtils.lerp(cam.fov, 48, Math.min(1, dt * 3));
      cam.updateProjectionMatrix();
      return;
    }

    // Slope of the ground ahead (smoothed): the view tilts with it, and on
    // descents the camera rises so you can see down past the car.
    let slopeNow = 0;
    if (this.groundAt) {
      const ax = car.x + this.dir.x * 14, az = car.z + this.dir.y * 14;
      slopeNow = Math.max(-0.45, Math.min(0.45, (this.groundAt(ax, az) - y) / 14));
    }
    this.slope = snap || this.slope == null ? slopeNow : this.slope + (slopeNow - this.slope) * Math.min(1, dt * 4);
    const slope = this.slope, down = Math.max(0, -slope);
    // Taller cars (the rally-raid SUV) get the camera higher and further back.
    const ex = Math.max(0, (this.roofH ?? 1.1) - 1.1);

    // From the driver's seat the roof lining and pillars are only a hand's
    // width away, so the cockpit view draws much closer than the others.
    const near = this.mode === 'cockpit' && this.model ? 0.04 : 0.2;
    if (cam.near !== near) { cam.near = near; cam.updateProjectionMatrix(); }

    if (this.mode === 'cockpit' && this.model) {
      // From the driver's seat, following the car's body (pitch, roll, bumps).
      const m = this.model;
      m.root.updateMatrixWorld(true);
      cam.position.copy(m.seat).applyMatrix4(m.body.matrixWorld);
      this._v.set(m.seat.x, m.seat.y - 0.3, m.seat.z + 12).applyMatrix4(m.body.matrixWorld);
      cam.up.set(0, 1, 0);
      cam.lookAt(this._v);
      cam.fov = THREE.MathUtils.lerp(cam.fov, 64 + Math.min(car.speed, 50) * 0.12, Math.min(1, dt * 3));
      cam.updateProjectionMatrix();
      return;
    }

    if (this.mode === 'bonnet') {
      const camY = y + Math.max(1.5, (this.roofH ?? 1.1) + 0.3);
      cam.position.set(car.x + fx * 0.9, camY, car.z + fz * 0.9);
      this._v.set(car.x + fx * 25, camY - 0.4 + slope * 0.85 * 25, car.z + fz * 25);
      cam.lookAt(this._v);
      cam.fov = THREE.MathUtils.lerp(cam.fov, 72 + Math.min(car.speed, 50) * 0.18, Math.min(1, dt * 3));
      cam.updateProjectionMatrix();
      return;
    }

    const rig = RIGS[this.mode];
    // Look direction blends between the car's nose and its travel direction,
    // so mid-drift you see where you're going and the car turns in frame.
    let tx = fx, tz = fz;
    if (car.speed > 4 && car.vF > 0) {
      const vx = car.vx / car.speed, vz = car.vz / car.speed;
      tx = fx * 0.45 + vx * 0.55; tz = fz * 0.45 + vz * 0.55;
      const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * rig.stiff * 0.5);
    this.dir.x += (tx - this.dir.x) * k; this.dir.y += (tz - this.dir.y) * k;
    this.dir.normalize();

    const height = rig.height + ex * 1.6, look = rig.look + ex * 0.7;
    const dist = rig.dist + ex * 2.0 + Math.min(car.speed, 45) * 0.03;
    const camY = y + height + down * dist * 1.1;
    const want = this._v.set(car.x - this.dir.x * dist, camY, car.z - this.dir.y * dist);
    // Never down in the ground behind the car on a climb.
    if (this.groundAt) want.y = Math.max(want.y, this.groundAt(want.x, want.z) + height * 0.75);
    const kp = snap ? 1 : 1 - Math.exp(-dt * rig.stiff);
    const ky = snap ? 1 : 1 - Math.exp(-dt * rig.stiff * 2.2);   // keep up with height changes
    this.pos.x += (want.x - this.pos.x) * kp;
    this.pos.z += (want.z - this.pos.z) * kp;
    this.pos.y += (want.y - this.pos.y) * ky;
    if (this.groundAt) this.pos.y = Math.max(this.pos.y, this.groundAt(this.pos.x, this.pos.z) + 0.8);
    // Aim: same framing as on the flat, tilted to follow the slope.
    const span = dist + rig.ahead;
    const base = (height - look) / span;
    const lookY = camY + (slope * 0.85 - base) * span;
    this.lookY = snap || this.lookY == null ? lookY : this.lookY + (lookY - this.lookY) * Math.min(1, dt * 6);
    this.look.set(car.x + this.dir.x * rig.ahead, this.lookY, car.z + this.dir.y * rig.ahead);

    cam.position.copy(this.pos);
    // A touch of shake from rough surfaces / big slides.
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
    }
    cam.lookAt(this.look);
    const fov = rig.fov + Math.min(car.speed, 50) * 0.22;
    cam.fov = snap ? fov : THREE.MathUtils.lerp(cam.fov, fov, Math.min(1, dt * 3));
    cam.updateProjectionMatrix();
  }
}

// Replay "TV" director: trackside cameras placed beside the road ahead of
// the car that pan and zoom to follow it as it passes, cut with drone shots.
export class TVCamera {
  constructor(camera) {
    this.cam = camera;
    this.look = new THREE.Vector3();
    this.reset();
  }

  reset() { this.spot = null; this.shot = 0; this.kind = 'track'; this.timer = 0; this.n = 0; }

  // q: the car's road position ({ along }). road: Road. groundAt(x, z).
  update(car, dt, road, along, groundAt, drone) {
    this.timer += dt;
    const y = car.y ?? 0;
    let cut = !this.spot && this.kind !== 'drone';
    if (this.kind === 'drone' && this.timer > 4.5) cut = true;
    if (this.kind === 'track' && this.spot) {
      const d = Math.hypot(car.x - this.spot.x, car.z - this.spot.z);
      if (along > this.spot.along + 18 || d > 140) cut = true;
    }
    if (cut) {
      this.n++;
      this.timer = 0;
      if (this.n % 4 === 0 && drone) { this.kind = 'drone'; this.spot = null; }
      else {
        this.kind = 'track';
        // Deterministic-ish variety from the shot number.
        const r = (k) => (Math.sin(this.n * 12.9898 + k * 78.233) * 43758.5453) % 1;
        const a = Math.min(road.length - 1, along + 45 + Math.abs(r(1)) * 35);
        const i = road.indexAt(a);
        const side = r(2) > 0 ? 1 : -1;
        const lat = side * (road.width / 2 + 3 + Math.abs(r(3)) * 4);
        const x = road.px[i] + road.tz[i] * lat, z = road.pz[i] - road.tx[i] * lat;
        this.spot = { x, z, y: groundAt(x, z) + 1.2 + Math.abs(r(4)) * 3, along: a };
      }
      this.look.set(car.x, y + 0.7, car.z);
      this.snapFov = true;
    }
    const cam = this.cam;
    if (this.kind === 'drone' && drone) {
      cam.position.copy(drone.pos);
      cam.position.y -= 0.3;
    } else {
      cam.position.set(this.spot.x, this.spot.y, this.spot.z);
    }
    // Pan smoothly onto the car; zoom so it stays a similar size.
    const k = Math.min(1, dt * 8);
    this.look.x += (car.x - this.look.x) * k;
    this.look.y += (y + 0.7 - this.look.y) * k;
    this.look.z += (car.z - this.look.z) * k;
    cam.lookAt(this.look);
    const dist = cam.position.distanceTo(this.look);
    const fov = this.kind === 'drone' ? 48 : THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(5.5 / dist)), 10, 60);
    cam.fov = this.snapFov ? fov : cam.fov + (fov - cam.fov) * Math.min(1, dt * 4);
    this.snapFov = false;
    cam.updateProjectionMatrix();
  }
}
