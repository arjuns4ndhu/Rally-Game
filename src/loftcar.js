// Car bodies lofted from cross-sections along the car, for shapes an
// extruded side profile can't make: narrow cabins on wide haunches,
// fender humps above a low bonnet, wraparound screens, tapered noses.
// Each car is a set of curves over z (metres, +z forward, 0 = mid-car).
import * as THREE from 'three';

const lerp = (a, b, t) => a + (b - a) * t;

// Piecewise-linear curve through [z, value] keys (sorted by z).
function curve(keys) {
  return (z) => {
    if (z <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (z <= keys[i][0]) {
        const [z0, v0] = keys[i - 1], [z1, v1] = keys[i];
        return lerp(v0, v1, (z - z0) / ((z1 - z0) || 1));
      }
    }
    return keys[keys.length - 1][1];
  };
}
const inRange = (z, [a, b]) => z >= a && z <= b;

// Real-car references are only for proportions; liveries are generic stripes
// (no names, badges or sponsor marks).
export const LOFTS = {
  // 70s mid-engined wedge: 3.71 m long, 1.75 m wide, 1.11 m tall.
  stratos: {
    length: 3.71,
    bottom: [[-1.855, 0.34], [-1.6, 0.24], [1.5, 0.22], [1.855, 0.27]],
    halfWidth: [[-1.855, 0.8], [-1.72, 0.86], [-1.0, 0.88], [-0.45, 0.865], [0.2, 0.835], [0.8, 0.85], [1.18, 0.86], [1.55, 0.82], [1.75, 0.72], [1.855, 0.56]],
    belt: [[-1.855, 0.9], [-1.79, 0.9], [-1.62, 0.85], [-1.0, 0.87], [-0.6, 0.83], [-0.25, 0.77], [0.5, 0.76], [0.95, 0.79], [1.3, 0.78], [1.6, 0.7], [1.78, 0.6], [1.855, 0.5]],
    top: [[-1.855, 0.95], [-1.8, 0.94], [-1.66, 0.865], [-1.5, 0.86], [-0.8, 0.89], [-0.74, 0.98], [-0.64, 1.09], [-0.55, 1.11], [-0.05, 1.115], [0.2, 1.03], [0.5, 0.85], [0.77, 0.73], [1.0, 0.74], [1.2, 0.74], [1.42, 0.69], [1.6, 0.58], [1.78, 0.49], [1.855, 0.44]],   // bonnet domed over the front wells
    cabinWidth: [[-1.855, 0.5], [-0.8, 0.56], [-0.72, 0.6], [-0.55, 0.62], [-0.05, 0.64], [0.5, 0.72], [0.77, 0.76], [0.87, 0.56], [1.855, 0.32]],
    cabin: [[-0.8, 0], [-0.72, 1], [0.77, 1], [0.85, 0]],
    // (the top and belt keys at the very back form the ducktail lip)
    glass: { screen: [-0.05, 0.79], side: [-0.55, -0.05], rear: [-0.74, -0.55] },
    worksPaint: '#f1ede2',              // white base
    accents: [0x1d7f3f, 0xd0282c],      // green, red
    // Livery: a green band with a red pinstripe sweeping up the side from
    // the front wheel to the roof, a chevron on the bonnet, a green roof and
    // stripes along the louvred engine cover.
    livery(part, x, y, z) {
      const ax = Math.abs(x);
      if (part === 'side') {
        const L = 0.34 + (1.3 - z) * 0.3;
        if (z < -0.62) return null;
        if (y > L - 0.2 && y < L) return 1;
        if (y >= L && y < L + 0.05) return 2;
        return null;
      }
      if (part === 'top') {
        if (z > 0.86) {
          const d = ax - (z - 0.86) * 0.62;
          if (d < -0.07) return 1;
          if (d < 0.0) return 2;
          return null;
        }
        if (z > -0.6 && z < -0.02) return 1;
        if (z < -0.8) return ax < 0.18 ? null : ax < 0.36 ? 1 : ax < 0.46 ? 2 : null;
      }
      return null;
    },
  },
  // 60s mini: 3.05 m long, 1.41 m wide, 1.35 m tall, wheels right out at
  // the corners, tall glasshouse, flat bonnet and boot.
  mini: {
    length: 3.05,
    zRange: [-1.71, 1.34],
    bottom: [[-1.71, 0.34], [-1.6, 0.24], [1.2, 0.22], [1.34, 0.32]],
    halfWidth: [[-1.71, 0.62], [-1.64, 0.68], [-1.5, 0.7], [1.1, 0.705], [1.26, 0.68], [1.34, 0.62]],
    belt: [[-1.71, 0.8], [-1.62, 0.85], [-1.45, 0.87], [0.5, 0.88], [0.7, 0.87], [1.2, 0.81], [1.34, 0.76]],
    top: [[-1.71, 0.82], [-1.55, 0.86], [-1.46, 0.89], [-1.34, 1.29], [-1.22, 1.33], [-0.4, 1.345], [0.15, 1.33], [0.27, 1.29], [0.6, 0.91], [0.68, 0.89], [1.2, 0.83], [1.34, 0.77]],
    cabinWidth: [[-1.71, 0.52], [-1.52, 0.6], [-1.44, 0.665], [0.6, 0.665], [0.7, 0.6], [1.34, 0.5]],
    cabin: [[-1.52, 0], [-1.44, 1], [0.62, 1], [0.7, 0]],
    glass: { screen: [0.26, 0.64], side: [-1.32, 0.26], rear: [-1.46, -1.32], pillars: [[-0.38, 0.1], [-1.27, 0.14]] },
    defaultSkin: 'rally',
    skins: {
      // Works rally car: contrast roof, white door panels for the numbers.
      rally: {
        name: 'Rally', paint: '#c4161c', accents: [0xf1ede2],
        livery(part, x, y, z) {
          if (part === 'top' && z > -1.32 && z < 0.27) return 1;
          if (part === 'side' && z > -0.3 && z < 0.28 && y > 0.42 && y < 0.8) return 1;
          return null;
        },
      },
      // Lime green with a black bonnet and white roof... and an armchair strapped on top.
      armchair: {
        name: 'Armchair', paint: '#a3c13a', accents: [0x17181b, 0xf1ede2],
        livery(part, x, y, z) {
          if (part !== 'top') return null;
          if (z > 0.68) return 1;                       // black bonnet
          if (z > -1.32 && z < 0.27) return 2;          // white roof
          return null;
        },
      },
    },
  },
  // 80s short-wheelbase turbo coupe, Evo 2 spec: boxy, flared, a deep chin
  // splitter, steep screen, and a huge wing over the tail.
  quattro: {
    length: 4.35,
    zRange: [-2.25, 2.1],
    bottom: [[-2.25, 0.36], [-2.0, 0.24], [1.7, 0.2], [2.1, 0.13]],
    halfWidth: [[-2.25, 0.86], [-2.05, 0.92], [-1.52, 0.935], [-0.9, 0.9], [0.0, 0.87], [0.6, 0.9], [1.0, 0.935], [1.6, 0.93], [2.0, 0.91], [2.1, 0.88]],
    belt: [[-2.25, 0.95], [-1.8, 0.98], [-1.0, 0.96], [0.0, 0.92], [0.9, 0.93], [1.5, 0.91], [1.92, 0.87], [2.04, 0.68], [2.1, 0.42]],
    top: [[-2.25, 0.97], [-2.0, 1.0], [-1.4, 1.03], [-1.3, 1.08], [-0.78, 1.33], [0.1, 1.34], [0.25, 1.3], [0.76, 0.96], [1.5, 0.92], [1.92, 0.88], [2.04, 0.7], [2.1, 0.44]],
    cabinWidth: [[-2.25, 0.7], [-1.45, 0.72], [-1.3, 0.74], [0.75, 0.76], [0.85, 0.7], [2.1, 0.6]],
    cabin: [[-1.42, 0], [-1.32, 1], [0.76, 1], [0.84, 0]],
    glass: { screen: [0.25, 0.78], side: [-0.8, 0.25], rear: [-1.34, -0.8], pillars: [[-0.3, 0.1]] },
    worksPaint: '#f1ede2',                         // white base
    accents: [0xf2c21b, 0xe8622a, 0x7a3a24],       // yellow, orange, brown
    // White over yellow, split by orange and brown pinstripes that kick up
    // over the rear arch; brown and orange stripes on the bonnet.
    livery(part, x, y, z) {
      const ax = Math.abs(x);
      if (part === 'side') {
        const L = 0.62 + (z < -0.9 ? Math.min(0.2, (-0.9 - z) * 0.35) : 0);
        if (y < L) return 1;
        if (y < L + 0.035) return 2;
        if (y < L + 0.065) return 3;
        return null;
      }
      if (part === 'top' && z > 0.9 && z < 1.9) {
        if (ax > 0.5 && ax < 0.62) return 3;
        if (ax >= 0.62 && ax < 0.7) return 2;
      }
      return null;
    },
  },
  // 00s world-rally three-door hatch: 4.15 m, raked screen, tall tail lamps
  // up the rear pillars, wing on the hatch.
  focus: {
    length: 4.15,
    zRange: [-2.12, 2.03],
    bottom: [[-2.12, 0.4], [-1.95, 0.26], [1.8, 0.24], [2.03, 0.3]],
    halfWidth: [[-2.12, 0.78], [-2.0, 0.86], [-1.37, 0.885], [-0.6, 0.87], [0.4, 0.87], [1.25, 0.885], [1.75, 0.85], [1.95, 0.78], [2.03, 0.68]],
    belt: [[-2.12, 1.0], [-1.9, 1.04], [-1.0, 1.0], [0.0, 0.95], [0.7, 0.92], [1.2, 0.88], [1.7, 0.8], [1.95, 0.72], [2.03, 0.62]],
    top: [[-2.12, 1.02], [-2.06, 1.17], [-1.95, 1.33], [-1.8, 1.38], [-0.8, 1.43], [0.0, 1.44], [0.15, 1.42], [0.5, 1.28], [0.95, 0.98], [1.5, 0.88], [1.9, 0.78], [2.03, 0.66]],
    cabinWidth: [[-2.12, 0.72], [-1.95, 0.74], [-1.85, 0.76], [0.9, 0.78], [1.0, 0.72], [2.03, 0.6]],
    cabin: [[-2.07, 0], [-2.0, 1], [0.92, 1], [1.0, 0]],
    glass: { screen: [0.15, 0.95], side: [-1.45, 0.15], rear: [-2.08, -1.85], pillars: [[-0.55, 0.09]] },
    worksPaint: '#f1ede2',                         // white base
    accents: [0x1b2f7a, 0xf06a1c, 0x3fa9e0],       // dark blue, orange, light blue
    rearCap: 'a1',
    // White front, dark blue rear, split by an orange swoosh edged in light
    // blue that climbs from the front wheel to the rear of the roof.
    livery(part, x, y, z) {
      const ax = Math.abs(x);
      if (part === 'side') {
        const S = Math.min(1.05, 0.3 + (1.25 - z) * 0.3);
        const d = y - S;
        if (Math.abs(d) < 0.04) return 2;
        if (Math.abs(d) < 0.065) return 3;
        if (d < 0 || z < -1.75) return 1;
        return null;
      }
      if (part === 'top' && z > 1.0 && z < 1.85) {
        if (ax > 0.28 && ax < 0.34) return 2;
        if (ax >= 0.34 && ax < 0.38) return 3;
      }
      return null;
    },
  },
  // Rally-raid SUV: 4.7 m, raised on big tyres, fender humps either side of
  // the bonnet, a steep tailgate.
  dakar: {
    length: 4.7,
    zRange: [-2.38, 2.32],
    bottom: [[-2.38, 0.62], [-2.2, 0.48], [2.1, 0.46], [2.32, 0.6]],
    halfWidth: [[-2.38, 0.86], [-2.25, 0.93], [-1.45, 0.965], [0.0, 0.95], [1.4, 0.965], [2.0, 0.93], [2.25, 0.86], [2.32, 0.78]],
    belt: [[-2.38, 1.12], [-2.2, 1.16], [-1.0, 1.17], [0.6, 1.14], [1.0, 1.13], [1.4, 1.12], [2.0, 1.05], [2.25, 0.96], [2.32, 0.86]],
    top: [[-2.38, 1.15], [-2.3, 1.4], [-2.18, 1.62], [-2.0, 1.7], [-0.5, 1.73], [0.3, 1.71], [0.55, 1.64], [1.2, 1.17], [1.7, 1.08], [2.1, 1.0], [2.25, 0.93], [2.32, 0.84]],
    cabinWidth: [[-2.38, 0.78], [-2.2, 0.8], [-2.0, 0.82], [1.1, 0.84], [1.25, 0.76], [2.32, 0.6]],
    cabin: [[-2.3, 0], [-2.22, 1], [1.15, 1], [1.25, 0]],
    glass: { screen: [0.3, 1.2], side: [-1.75, 0.3], rear: [-2.3, -2.0], pillars: [[-0.5, 0.1], [-1.5, 0.14]] },
    worksPaint: '#e9e6df',                         // off-white base
    accents: [0x1a2a5a, 0xc9a04a, 0xc8252b],       // navy, gold, red
    rearCap: 'a1',
    // Navy below, white above, with a gold and red stripe along the waist
    // that dips toward the front bumper.
    livery(part, x, y, z) {
      if (part !== 'side') return null;
      const L = 0.97 - Math.max(0, z - 1.5) * 0.3;
      if (y < L) return 1;
      if (y < L + 0.05) return 2;
      if (y < L + 0.08) return 3;
      return null;
    },
  },
  // 80s Group B supercar-hatch: 4.0 m, huge flares, low nose full of lamps,
  // steep tailgate and a scoop on the roof.
  groupb: {
    length: 4.0,
    zRange: [-2.05, 1.95],
    bottom: [[-2.05, 0.36], [-1.9, 0.24], [1.7, 0.2], [1.95, 0.16]],
    halfWidth: [[-2.05, 0.86], [-1.9, 0.93], [-1.25, 0.94], [-0.6, 0.9], [0.3, 0.88], [1.15, 0.93], [1.7, 0.9], [1.95, 0.84]],
    belt: [[-2.05, 0.98], [-1.6, 1.0], [-0.8, 0.98], [0.4, 0.92], [1.15, 0.9], [1.6, 0.82], [1.85, 0.74], [1.95, 0.6]],
    // Roof ends at -1.62, then a big sloping hatch window down to the tail.
    top: [[-2.05, 1.0], [-2.0, 1.03], [-1.62, 1.33], [-1.5, 1.35], [0.0, 1.35], [0.2, 1.32], [0.75, 0.96], [1.3, 0.86], [1.8, 0.76], [1.95, 0.62]],
    cabinWidth: [[-2.05, 0.72], [-2.0, 0.74], [-1.62, 0.76], [0.7, 0.78], [0.8, 0.7], [1.95, 0.55]],
    cabin: [[-2.04, 0], [-1.99, 1], [0.73, 1], [0.8, 0]],
    glass: { screen: [0.2, 0.75], side: [-1.15, 0.2], rear: [-2.0, -1.62], pillars: [[-0.45, 0.1]] },
    worksPaint: '#f1ede2',                         // white base
    accents: [0x1c2a5c, 0x2f8fd0, 0xd2232a],       // dark blue, light blue, red
    // White with red, dark blue and light blue bands: flat along the tops of
    // the front wings, then sweeping steeply up the rear quarter to the roof.
    livery(part, x, y, z) {
      const ax = Math.abs(x);
      const band = (u) => (u < 0 ? null : u < 0.06 ? 2 : u < 0.12 ? 1 : u < 0.2 ? 3 : u < 0.26 ? 1 : u < 0.32 ? 2 : null);
      const quarter = () => band(-0.45 - (y - 0.45) / 0.85 - z);
      if (part === 'side') {
        if (z > 0.55) {
          const d = y - 0.8;
          return Math.abs(d) < 0.03 ? 3 : d >= 0.03 && d < 0.07 ? 1 : d >= 0.07 && d < 0.11 ? 2 : null;
        }
        if (z < -0.4) return quarter();
        return null;
      }
      if (part === 'top') {
        if (z > 0.8) {
          if (ax > 0.48 && ax < 0.55) return 3;
          if (ax >= 0.55 && ax < 0.62) return 1;
          if (ax >= 0.62 && ax < 0.68) return 2;
        }
        if (z < -1.0 && ax > 0.6) return quarter();      // up the roof pillar
      }
      return null;
    },
  },

};

