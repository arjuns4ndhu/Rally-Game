// Online races in private lobbies, over claude.ai's live rooms (everyone
// with the page open right now). A lobby is a named room joined by a short
// code. Everything travels as presence: each player keeps one small object
// current (name, car, where they are, how their race is going) and the
// host's also carries the race setup. No events, so no send permissions.
import * as THREE from 'three';
import { buildCarModel } from './carModel.js';
import { CARS } from './car.js';

const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
export const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
export const cleanCode = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
export const cleanNick = (s) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);

export class Net {
  constructor() {
    this.room = undefined;      // undefined: not asked yet; null: not available here
    this.lobby = null;
    this.peers = [];
    this.code = '';
    this.onChange = null;
  }

  async available() {
    if (this.room === undefined) {
      try { this.room = window.claude?.use ? await window.claude.use('room') : null; } catch { this.room = null; }
    }
    return !!this.room;
  }

  async join(code, presence) {
    await this.leave();
    this.lobby = await this.room.join(`race-${code}`);
    this.code = code;
    this.unsub = this.lobby.onPeers((ch) => { this.peers = ch.peers; this.onChange?.(ch); });
    this.peers = this.lobby.peers();
    await this.lobby.presence(presence);
  }

  set(patch) { this.lobby?.presence(patch).catch(() => {}); }

  async leave() {
    this.unsub?.(); this.unsub = null;
    const l = this.lobby; this.lobby = null; this.peers = []; this.code = '';
    if (l) await l.leave().catch(() => {});
  }

  get inLobby() { return !!this.lobby; }
  me() { return this.peers.find((p) => p.sameTab) || null; }
  others() { return this.peers.filter((p) => !p.sameTab && p.kind === 'viewer'); }
  // The host: whoever says so; if they've gone, the player with the lowest
  // peer label takes over (every page works that out the same way).
  hostPeer() {
    const players = this.peers.filter((p) => p.kind === 'viewer');
    return players.find((p) => p.presence?.host) || players.slice().sort((a, b) => (a.peer < b.peer ? -1 : 1))[0] || null;
  }
}

// What a player tells everyone, read defensively (it's another page's data).
export function readPlayer(p) {
  const s = p.presence || {};
  const pos = Array.isArray(s.p) && s.p.length === 6 && s.p.every(Number.isFinite) ? s.p : null;
  return {
    peer: p.peer, me: !!p.sameTab, nick: cleanNick(s.nick) || 'Driver',
    car: CARS[s.car] ? s.car : 'stiletto', color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#888888',
    st: ['lobby', 'loading', 'ready', 'racing', 'done', 'dnf'].includes(s.st) ? s.st : 'lobby',
    rid: typeof s.rid === 'string' ? s.rid.slice(0, 24) : '', pos, along: num(s.a), fin: Number.isFinite(s.fin) ? s.fin : null,
    host: !!s.host, setup: s.setup && typeof s.setup === 'object' ? s.setup : null, race: s.race && typeof s.race === 'object' ? s.race : null,
  };
}

// A race setup from the host, checked.
export function readRace(r) {
  if (!r || typeof r.id !== 'string' || !Number.isInteger(r.seed) || r.seed <= 0) return null;
  return { id: r.id.slice(0, 24), seed: r.seed, kind: String(r.kind || 'random').slice(0, 12), collisions: !!r.collisions, go: !!r.go };
}

// Other players' cars on the road: a car model each, moved smoothly between
// the positions they send, with their name floating above.
export class RemoteCars {
  constructor(scene) {
    this.scene = scene;
    this.cars = new Map();   // peer -> { model, car, color, samples: [{t, p}], tag, last }
  }

  _tag(text, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(11,13,18,0.75)'; g.fillRect(0, 8, 256, 48);
    g.fillStyle = color; g.fillRect(0, 8, 8, 48);
    g.fillStyle = '#f1e9da'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 132, 33);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    s.scale.set(2.6, 0.65, 1); s.renderOrder = 10;
    return s;
  }

  // players: readPlayer() results for everyone else in this race.
  update(players, now) {
    const seen = new Set();
    for (const pl of players) {
      if (!pl.pos) continue;
      seen.add(pl.peer);
      let rc = this.cars.get(pl.peer);
      if (!rc || rc.car !== pl.car || rc.color !== pl.color || rc.nick !== pl.nick) {
        if (rc) this._remove(pl.peer);
        const model = buildCarModel(CARS[pl.car], { color: pl.color, number: 1 + (this.cars.size % 9) });
        model.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        const tag = this._tag(pl.nick, pl.color);
        model.root.add(tag); tag.position.set(0, 2.3, 0);
        this.scene.add(model.root);
        rc = { model, car: pl.car, color: pl.color, nick: pl.nick, samples: [], tag, last: null, vx: 0, vz: 0 };
        this.cars.set(pl.peer, rc);
      }
      if (rc.last !== pl.pos) {         // a new position arrived
        rc.last = pl.pos;
        rc.samples.push({ t: now, p: pl.pos });
        if (rc.samples.length > 12) rc.samples.shift();
      }
    }
    for (const peer of [...this.cars.keys()]) if (!seen.has(peer)) this._remove(peer);
  }

  // Place every car where it was ~120 ms ago (between two received
  // positions), so movement is smooth. Returns poses for collisions.
  render(now, dt) {
    const out = [];
    const tView = now - 120;
    for (const rc of this.cars.values()) {
      const S = rc.samples;
      if (!S.length) continue;
      let a = S[0], b = S[0];
      for (let k = 0; k < S.length - 1; k++) if (S[k].t <= tView && S[k + 1].t >= tView) { a = S[k]; b = S[k + 1]; break; }
      if (tView > S[S.length - 1].t) a = b = S[S.length - 1];
      const u = b.t > a.t ? (tView - a.t) / (b.t - a.t) : 1;
      const L = (i) => a.p[i] + (b.p[i] - a.p[i]) * u;
      const dy = Math.atan2(Math.sin(b.p[3] - a.p[3]), Math.cos(b.p[3] - a.p[3]));
      const x = L(0), y = L(1), z = L(2), yaw = a.p[3] + dy * u;
      const r = rc.model.root;
      if (dt > 0) { const k = Math.min(1, dt * 8); rc.vx += (((x - r.position.x) / dt) - rc.vx) * k; rc.vz += (((z - r.position.z) / dt) - rc.vz) * k; }
      if (Math.hypot(x - r.position.x, z - r.position.z) > 30) { rc.vx = rc.vz = 0; }
      r.position.set(x, y, z);
      r.rotation.order = 'YXZ';
      r.rotation.set(-Math.atan(L(4)), yaw, L(5));
      // Wheels turn with the speed.
      const sp = Math.hypot(rc.vx, rc.vz);
      for (const w of rc.model.wheels || []) w.spin.rotation.x += sp * dt / 0.32;
      out.push({ x, z, vx: rc.vx, vz: rc.vz, yaw });
    }
    return out;
  }

  _remove(peer) {
    const rc = this.cars.get(peer);
    if (!rc) return;
    this.scene.remove(rc.model.root);
    rc.tag.material.map.dispose(); rc.tag.material.dispose();
    rc.model.dispose();
    this.cars.delete(peer);
  }

  clear() { for (const peer of [...this.cars.keys()]) this._remove(peer); }
}
