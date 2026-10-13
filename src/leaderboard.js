// Shared leaderboard, kept in the artifact's database when the game runs on
// claude.ai (elsewhere it stays off and the game works as before).
// One document per player, scores/<their id>:
//   { nick: "Racing name", best: { "s<seed>": { t, car, at } } }
// Everyone can read every document; each player writes only their own.
// Everything read back is other people's input: validated and shown as text.

const NICK_KEY = 'sideways.nick';
const clean = (s) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16);

export class Leaderboard {
  constructor() {
    this.db = null;
    this.uid = null;
    this.rows = [];
    this.mine = null;
    this.ready = false;
    this.denied = false;            // a write was refused (view-only access)
    this.listeners = [];
    this.queue = Promise.resolve();
    try { this.nick = clean(localStorage.getItem(NICK_KEY)); } catch { this.nick = ''; }
  }

  on(fn) { this.listeners.push(fn); }
  emit() { this.listeners.forEach((fn) => fn()); }
  get available() { return !!(this.db && this.uid); }
  get canPost() { return this.available && !this.denied; }

  async init() {
    const c = window.claude;
    if (!c?.use) return;
    const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
    if (!db || !user) return;
    const uid = await user.id();
    if (!uid) return;
    this.db = db; this.uid = uid;
    db.collection('scores').limit(1000).onSnapshot((snap) => {
      this.rows = [];
      for (const d of snap.docs) {
        const v = d.data() || {};
        const best = {};
        for (const [k, e] of Object.entries(v.best || {})) {
          const t = Number(e?.t);
          if (/^s\d{1,10}$/.test(k) && t > 5 && t < 3600) best[k] = { t, car: clean(e.car), at: Number(e.at) || 0 };
        }
        this.rows.push({ id: d.id, nick: clean(v.nick) || 'Driver', best });
      }
      this.mine = this.rows.find((r) => r.id === this.uid) || null;
      if (this.mine && !this.nick) this.nick = this.mine.nick;
      this.ready = true;
      this.emit();
    }, () => { this.ready = false; this.emit(); });
  }

  // Top n for a stage: [{ id, nick, t, car, me }]
  top(seed, n = 5) {
    const k = `s${seed}`;
    return this.rows.filter((r) => r.best[k]).map((r) => ({ id: r.id, nick: r.nick, ...r.best[k], me: r.id === this.uid }))
      .sort((a, b) => a.t - b.t).slice(0, n);
  }
  rank(seed) {
    const k = `s${seed}`;
    const all = this.rows.filter((r) => r.best[k]).sort((a, b) => a.best[k].t - b.best[k].t);
    const i = all.findIndex((r) => r.id === this.uid);
    return i < 0 ? null : { pos: i + 1, of: all.length };
  }

  // Serialize writes: one at a time to our one document.
  _write(fn) {
    this.queue = this.queue.then(fn).catch((e) => {
      if (e?.code === 'invalid_argument' || e?.code === 'not_granted') { this.denied = true; this.emit(); }
    });
    return this.queue;
  }

  // Post a time if it beats what we have on the board.
  submit(seed, t, car) {
    if (!this.canPost || !this.nick) return;
    const k = `s${seed}`, prev = this.mine?.best?.[k];
    if (prev && prev.t <= t) return;
    const entry = { t: Math.round(t * 1000) / 1000, car: clean(car), at: Date.now() };
    return this._write(() => (this.mine
      ? this.db.doc(`scores/${this.uid}`).update({ nick: this.nick, best: { [k]: entry } })
      : this.db.doc(`scores/${this.uid}`).set({ nick: this.nick, best: { [k]: entry } })));
  }

  // Choose a racing name; also posts every best already saved on this device.
  setNick(name, localBests) {
    const nick = clean(name);
    if (!nick) return;
    this.nick = nick;
    try { localStorage.setItem(NICK_KEY, nick); } catch { /* ignore */ }
    if (!this.canPost) return;
    const best = { ...(this.mine?.best || {}) };
    for (const [seed, b] of Object.entries(localBests || {})) {
      const k = `s${seed}`;
      if (!best[k] || b.time < best[k].t) best[k] = { t: Math.round(b.time * 1000) / 1000, car: clean(b.car), at: b.date || Date.now() };
    }
    return this._write(() => this.db.doc(`scores/${this.uid}`).set({ nick, best }));
  }
}