// ---------- Styles ----------
// Each car's own livery above is its free "Works" style. These extra styles
// are unlocked by playing (see LOCKS.skins in menus.js). All are made-up
// colour schemes: no sponsors, names or badges. Each has its own paint and
// three accent colours (livery returns 1-3 for an accent, null for paint).
const EXTRA_SKINS = {
  stratos: {
    // Orange with a black sill and roof, a white pinstripe and twin bonnet stripes.
    sunset: {
      name: 'Safari', paint: '#f27a1a', accents: [0x17181b, 0xf1ede2, 0x17181b],
      livery(part, x, y, z) {
        const ax = Math.abs(x);
        if (part === 'side') return y < 0.42 ? 1 : y < 0.46 ? 2 : null;
        if (part === 'top') {
          if (z > -0.6 && z < -0.02) return 1;
          if (z > 0.86 && ax > 0.1 && ax < 0.2) return 2;
        }
        return null;
      },
    },
    // Black with gold pinstripes and a gold bonnet chevron.
    gold: {
      name: 'Silhouette', paint: '#141518', accents: [0xc9a04a, 0x8a6d2b, 0xc9a04a],
      livery(part, x, y, z) {
        const ax = Math.abs(x);
        if (part === 'side') return y > 0.6 && y < 0.63 ? 1 : y > 0.66 && y < 0.675 ? 2 : null;
        if (part === 'top' && z > 0.86) { const d = ax - (z - 0.86) * 0.62; return d > -0.05 && d < 0 ? 1 : null; }
        return null;
      },
    },
  },
  mini: {
    // White with a chequered roof, black sills and twin red bonnet stripes.
    checkers: {
      name: 'Chequers', paint: '#f1ede2', accents: [0x17181b, 0xc4161c, 0x17181b],
      livery(part, x, y, z) {
        if (part === 'side') return y < 0.36 ? 1 : null;
        if (part === 'top') {
          if (z > -1.32 && z < 0.27) return (Math.floor(x / 0.17 + 10) + Math.floor(z / 0.17 + 20)) % 2 ? 1 : null;
          if (z > 0.68 && Math.abs(x) > 0.06 && Math.abs(x) < 0.16) return 2;
        }
        return null;
      },
    },
  },
  quattro: {
    // Ice white over pale blue, with a silver pinstripe.
    arctic: {
      name: 'Arctic', paint: '#eef2f6', accents: [0x7cc4e8, 0x9aa3ad, 0x2f6f99],
      livery(part, x, y, z) {
        if (part === 'side') return y < 0.55 ? 1 : y < 0.58 ? 2 : null;
        if (part === 'top' && z > 0.9 && z < 1.9 && Math.abs(x) > 0.55 && Math.abs(x) < 0.62) return 1;
        return null;
      },
    },
    // Deep red with a black lower body, a white pinstripe and a black bonnet.
    redline: {
      name: 'Hillclimb', paint: '#b5121b', accents: [0x17181b, 0xf1ede2, 0x17181b],
      livery(part, x, y, z) {
        if (part === 'side') return y < 0.5 ? 1 : y < 0.53 ? 2 : null;
        if (part === 'top' && z > 0.95 && z < 1.95) return 1;
        return null;
      },
    },
  },
  focus: {
    // Black with a lime swoosh edged in white.
    lime: {
      name: 'Gravel', paint: '#16181d', accents: [0x9fe01a, 0xf1ede2, 0x9fe01a],
      livery(part, x, y, z) {
        if (part === 'side') { const d = y - Math.min(1.05, 0.3 + (1.25 - z) * 0.3); return Math.abs(d) < 0.05 ? 1 : Math.abs(d) < 0.075 ? 2 : null; }
        if (part === 'top' && z > 1.0 && z < 1.85 && Math.abs(x) > 0.28 && Math.abs(x) < 0.36) return 1;
        return null;
      },
    },
    // Dark blue with a white roof and a red waist pinstripe.
    heritage: {
      name: 'Tarmac', paint: '#1b2f7a', accents: [0xf1ede2, 0xd2232a, 0xf1ede2],
      livery(part, x, y, z) {
        if (part === 'side') return y > 0.78 && y < 0.81 ? 2 : null;
        if (part === 'top' && z > -1.95 && z < 0.15) return 1;
        return null;
      },
    },
  },
  dakar: {
    // Sand with a brown lower body and a black waist stripe.
    dune: {
      name: 'Dune', paint: '#d9b77a', accents: [0x6b4a2b, 0x17181b, 0x6b4a2b],
      livery(part, x, y, z) {
        if (part !== 'side') return null;
        const L = 0.9 - Math.max(0, z - 1.5) * 0.3;
        return y < L ? 1 : y < L + 0.05 ? 2 : null;
      },
    },
    // Expedition orange with a black lower body and a white stripe.
    expedition: {
      name: 'Expedition', paint: '#e8622a', accents: [0x17181b, 0xf1ede2, 0x17181b],
      livery(part, x, y, z) {
        if (part === 'side') { const L = 0.78 - Math.max(0, z - 1.5) * 0.3; return y < L ? 1 : y < L + 0.04 ? 2 : null; }
        if (part === 'top' && z > 1.25 && Math.abs(x) < 0.12) return 1;
        return null;
      },
    },
  },
  groupb: {
    // Red with white and black bands in the works pattern.
    rosso: {
      name: 'Evo', paint: '#c4161c', accents: [0xf1ede2, 0x17181b, 0xf1ede2],
      livery: (part, x, y, z) => LOFTS.groupb.skins.works.livery(part, x, y, z),
    },
    // White with gold and green bands in the works pattern.
    oro: {
      name: 'Safari', paint: '#f1ede2', accents: [0x1d7f3f, 0xc9a04a, 0x1d7f3f],
      livery: (part, x, y, z) => LOFTS.groupb.skins.works.livery(part, x, y, z),
    },
  },
};
for (const [k, extra] of Object.entries(EXTRA_SKINS)) {
  const d = LOFTS[k];
  if (!d.skins) { d.skins = { works: { name: 'Works', paint: d.worksPaint, accents: d.accents, livery: d.livery } }; d.defaultSkin = 'works'; }
  Object.assign(d.skins, extra);
}
// Every car also gets a free "Plain" style: just the paint colour you pick,
// no stripes, accents or door numbers.
for (const d of Object.values(LOFTS)) {
  if (!d.skins) { d.skins = { works: { name: 'Works', paint: d.worksPaint, accents: d.accents, livery: d.livery } }; d.defaultSkin = 'works'; }
  const any = Object.values(d.skins)[0];
  // Trim in plain black so nothing but the paint has colour.
  d.skins.plain = { name: 'Plain', accents: any.accents.map(() => 0x17181b), livery: () => null };
}

