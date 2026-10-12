// Stage themes: everything that changes how a stage looks and how hilly it
// is. Picked from the seed, so a given day always gets the same look.
import { mulberry32 } from './rng.js';

export const THEMES = {
  forest: {
    id: 'forest', label: 'Forest',
    sky: { top: '#2a3a5c', horizon: '#d9a877', fog: '#c79a72', fogDensity: 0.0062, sunGlow: [1.0, 0.75, 0.45] },
    light: { hemiSky: '#ffe6c4', hemiGround: '#5a5238', hemi: 1.6, sun: '#ffd7a3', sunI: 2.0, sunDir: [-0.6, 0.55, -0.75] },
    ground: { base: '#4a5726', dark: [40, 52, 22], light: [150, 140, 80], tintLow: [0.92, 0.95, 0.85], tintHigh: [1.1, 1.03, 0.75], rock: [0.55, 0.52, 0.48] },
    road: { base: '#b59c78', rut: [70, 55, 40], edge: [60, 70, 40], stone: [25, 10, -15], verge: 0x6e6340, grip: 1.0, dust: [0.74, 0.64, 0.5] },
    trees: [['pine', 1]], treeDensity: 1, rockDensity: 1, rockColor: [0.08, 0.12, 0.45],
    hills: 0x55603a, heightAmp: 1, hillAmp: 1, maxGrade: 0.12,
    names: ['Ridge', 'Forest', 'Woods', 'Heath', 'Pass'],
  },
  desert: {
    id: 'desert', label: 'Canyon',
    sky: { top: '#3b78c4', horizon: '#f4d6a6', fog: '#e9c99a', fogDensity: 0.0042, sunGlow: [1.0, 0.95, 0.8] },
    light: { hemiSky: '#fff3dc', hemiGround: '#9a6a40', hemi: 1.5, sun: '#fff1d6', sunI: 2.6, sunDir: [-0.3, 0.85, -0.4] },
    ground: { base: '#c98e55', dark: [150, 90, 50], light: [235, 190, 140], tintLow: [1.0, 0.95, 0.9], tintHigh: [1.08, 0.85, 0.7], rock: [0.7, 0.42, 0.3] },
    road: { base: '#d9a066', rut: [150, 90, 50], edge: [170, 110, 60], stone: [30, 15, -10], verge: 0xb07a48, grip: 0.97, dust: [0.86, 0.66, 0.45] },
    trees: [['cactus', 0.55], ['shrub', 0.45]], treeDensity: 0.35, rockDensity: 2.2, rockColor: [0.04, 0.45, 0.45],
    hills: 0xb56a3e, heightAmp: 1.3, hillAmp: 1.6, maxGrade: 0.12, mesas: true,
    names: ['Canyon', 'Mesa', 'Dunes', 'Gulch', 'Flats'],
  },
  snow: {
    id: 'snow', label: 'Snow',
    sky: { top: '#7f9cc0', horizon: '#e8eef5', fog: '#dfe7ef', fogDensity: 0.0075, sunGlow: [0.9, 0.95, 1.0] },
    light: { hemiSky: '#eef4ff', hemiGround: '#a8b4c2', hemi: 1.7, sun: '#fff8ee', sunI: 1.6, sunDir: [-0.7, 0.35, -0.6] },
    ground: { base: '#eef2f6', dark: [200, 210, 222], light: [255, 255, 255], tintLow: [0.95, 0.97, 1.0], tintHigh: [1.0, 1.0, 1.02], rock: [0.42, 0.44, 0.48] },
    road: { base: '#c9d2dc', rut: [120, 130, 145], edge: [235, 240, 245], stone: [-10, -5, 5], verge: 0xdfe6ee, grip: 0.86, dust: [0.95, 0.97, 1.0] },
    trees: [['snowpine', 1]], treeDensity: 1.1, rockDensity: 0.5, rockColor: [0.6, 0.05, 0.45],
    hills: 0xdce4ee, heightAmp: 1.1, hillAmp: 1.1, maxGrade: 0.11,
    names: ['Frost', 'Fjell', 'Glacier', 'Tundra', 'Drift'],
  },
  alpine: {
    id: 'alpine', label: 'Alpine',
    sky: { top: '#2f5f9e', horizon: '#c9dcea', fog: '#b9cad6', fogDensity: 0.0048, sunGlow: [1.0, 0.92, 0.8] },
    light: { hemiSky: '#f2f6ff', hemiGround: '#5e6650', hemi: 1.5, sun: '#fff0dc', sunI: 2.3, sunDir: [-0.5, 0.7, -0.5] },
    ground: { base: '#5d6b3a', dark: [50, 62, 30], light: [140, 150, 90], tintLow: [0.95, 1.0, 0.9], tintHigh: [1.05, 1.05, 1.05], rock: [0.5, 0.5, 0.52] },
    road: { base: '#a39f97', rut: [70, 68, 65], edge: [80, 90, 60], stone: [10, 10, 10], verge: 0x7b7a6c, grip: 1.0, dust: [0.7, 0.68, 0.64] },
    trees: [['pine', 0.8], ['shrub', 0.2]], treeDensity: 0.6, rockDensity: 2.0, rockColor: [0.6, 0.03, 0.5],
    hills: 0x8a8f96, heightAmp: 2.4, hillAmp: 2.4, maxGrade: 0.16, peaks: true,
    names: ['Col', 'Summit', 'Switchbacks', 'Pass', 'Climb'],
  },
  autumn: {
    id: 'autumn', label: 'Autumn',
    sky: { top: '#5a6470', horizon: '#b8b3a6', fog: '#a9a597', fogDensity: 0.0085, sunGlow: [0.8, 0.75, 0.65] },
    light: { hemiSky: '#e8e2d4', hemiGround: '#4a4232', hemi: 1.8, sun: '#f0dcc0', sunI: 1.2, sunDir: [-0.6, 0.6, -0.5] },
    ground: { base: '#5b5a2c', dark: [60, 50, 25], light: [160, 120, 60], tintLow: [0.95, 0.92, 0.85], tintHigh: [1.05, 0.95, 0.8], rock: [0.45, 0.43, 0.4] },
    road: { base: '#8c7458', rut: [55, 42, 30], edge: [60, 55, 30], stone: [15, 8, -5], verge: 0x5a4e34, grip: 0.93, dust: [0.55, 0.48, 0.38] },
    trees: [['broadleaf', 0.6], ['birch', 0.25], ['pine', 0.15]], treeDensity: 1.0, rockDensity: 0.8, rockColor: [0.08, 0.08, 0.4],
    hills: 0x5d5a3a, heightAmp: 1.1, hillAmp: 1.2, maxGrade: 0.12,
    names: ['Moor', 'Glen', 'Hollow', 'Vale', 'Woods'],
  },
};

const ORDER = ['forest', 'desert', 'snow', 'alpine', 'autumn'];

// Theme plus a per-stage hilliness multiplier, both from the seed.
export function pickTheme(seed) {
  const r = mulberry32(((seed * 48271) ^ 0x5bd1e995) >>> 0);
  const theme = THEMES[ORDER[Math.floor(r() * ORDER.length)]];
  const hilliness = 0.6 + r() * 1.0;        // 0.6 (flat and fast) .. 1.6 (big hills)
  return { theme, hilliness };
}
