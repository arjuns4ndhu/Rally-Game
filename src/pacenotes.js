// Co-driver: pace notes worked out from the road and shown as on-screen
// signs (corner arrows with a severity number), DiRT Rally style.
//
// Corner scale (classic rally style): 6 = nearly flat, 1 = very slow,
// then "hairpin". Modifiers: long, tightens, opens, don't cut.

const GRADES = [[18, 'hairpin'], [28, '1'], [42, '2'], [60, '3'], [85, '4'], [115, '5'], [160, '6']];
const SPOKEN = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six' };

function grade(R) {
  for (const [r, g] of GRADES) if (R < r) return g;
  return null;
}

// Round a gap to a callable distance.
function callDistance(d) {
  if (d < 22) return 'into';
  if (d < 40) return null;              // short gap: just say the next note
  const steps = [50, 80, 100, 150, 200, 250, 300];
  for (const s of steps) if (d < s + 15) return String(s);
  return null;                          // long straight: no distance call
}

export function buildPaceNotes(road, { start = 0, finish = road.length } = {}) {
  const n = road.n, W = 5;
  const head = (i) => Math.atan2(road.tx[i], road.tz[i]);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  // Signed curvature (1/m, + = left) over a ~20 m window.
  const k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = road.idx(i - W), b = road.idx(i + W);
    const ds = (road.closed ? ((road.cum[b] - road.cum[a]) + road.length) % road.length : road.cum[b] - road.cum[a]) || 1;
    k[i] = wrap(head(b) - head(a)) / ds;
  }

  // Corners = runs of meaningful curvature in one direction.
  const items = [];
  let i = 0;
  while (i < n) {
    if (Math.abs(k[i]) < 1 / 160) { i++; continue; }
    const dir = Math.sign(k[i]);
    let s = i, e = i, minR = Infinity, apex = i;
    while (e < n && Math.sign(k[e]) === dir && Math.abs(k[e]) >= 1 / 200) {
      const R = 1 / Math.abs(k[e]);
      if (R < minR) { minR = R; apex = e; }
      e++;
    }
    const g = grade(minR);
    const len = road.cum[Math.min(e, n - 1)] - road.cum[s];
    if (g && len > 12) {
      const third = Math.max(1, Math.floor((e - s) / 3));
      const rIn = 1 / Math.max(1e-4, Math.abs(k[s + third]));
      const rOut = 1 / Math.max(1e-4, Math.abs(k[Math.max(s, e - third)]));
      const mods = [];
      if (len > 70 && g !== 'hairpin') mods.push('long');
      if (rOut < rIn * 0.7) mods.push('tightens');
      else if (rOut > rIn * 1.5) mods.push('opens');
      if (g === 'hairpin') mods.push("don't cut");
      const side = dir > 0 ? 'left' : 'right';
      const textWord = g === 'hairpin' ? `${side} hairpin` : `${side} ${g}`;
      const spokenWord = g === 'hairpin' ? `hairpin ${side}` : `${side} ${SPOKEN[g]}`;
      items.push({
        kind: 'corner', dir: dir > 0 ? 'left' : 'right', grade: g, mods,
        at: road.cum[s], end: road.cum[Math.min(e, n - 1)], apex: road.cum[apex],
        text: [textWord, ...mods].join(' '),
        say: [spokenWord, ...mods].join(', '),
      });
    }
    i = Math.max(e, i + 1);
  }

  // Jumps and crests.
  for (const b of road.bumps || []) {
    const at = b.kind === 'jump' ? b.at - (b.up || 20) : b.at - (b.len || 30) / 2;
    items.push({ kind: b.kind, mods: [], at, end: at + 10, text: b.kind === 'jump' ? 'jump!' : 'over crest', say: b.kind === 'jump' ? 'jump!' : 'over crest' });
  }
  if (!road.closed) items.push({ kind: 'finish', mods: [], at: finish - 60, end: finish, text: 'flat to finish', say: 'flat to finish' });

  items.sort((a, b) => a.at - b.at);
  // Distance to the next note becomes part of each call.
  const notes = items.filter((it) => it.at > start - 5);
  for (let j = 0; j < notes.length - 1; j++) {
    const gap = notes[j + 1].at - notes[j].end;
    const d = callDistance(gap);
    if (d) { notes[j].text += d === 'into' ? ' › into' : ` › ${d}`; notes[j].say += d === 'into' ? ', into' : `, ${d}`; }
    notes[j].dist = d;
    notes[j].linked = d === 'into';
  }
  return notes;
}

export class CoDriver {
  constructor(onNotes) {
    this.onNotes = onNotes;
    this.mode = 'signs';      // 'signs' | 'off'
    this.notes = [];
    this.next = 0;
  }

  load(notes) { this.notes = notes; this.next = 0; }

  // Skip notes that are already behind the car (after a respawn, say).
  seek(along) {
    this.next = 0;
    while (this.next < this.notes.length && this.notes[this.next].at < along + 5) this.next++;
  }

  stop() {}

  // Called every frame with the car's distance along the road and speed (m/s).
  update(along, speed) {
    if (this.mode === 'off' || this.next >= this.notes.length) return;
    // Faster = earlier calls (about 3 s of warning, 70-230 m).
    const lead = Math.max(70, Math.min(230, speed * 3 + 40));
    const n = this.notes[this.next];
    if (along < n.at - lead) return;
    // Notes joined by "into" are shown together, up to three.
    const list = [n];
    let j = this.next;
    while (this.notes[j].linked && j + 1 < this.notes.length && list.length < 3) list.push(this.notes[++j]);
    this.next = j + 1;
    this.onNotes?.(list);
  }
}