// Points of one half cross-section at z, from the bottom centre out, up the
// side and over the top to the top centre. Always the same count, so rings
// join up. Over a wheel the bottom steps up into a real wheel well.
// Rows up each side (more rows = cleaner stripes).
const NS = 8;
const SEG = { under: 0, wellWall: 1, wellRoof: 2, rocker: 3, shoulder: 4 + NS, sill: 5 + NS, top0: 6 + NS };
function section(d, z, wells) {
  const hs = d.halfWidth(z), belt = d.belt(z), top = d.top(z), c = d.cabin(z), yb = d.bottom(z);
  const cw = Math.min(d.cabinWidth(z), hs - 0.06);
  let yw = yb;
  for (const w of wells.list) {
    const dz = z - w.z;
    if (Math.abs(dz) < w.r) yw = Math.max(yw, w.y + Math.sqrt(w.r * w.r - dz * dz));
  }
  const sideTop = belt - 0.07;
  const sideLow = Math.min(yw + 0.05, sideTop - 0.04);
  const mid = lerp(top + 0.03, belt + 0.03, c);
  return [
    [0, yb], [wells.xin, yb], [wells.xin, yw], [hs - 0.03, yw],
    ...Array.from({ length: NS + 1 }, (_, k) => [hs, lerp(sideLow, sideTop, k / NS)]),
    [hs - 0.05, belt], [cw, mid],
    [lerp(cw * 0.72, cw - 0.09, c), lerp(top + 0.012, top - 0.05, c)],
    [cw * lerp(0.36, 0.5, c), lerp(top + 0.004, top - 0.012, c)],
    [0, top],
  ];
}

