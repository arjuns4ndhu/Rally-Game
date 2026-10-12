// Camera rigs: chase, bonnet, far chase. Cycled with C.
import * as THREE from 'three';

export const CAMERA_MODES = ['chase', 'bonnet', 'far', 'drone'];
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

    if (this.mode === 'bonnet') {
      cam.position.set(car.x + fx * 0.9, y + 1.5, car.z + fz * 0.9);
      this._v.set(car.x + fx * 25, y + 1.1, car.z + fz * 25);
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

    const speedPull = Math.min(car.speed, 45) * 0.03;
    const dist = rig.dist + speedPull;
    const want = this._v.set(car.x - this.dir.x * dist, y + rig.height, car.z - this.dir.y * dist);
    // On hills, sit at a sensible height above the ground behind the car
    // rather than at the car's height (which buries it climbing and leaves
    // it hanging high going down).
    if (this.groundAt) {
      const gBehind = this.groundAt(want.x, want.z);
      want.y = Math.max(want.y, gBehind + rig.height * 0.75);
      want.y = Math.min(want.y, Math.max(gBehind, y) + rig.height * 1.15);
    }
    const kp = snap ? 1 : 1 - Math.exp(-dt * rig.stiff);
    const ky = snap ? 1 : 1 - Math.exp(-dt * rig.stiff * 2.2);   // keep up with height changes
    this.pos.x += (want.x - this.pos.x) * kp;
    this.pos.z += (want.z - this.pos.z) * kp;
    this.pos.y += (want.y - this.pos.y) * ky;
    if (this.groundAt) this.pos.y = Math.max(this.pos.y, this.groundAt(this.pos.x, this.pos.z) + 0.8);
    // Look a little ahead along the slope.
    let lookY = y + rig.look;
    if (this.groundAt) {
      const ax = car.x + this.dir.x * 10, az = car.z + this.dir.y * 10;
      lookY += Math.max(-2.5, Math.min(2.5, (this.groundAt(ax, az) - y) * 0.35));
    }
    this.lookY = snap || this.lookY == null ? lookY : this.lookY + (lookY - this.lookY) * Math.min(1, dt * 5);
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
