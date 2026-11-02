// Pace-note signs: corner arrows that bend as far as the corner does, with
// the severity number, plus jump / crest / finish icons. Pure SVG strings.

const TURN = { 6: 25, 5: 40, 4: 60, 3: 85, 2: 110, 1: 135, hairpin: 180 };   // degrees

// Arrow path: up from the bottom, then an arc turning `deg` to one side.
function arrowSVG(dir, grade) {
  const deg = TURN[grade] ?? 60;
  const th = (deg * Math.PI) / 180;
  const s = dir === 'right' ? 1 : -1;
  const pts = [[0, 0], [0, -14]];
  let x = 0, y = -14, h = 0;                       // heading 0 = straight up
  const arcLen = grade === 'hairpin' ? 30 : 34;
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    h += (th / steps) * s;
    x += Math.sin(h) * (arcLen / steps);
    y -= Math.cos(h) * (arcLen / steps);
    pts.push([x, y]);
  }
  // Arrowhead along the final heading.
  const fx = Math.sin(h), fy = -Math.cos(h), px = -fy, py = fx;
  const tip = [x + fx * 9, y + fy * 9];
  const head = [[x + px * 8, y + py * 8], tip, [x - px * 8, y - py * 8]];
  // Fit everything into a 64x64 box with a margin.
  const all = [...pts, ...head];
  const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
  const k = Math.min(48 / (maxX - minX || 1), 48 / (maxY - minY || 1), 1.25);
  const ox = 32 - ((minX + maxX) / 2) * k, oy = 32 - ((minY + maxY) / 2) * k;
  const f = ([a, b]) => `${(a * k + ox).toFixed(1)},${(b * k + oy).toFixed(1)}`;
  return `<svg viewBox="0 0 64 64" aria-hidden="true">
    <polyline points="${pts.map(f).join(' ')}" class="pn-line"/>
    <polygon points="${head.map(f).join(' ')}" class="pn-head"/>
  </svg>`;
}

const ICONS = {
  jump: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M6 50 L28 50 L28 38 Z" class="pn-head"/>
    <path d="M30 34 Q42 10 58 30" class="pn-line" fill="none"/>
    <rect x="34" y="14" width="14" height="7" rx="2" class="pn-head" transform="rotate(12 41 17)"/>
    <line x1="4" y1="54" x2="60" y2="54" class="pn-line"/></svg>`,
  crest: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M4 48 Q32 14 60 48" class="pn-line" fill="none"/>
    <path d="M24 30 L32 20 L40 30" class="pn-line" fill="none"/></svg>`,
  ford: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M6 26 Q14 18 22 26 T38 26 T54 26" class="pn-line" fill="none"/>
    <path d="M6 40 Q14 32 22 40 T38 40 T54 40" class="pn-line" fill="none"/>
    <path d="M10 52 Q18 46 26 52 T42 52 T58 52" class="pn-line" fill="none"/></svg>`,
  tunnel: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M8 56 V30 Q8 10 32 10 Q56 10 56 30 V56" class="pn-line" fill="none"/>
    <path d="M20 56 V34 Q20 22 32 22 Q44 22 44 34 V56" class="pn-head"/></svg>`,
  finish: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <line x1="14" y1="58" x2="14" y2="8" class="pn-line"/>
    <path d="M16 10h10v8H16zM36 10h10v8H36zM26 18h10v8H26zM46 18h8v8h-8zM16 26h10v8H16zM36 26h10v8H36z" class="pn-head"/></svg>`,
};

const MOD_LABEL = { long: 'LONG', tightens: 'TIGHTENS', opens: 'OPENS', "don't cut": "DON'T CUT" };

function severity(n) {
  if (n.kind === 'jump' || n.kind === 'ford') return 'warn';
  if (n.kind !== 'corner') return 'calm';
  if (n.grade === 'hairpin' || n.grade === '1') return 'danger';
  if (n.grade === '2' || n.grade === '3') return 'warn';
  return 'calm';
}

function tile(n) {
  let icon, label;
  if (n.kind === 'corner') {
    icon = arrowSVG(n.dir, n.grade);
    label = n.grade === 'hairpin' ? 'HAIRPIN' : n.grade;
  } else {
    icon = ICONS[n.kind];
    label = { jump: 'JUMP', crest: 'CREST', ford: 'WATER', tunnel: 'TUNNEL' }[n.kind] || 'FINISH';
  }
  const mods = (n.mods || []).map((m) => `<small>${MOD_LABEL[m] || m.toUpperCase()}</small>`).join('');
  const isNum = n.kind === 'corner' && n.grade !== 'hairpin';
  return `<div class="pn-tile pn-${severity(n)}">${icon}<b class="${isNum ? 'num' : 'word'}">${label}</b>${mods}</div>`;
}

// HTML for a bundle of notes, with distance chips between / after them.
export function notesHTML(list) {
  return list.map((n, i) => {
    const d = n.dist;
    const chip = d ? `<span class="pn-dist">${d === 'into' ? 'INTO' : d}</span>` : '';
    return tile(n) + (i < list.length - 1 || d ? chip : '');
  }).join('');
}
