// HUD mini map: the whole stage from above (north up), the part you've
// driven highlighted, checkpoints, shortcuts, your car and the ghost. Long
// stages can be zoomed in instead (`zoom`: metres across the box), and the
// map then scrolls to keep your car in view.

const PAD = 10;

export class MiniMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bg = document.createElement('canvas');
    this.road = null;
    this.lastAlong = -1;
    this.acc = 0;
  }

  // Size the canvas for the display and pre-draw the static layer.
  build(road, { start = 0, finish = road.length, cps = [], shortcuts = [], closed = false, zoom = 0 } = {}) {
    this.args = [road, { start, finish, cps, shortcuts, closed, zoom }];
    this.road = road;
    this.opts = { start, finish, cps, closed };
    const css = this.canvas.clientWidth || 170;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(css * dpr);
    this.canvas.width = this.canvas.height = size;
    this.dpr = dpr;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < road.n; i++) {
      minX = Math.min(minX, road.px[i]); maxX = Math.max(maxX, road.px[i]);
      minZ = Math.min(minZ, road.pz[i]); maxZ = Math.max(maxZ, road.pz[i]);
    }
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    const inner = size - PAD * 2 * dpr;
    // Zoomed: the static layer covers the whole stage at the closer scale,
    // and draw() shows the part around the car.
    this.zoomed = zoom > 0 && zoom < span;
    this.s = inner / (this.zoomed ? zoom : span);
    const bw = this.zoomed ? Math.ceil((maxX - minX) * this.s + PAD * 2 * dpr) : size;
    const bh = this.zoomed ? Math.ceil((maxZ - minZ) * this.s + PAD * 2 * dpr) : size;
    this.bg.width = Math.max(bw, size); this.bg.height = Math.max(bh, size);
    this.ox = PAD * dpr + (this.bg.width - PAD * 2 * dpr - (maxX - minX) * this.s) / 2 - minX * this.s;
    this.oz = PAD * dpr + (this.bg.height - PAD * 2 * dpr - (maxZ - minZ) * this.s) / 2 - minZ * this.s;
    this.cx = this.cz = null;

    const g = this.bg.getContext('2d');
    g.clearRect(0, 0, this.bg.width, this.bg.height);
    g.lineCap = g.lineJoin = 'round';
    // Shortcuts: dashed green.
    g.setLineDash([3 * dpr, 3 * dpr]);
    g.strokeStyle = 'rgba(43, 212, 122, 0.9)';
    g.lineWidth = 2 * dpr;
    for (const sc of shortcuts) this._path(g, sc, 0, sc.n), g.stroke();
    g.setLineDash([]);
    // Road: dark casing, light core.
    g.strokeStyle = 'rgba(0, 0, 0, 0.55)'; g.lineWidth = 5 * dpr;
    this._path(g, road, 0, road.n, closed); g.stroke();
    g.strokeStyle = 'rgba(241, 233, 218, 0.55)'; g.lineWidth = 2.6 * dpr;
    this._path(g, road, 0, road.n, closed); g.stroke();
    // Checkpoints: ticks across the road.
    for (const a of cps.slice(0, -1)) this._tick(g, a, '#ffb000', 6);
    if (finish > start) {
      this._tick(g, start, '#2bd47a', 7);
      this._flag(g, finish);
    }
    this.lastAlong = -1;
  }

  // Redraw at the current display size (after showing the HUD or a resize).
  rebuild() { if (this.args) this.build(...this.args); }

  _xy(x, z) { return [this.ox + x * this.s, this.oz + z * this.s]; }

  _path(g, r, from, to, closed = false) {
    g.beginPath();
    for (let i = from; i < to; i++) {
      const [u, v] = this._xy(r.px[i], r.pz[i]);
      if (i === from) g.moveTo(u, v); else g.lineTo(u, v);
    }
    if (closed) g.closePath();
  }

  _tick(g, along, color, len) {
    const r = this.road, i = r.indexAt(along), d = this.dpr;
    const [u, v] = this._xy(r.px[i], r.pz[i]);
    const nx = r.tz[i], nz = -r.tx[i];
    g.strokeStyle = color; g.lineWidth = 2.4 * d;
    g.beginPath(); g.moveTo(u - nx * len * d, v - nz * len * d); g.lineTo(u + nx * len * d, v + nz * len * d); g.stroke();
  }

  _flag(g, along) {
    const r = this.road, i = r.indexAt(along), d = this.dpr;
    const [u, v] = this._xy(r.px[i], r.pz[i]);
    const s = 3 * d;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      g.fillStyle = (a + b) % 2 ? '#111' : '#f4f1e8';
      g.fillRect(u + (a - 1.5) * s, v + (b - 1.5) * s, s, s);
    }
  }

  // along: car's distance along the road (for the driven highlight).
  draw(car, along, ghost, dt) {
    if (!this.road) return;
    this.acc += dt;
    if (this.acc < 1 / 30) return;              // 30 Hz is plenty
    this.acc = 0;
    const g = this.ctx, d = this.dpr, W = this.canvas.width;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    if (this.zoomed) {
      // Follow the car (eased), keeping the view inside the map.
      const [cu, cv] = this._xy(car.x, car.z);
      const tx = Math.max(0, Math.min(this.bg.width - W, cu - W / 2)), tz = Math.max(0, Math.min(this.bg.height - W, cv - W / 2));
      const k = this.cx == null ? 1 : 0.35;
      this.cx = this.cx == null ? tx : this.cx + (tx - this.cx) * k;
      this.cz = this.cz == null ? tz : this.cz + (tz - this.cz) * k;
      g.translate(-this.cx, -this.cz);
    }
    g.drawImage(this.bg, 0, 0);
    // Driven so far, from the start line to the car.
    const { start, finish } = this.opts;
    if (finish > start && along > start) {
      const i0 = this.road.indexAt(start), i1 = this.road.indexAt(Math.min(along, finish));
      if (i1 > i0) {
        g.strokeStyle = '#ffb000'; g.lineWidth = 2.6 * d; g.lineCap = 'round'; g.lineJoin = 'round';
        this._path(g, this.road, i0, i1 + 1); g.stroke();
      }
    }
    // Ghost.
    if (ghost) {
      const [u, v] = this._xy(ghost.x, ghost.z);
      g.fillStyle = 'rgba(159, 227, 255, 0.95)';
      g.beginPath(); g.arc(u, v, 3.2 * d, 0, Math.PI * 2); g.fill();
    }
    // Car: an arrow pointing where it's facing.
    const [u, v] = this._xy(car.x, car.z);
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const L = 7 * d, Wd = 4.5 * d;
    g.fillStyle = '#ff5a2a'; g.strokeStyle = '#0b0d12'; g.lineWidth = 1.5 * d;
    g.beginPath();
    g.moveTo(u + fx * L, v + fz * L);
    g.lineTo(u - fx * L * 0.6 + fz * Wd, v - fz * L * 0.6 - fx * Wd);
    g.lineTo(u - fx * L * 0.3, v - fz * L * 0.3);
    g.lineTo(u - fx * L * 0.6 - fz * Wd, v - fz * L * 0.6 + fx * Wd);
    g.closePath(); g.fill(); g.stroke();
  }
}
