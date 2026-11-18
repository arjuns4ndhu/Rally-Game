// A camera drone that chases the car: low-poly quadcopter with spinning
// props and blinking lights. It flies off to one side and a little behind,
// lagging on a spring so it swoops through corners, and swaps sides now and
// then. The 'drone' camera mode films from it.
import * as THREE from 'three';

export class Drone {
  constructor(scene) {
    this.root = new THREE.Group();
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.side = 1;
    this.sideT = 1;
    this.swapTimer = 9;
    this.t = 0;
    this.enabled = true;
    this.props = [];
    this._build();
    scene.add(this.root);
  }

  _build() {
    const body = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, flatShading: true });
    const shell = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.5, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.4 });
    const blade = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.35, depthWrite: false });
    const r = this.root;
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.42), shell);
    r.add(core);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.28), body);
    top.position.y = 0.08; r.add(top);
    // Gimbal camera hanging under the nose.
    const gimbal = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), dark);
    gimbal.position.set(0, -0.1, 0.17); r.add(gimbal);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 8), new THREE.MeshBasicMaterial({ color: 0x3a6cff }));
    lens.rotation.x = Math.PI / 2; lens.position.set(0, -0.1, 0.23); r.add(lens);
    // Four arms, motors and rotor discs.
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.42), body);
      arm.position.set(sx * 0.2, 0, sz * 0.2);
      arm.rotation.y = Math.atan2(sx, sz);
      r.add(arm);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8), dark);
      motor.position.set(sx * 0.34, 0.04, sz * 0.34); r.add(motor);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.2, 18), blade);
      disc.rotation.x = -Math.PI / 2; disc.position.set(sx * 0.34, 0.09, sz * 0.34); r.add(disc);
      const prop = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.008, 0.035), dark);
      prop.position.set(sx * 0.34, 0.095, sz * 0.34); r.add(prop);
      this.props.push({ mesh: prop, dir: sx * sz });
      // Nav lights: red on the left front, green on the right front.
      if (sz > 0) {
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: sx > 0 ? 0xff2a2a : 0x2aff5a }));
        led.position.set(sx * 0.34, -0.02, sz * 0.34); r.add(led);
      }
    }
    this.strobe = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.strobe.position.set(0, 0.12, -0.15);
    r.add(this.strobe);
    r.scale.setScalar(1.6);
  }

  // Where the drone wants to be: beside and a bit behind the car, above the ground.
  _target(car, groundAt, out) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    let dx = fx, dz = fz;
    if (car.speed > 4) { dx = car.vx / car.speed; dz = car.vz / car.speed; }
    const lx = dz, lz = -dx;                      // left of travel
    const back = 7 + Math.min(car.speed, 40) * 0.12;
    out.set(car.x - dx * back + lx * 6 * this.sideT, (car.y ?? 0) + 5.5, car.z - dz * back + lz * 6 * this.sideT);
    const g = groundAt(out.x, out.z);
    if (out.y < g + 4) out.y = g + 4;
    return out;
  }

  snap(car, groundAt) {
    this._target(car, groundAt, this.pos);
    this.vel.set(car.vx || 0, 0, car.vz || 0);
    this.root.position.copy(this.pos);
  }

  update(car, dt, groundAt) {
    this.root.visible = this.enabled && !this.hidden;
    this.t += dt;
    // Swap sides every so often for a different angle.
    this.swapTimer -= dt;
    if (this.swapTimer <= 0) { this.side = -this.side; this.swapTimer = 8 + Math.random() * 6; }
    this.sideT += (this.side - this.sideT) * Math.min(1, dt * 0.8);

    const want = this._target(car, groundAt, _t);
    if (want.distanceTo(this.pos) > 60) { this.snap(car, groundAt); return; }
    // Spring toward the target with the car's velocity fed forward,
    // so it keeps up but lags and swoops through direction changes.
    const k = 3.2, c = 2 * Math.sqrt(k);
    _a.set(car.vx || 0, 0, car.vz || 0).sub(this.vel).multiplyScalar(c * 0.9);
    _a.addScaledVector(_d.subVectors(want, this.pos), k);
    const ax = _a.x, az = _a.z;
    this.vel.addScaledVector(_a, dt);
    this.pos.addScaledVector(this.vel, dt);
    // Never through the ground.
    const g = groundAt(this.pos.x, this.pos.z) + 2.5;
    if (this.pos.y < g) { this.pos.y = g; if (this.vel.y < 0) this.vel.y = 0; }

    const r = this.root;
    r.position.copy(this.pos);
    r.position.y += Math.sin(this.t * 2.3) * 0.08;
    // Face the car, tilt into the acceleration like a real quad.
    const yaw = Math.atan2((car.x - this.pos.x), (car.z - this.pos.z));
    r.rotation.order = 'YXZ';
    r.rotation.y = yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const aF = ax * fx + az * fz, aR = ax * fz - az * fx;
    r.rotation.x += (Math.max(-0.45, Math.min(0.45, aF * 0.05)) - r.rotation.x) * Math.min(1, dt * 6);
    r.rotation.z += (Math.max(-0.45, Math.min(0.45, aR * 0.05)) - r.rotation.z) * Math.min(1, dt * 6);
    for (const p of this.props) p.mesh.rotation.y += p.dir * dt * 60;
    this.strobe.visible = (this.t % 1.1) < 0.08;
  }
}
const _t = new THREE.Vector3(), _a = new THREE.Vector3(), _d = new THREE.Vector3();
