// Keyboard + touch input, merged into one analog-ish control state.

const KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
};

export class Input {
  constructor() {
    this.down = new Set();
    this.touch = { throttle: false, brake: false, left: false, right: false, handbrake: false };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.listeners = {};   // one-shot actions: camera, restart, pause, ...
    this.enabled = true;
    this._throttle = 0; this._brake = 0;

    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['range', 'checkbox'].includes(t.type)))) return;
      if (Object.values(KEYS).some((k) => k.includes(e.code))) e.preventDefault();
      if (!e.repeat) this.emit('key', e.code, e.key);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, ...args) { (this.listeners[name] || []).forEach((fn) => fn(...args)); }

  // Wire on-screen buttons. Each element has data-ctl="throttle|brake|left|right|handbrake".
  bindTouch(root) {
    root.querySelectorAll('[data-ctl]').forEach((el) => {
      const ctl = el.dataset.ctl;
      const set = (v) => { this.touch[ctl] = v; el.classList.toggle('on', v); };
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); set(true); });
      el.addEventListener('pointerup', () => set(false));
      el.addEventListener('pointercancel', () => set(false));
      el.addEventListener('lostpointercapture', () => set(false));
    });
    root.querySelectorAll('[data-act]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.emit('action', el.dataset.act); });
    });
  }

  any(list) { return list.some((k) => this.down.has(k)); }

  update(dt) {
    const t = this.touch;
    const thr = this.enabled && (this.any(KEYS.throttle) || t.throttle);
    const brk = this.enabled && (this.any(KEYS.brake) || t.brake);
    const l = this.enabled && (this.any(KEYS.left) || t.left);
    const r = this.enabled && (this.any(KEYS.right) || t.right);
    // Pedals ramp quickly but not instantly: a short tap gives a short pulse.
    this._throttle += ((thr ? 1 : 0) - this._throttle) * Math.min(1, dt * 14);
    this._brake += ((brk ? 1 : 0) - this._brake) * Math.min(1, dt * 18);
    const s = this.state;
    s.throttle = this._throttle < 0.02 ? 0 : this._throttle;
    s.brake = this._brake < 0.02 ? 0 : this._brake;
    s.steer = (l ? 1 : 0) - (r ? 1 : 0);   // physics smooths steering itself
    s.handbrake = this.enabled && (this.any(KEYS.handbrake) || t.handbrake);
    return s;
  }
}
