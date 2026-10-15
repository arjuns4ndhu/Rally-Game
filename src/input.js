// Keyboard, touch, game controller and phone tilt, merged into one control
// state. Steering, throttle and brake are analogue (0..1, steer -1..1) when
// the device gives analogue values; keys and buttons give full values.

// Each driving action has one key the player can rebind, plus the arrow keys
// as fixed spares.
export const ACTIONS = { throttle: 'Throttle', brake: 'Brake / reverse', left: 'Steer left', right: 'Steer right', handbrake: 'Handbrake' };
const DEFAULTS = { throttle: 'KeyW', brake: 'KeyS', left: 'KeyA', right: 'KeyD', handbrake: 'Space' };
const SPARE = { throttle: ['ArrowUp'], brake: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], handbrake: [] };
export const BINDS = { ...DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem('sideways.keys') || '{}');
  for (const a in ACTIONS) if (typeof saved[a] === 'string' && /^[A-Za-z0-9]{2,20}$/.test(saved[a])) BINDS[a] = saved[a];
} catch { /* ignore */ }
const KEYS = {};
function rebuild() { for (const a in ACTIONS) KEYS[a] = [BINDS[a], ...SPARE[a].filter((k) => k !== BINDS[a])]; }
rebuild();
function saveBinds() { try { localStorage.setItem('sideways.keys', JSON.stringify(BINDS)); } catch { /* ignore */ } }
// Bind a key; if another action had it, that action takes this one's old key.
export function bindKey(action, code) {
  const other = Object.keys(BINDS).find((a) => a !== action && BINDS[a] === code);
  if (other) BINDS[other] = BINDS[action];
  BINDS[action] = code;
  rebuild(); saveBinds();
}
export function resetKeys() { Object.assign(BINDS, DEFAULTS); rebuild(); saveBinds(); }
// Is this key one of the driving keys (so menu hotkeys should leave it alone)?
export const isDriveKey = (code) => Object.values(KEYS).some((k) => k.includes(code));
export function keyLabel(code) {
  if (code === 'Space') return 'Space';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code];
  return code.replace(/(Left|Right)$/, ' $1');
}

