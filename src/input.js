// Keyboard + touch input, merged into one analog-ish control state.

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