// Builds { bodyMesh, glassMesh, curves } for a lofted car. `wells` gives the
// wheel centres (z), the arch radius and the inner face of the wells (x).
export function buildLoftBody(def, { paint, glass, dark, accents, livery = def.livery, wheelZ, wheelY, archR, wellX }) {
  const d = {
    bottom: curve(def.bottom), halfWidth: curve(def.halfWidth), belt: curve(def.belt), top: curve(def.top),
    cabinWidth: curve(def.cabinWidth), cabin: curve(def.cabin),
  };
  const wells = { list: wheelZ.map((z) => ({ z, y: wheelY, r: archR })), xin: wellX };
  // Body from tail to nose (wheels needn't be centred under it).
  const [zr, zf] = def.zRange || [-def.length / 2, def.length / 2];
  // Ring positions: every 8 cm, plus the arch edges so the wells are crisp.
  const zs = new Set();
  for (let z = zr; z < zf; z += 0.08) zs.add(+z.toFixed(4));
  zs.add(zf);
  for (const w of wells.list) for (const e of [-1, 1]) zs.add(+(w.z + e * w.r * 0.999).toFixed(4));
  // Window pillars: body-coloured strips through the side glass, with rings
  // at their edges so they come out crisp and flush with the glass.
  const pillars = def.glass.pillars || [];
  for (const [pz, w] of pillars) for (const e of [-1, 1]) zs.add(+(pz + e * w / 2).toFixed(4));
  const onPillar = (z) => pillars.some(([pz, w]) => Math.abs(z - pz) < w / 2);
  const rings = [...zs].sort((a, b) => a - b).map((z) => ({ z, pts: section(d, z, wells) }));

  // Triangles sorted by material.
  const buckets = { paint: [], dark: [], glass: [], a1: [], a2: [], a3: [] };
  const tri = (key, a, b, c, out) => {
    // Wind each triangle to face outwards (reference: away from the car's core).
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    const ref = out || [cx, cy - 0.55, 0];
    const flip = nx * ref[0] + ny * ref[1] + nz * ref[2] < 0;
    buckets[key].push(...a, ...(flip ? c : b), ...(flip ? b : c));
  };
  const partOf = (s) => (s <= SEG.wellRoof ? 'under' : s === SEG.rocker ? 'rocker' : s <= SEG.shoulder ? 'side' : 'top');
  for (let j = 0; j < rings.length - 1; j++) {
    const r0 = rings[j], r1 = rings[j + 1], zc = (r0.z + r1.z) / 2;
    const c = d.cabin(zc);
    const coreY = (d.bottom(zc) + d.belt(zc)) / 2;
    for (let s = 0; s < r0.pts.length - 1; s++) {
      for (const side of [1, -1]) {
        const A = [r0.pts[s][0] * side, r0.pts[s][1], r0.z], B = [r0.pts[s + 1][0] * side, r0.pts[s + 1][1], r0.z];
        const C = [r1.pts[s + 1][0] * side, r1.pts[s + 1][1], r1.z], D = [r1.pts[s][0] * side, r1.pts[s][1], r1.z];
        const xc = (A[0] + B[0] + C[0] + D[0]) / 4, yc = (A[1] + B[1] + C[1] + D[1]) / 4;
        const part = partOf(s);
        let key = 'paint';
        if (part === 'under') key = 'dark';
        // Screen and back window: everything above the side row (the side
        // row there is the A and C pillar). Side windows: the side row, less
        // the B/C pillars.
        // (Where the cabin blends into the bonnet or boot the side row stays
        // glass: that bit of surface is too twisted to show in paint.)
        else if (s >= SEG.top0 && c > 0.5 && (((inRange(zc, def.glass.screen) || inRange(zc, def.glass.rear)) && (s > SEG.top0 || c < 0.97)) ||
          (inRange(zc, def.glass.side) && s === SEG.top0 && !onPillar(zc)))) key = 'glass';
        // Scuttle: where the cabin folds down into the bonnet just ahead of
        // the screen the surface is badly twisted, so it gets the black
        // plastic panel real cars have there.
        if (key === 'paint' && s >= SEG.top0 && c > 0.02 && c <= 0.5 && zc > def.glass.screen[1] - 0.02 && zc < def.glass.screen[1] + 0.3) key = 'dark';
        // A-pillars: the windscreen's side strip, in black window-surround trim
        // (in paint its twisted facets look torn).
        if (key === 'paint' && s === SEG.top0 && c > 0.5 && inRange(zc, def.glass.screen)) key = 'dark';
        if (key === 'paint' && livery) {
          const acc = livery(part === 'rocker' ? 'side' : part, xc, yc, zc);
          if (acc) key = acc === 1 ? 'a1' : acc === 2 ? 'a2' : 'a3';
        }
        // Outwards = away from the body's core at this point (half way up
        // the side, middle of the car), so low noses and forward-sloping
        // panels face the right way too.
        const out = [xc, yc - coreY, zc * 0.5];
        tri(key, A, B, C, out);
        tri(key, A, C, D, out);
      }
    }
  }
  // End caps: fan from the middle of each end ring.
  for (const [ring, dir] of [[rings[0], -1], [rings[rings.length - 1], 1]]) {
    const right = ring.pts.map(([x, y]) => [x, y, ring.z]);
    const left = ring.pts.slice(1, -1).reverse().map(([x, y]) => [-x, y, ring.z]);
    const poly = [...right, ...left];
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const ctr = [0, cy, ring.z];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      tri((dir < 0 ? def.rearCap : def.frontCap) || 'paint', ctr, a, b, [0, 0, dir]);
    }
  }

  const make = (keys, mats) => {
    const all = [], groups = [];
    keys.forEach((k, i) => {
      const arr = buckets[k];
      if (!arr.length) return;
      groups.push([all.length / 3, arr.length / 3, i]);
      for (let q = 0; q < arr.length; q++) all.push(arr[q]);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));
    for (const [start, count, mi] of groups) geo.addGroup(start, count, mi);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mats);
  };
  const darkDS = dark.clone(); darkDS.side = THREE.DoubleSide;
  // Skins can have fewer than three accent colours: fill the gaps so every
  // material slot holds a real material.
  const acc = [0, 1, 2].map((i) => accents[i] || accents[0] || paint);
  const bodyMesh = make(['paint', 'dark', 'a1', 'a2', 'a3'], [paint, darkDS, ...acc]);
  const glassMesh = make(['glass'], [glass]);
  bodyMesh.castShadow = glassMesh.castShadow = true;
  return { bodyMesh, glassMesh, curves: d, extraMats: [darkDS] };
}