export class Input {
  constructor() {
    this.down = new Set();
    this.touch = { throttle: false, brake: false, left: false, right: false, handbrake: false };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.listeners = {};   // one-shot actions: camera, restart, pause, ...
    this.enabled = true;
    this._throttle = 0; this._brake = 0;

    window.addEventListener('keydown', (e) => {
      if (this.capture) { e.preventDefault(); e.stopImmediatePropagation(); const fn = this.capture; this.capture = null; fn(e.code); return; }
      const t = e.target;
      if (t && (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['range', 'checkbox'].includes(t.type)))) return;
      if (Object.values(KEYS).some((k) => k.includes(e.code))) e.preventDefault();
      if (!e.repeat) this.emit('key', e.code, e.key);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());

    // ---- Game controller (standard mapping) ----
    this.pad = null;                    // { steer, throttle, brake, handbrake } while one is in use
    this._padPrev = [];
    this._padAxisPrev = { x: 0, y: 0 };
    window.addEventListener('gamepadconnected', (e) => this.emit('padconnect', e.gamepad.id));
    window.addEventListener('gamepaddisconnected', () => { this.pad = null; this.emit('paddisconnect'); });
    const poll = () => { this.pollPad(); requestAnimationFrame(poll); };
    requestAnimationFrame(poll);

    // ---- Phone steering: 'buttons', 'tilt' or 'drag' ----
    this.steerMode = 'buttons';
    this.tiltSteer = 0;                  // -1..1 from the phone's tilt
    this.dragSteer = 0;                  // -1..1 from a thumb on the drag pad
    this._onMotion = (e) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null) return;
      // Held sideways, turning the phone like a wheel moves gravity along
      // its long (y) axis. Which way round depends on the landscape side.
      const ang = (screen.orientation?.angle ?? window.orientation ?? 90) % 360;
      const along = ang === 90 ? g.y : ang === 270 || ang === -90 ? -g.y : g.x;
      const deg = Math.asin(Math.max(-1, Math.min(1, along / 9.81))) * 180 / Math.PI;
      const dead = 2, full = 24;
      const k = Math.max(0, Math.abs(deg) - dead) / (full - dead);
      // iOS reports gravity the other way round from Android.
      const sign = /iPhone|iPad|iPod/.test(navigator.userAgent) ? -1 : 1;
      this.tiltSteer = Math.max(-1, Math.min(1, Math.sign(deg) * k)) * -sign;
    };
  }

  // Tilt needs permission on iPhone, asked from the tap that picks it.
  async setSteerMode(mode) {
    if (mode === 'tilt') {
      try {
        const DM = window.DeviceMotionEvent;
        if (DM?.requestPermission && (await DM.requestPermission()) !== 'granted') return false;
      } catch { return false; }
      window.addEventListener('devicemotion', this._onMotion);
    } else window.removeEventListener('devicemotion', this._onMotion);
    this.steerMode = mode;
    this.tiltSteer = 0; this.dragSteer = 0;
    return true;
  }

  // Thumb pad for drag steering: put a thumb down anywhere on it and slide.
  bindDrag(el, knob) {
    let id = null, x0 = 0;
    const range = () => Math.max(50, el.clientWidth * 0.32);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); id = e.pointerId; x0 = e.clientX;
      try { el.setPointerCapture(id); } catch { /* ignore */ }
      if (knob) { knob.style.left = `${e.clientX - el.getBoundingClientRect().left}px`; knob.classList.add('on'); }
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const d = (e.clientX - x0) / range();
      this.dragSteer = -Math.max(-1, Math.min(1, d));
      if (knob) knob.style.transform = `translate(calc(-50% + ${Math.max(-1, Math.min(1, d)) * 40}px), -50%)`;
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; this.dragSteer = 0;
      if (knob) { knob.classList.remove('on'); knob.style.transform = ''; }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  }

  // Read the first controller: analogue driving values, plus one-shot
  // 'pad' events for buttons (pressed this frame).
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) { this.pad = null; return; }
    const b = (i) => gp.buttons[i] ? gp.buttons[i].value : 0;
    const pressed = (i) => !!gp.buttons[i]?.pressed;
    const dz = (v, d = 0.12) => (Math.abs(v) < d ? 0 : Math.sign(v) * Math.pow((Math.abs(v) - d) / (1 - d), 1.35));
    const x = dz(gp.axes[0] || 0), y = dz(gp.axes[1] || 0, 0.4);
    const used = Math.abs(x) > 0 || b(6) > 0.05 || b(7) > 0.05 || gp.buttons.some((bt) => bt.pressed);
    if (used || this.pad) {
      this.pad = {
        steer: -x,
        throttle: b(7),
        brake: b(6),
        handbrake: pressed(0) || pressed(2),
      };
    }
    // Button edges -> events. Names follow the standard layout.
    const NAMES = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 8: 'back', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
    for (const [i, name] of Object.entries(NAMES)) {
      const now = pressed(+i);
      if (now && !this._padPrev[i]) this.emit('pad', name);
      this._padPrev[i] = now;
    }
    // The stick also flicks through menus.
    const ax = Math.abs(x) > 0.6 ? Math.sign(x) : 0, ay = Math.abs(y) > 0.6 ? Math.sign(y) : 0;
    if (ay && ay !== this._padAxisPrev.y) this.emit('pad', ay < 0 ? 'up' : 'down', true);
    if (ax && ax !== this._padAxisPrev.x) this.emit('pad', ax < 0 ? 'left' : 'right', true);
    this._padAxisPrev = { x: ax, y: ay };
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, ...args) { (this.listeners[name] || []).forEach((fn) => fn(...args)); }

  // Wire on-screen buttons. Each element has data-ctl="throttle|brake|left|right|handbrake".
  bindTouch(root) {
    root.querySelectorAll('[data-ctl]').forEach((el) => {
      const ctl = el.dataset.ctl;
      const set = (v) => { this.touch[ctl] = v; el.classList.toggle('on', v); };
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ } set(true); });
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
    if (navigator.getGamepads) this.pollPad();     // fresh stick/trigger values every physics step
    const t = this.touch, on = this.enabled, p = on ? this.pad : null;
    const thr = on && (this.any(KEYS.throttle) || t.throttle);
    const brk = on && (this.any(KEYS.brake) || t.brake);
    const l = on && (this.any(KEYS.left) || t.left);
    const r = on && (this.any(KEYS.right) || t.right);
    // Pedals ramp quickly but not instantly: a short tap gives a short pulse.
    this._throttle += ((thr ? 1 : 0) - this._throttle) * Math.min(1, dt * 14);
    this._brake += ((brk ? 1 : 0) - this._brake) * Math.min(1, dt * 18);
    const s = this.state;
    // Analogue triggers take over from keys when pressed further.
    s.throttle = Math.max(this._throttle < 0.02 ? 0 : this._throttle, p ? p.throttle : 0);
    s.brake = Math.max(this._brake < 0.02 ? 0 : this._brake, p ? p.brake : 0);
    // Steering: keys and buttons, else the stick, tilt or thumb pad.
    let steer = (l ? 1 : 0) - (r ? 1 : 0);   // physics smooths steering itself
    if (!steer && on) {
      if (p && p.steer) steer = p.steer;
      else if (this.steerMode === 'tilt') steer = this.tiltSteer;
      else if (this.steerMode === 'drag') steer = this.dragSteer;
    }
    s.steer = steer;
    s.handbrake = on && (this.any(KEYS.handbrake) || t.handbrake || !!(p && p.handbrake));
    return s;
  }
}
