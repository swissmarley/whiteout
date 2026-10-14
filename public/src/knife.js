// The fighting knife the support hand draws for a cut: a 16 cm clip-point blade with a sabre
// grind, a steel cross-guard, a swelled polymer grip and a steel pommel.
//
// Knife space: tip towards -z, edge down (-y), spine up, origin in the middle of the grip.
// Profiles are written like the rifle's, as `s` = distance towards the tip (z = -s).

import * as THREE from 'three';
import { surf, finish, merge, shade, spline, sweep, rbox, fillet, slab } from './mesh.js';

const COAT = surf(0x35373c, 0.5, 0.55, 0.45, 60, 0.6, 0xa3a6ac);    // phosphate-coated flats, worn bright at the corners
const EDGE = surf(0xd2d5da, 0.3, 0.72, 0.12, 60);                     // the ground bevel: satin, so it shows in poor light
const GUARD = surf(0x1b1c1f, 0.5, 0.75, 0.5, 42, 0.5, 0x8f9297);
const GRIP = surf(0x5c513d, 0.74, 0, 1, 70, 0.14, 0x8a7c62);          // the rifle's dark-earth polymer

// The blade as stations along its length: spine, where the grind starts, edge, half-thickness.
const S0 = 0.062, S1 = 0.224;
const SPINE = [[S0, 0.0152], [0.1, 0.0156], [0.152, 0.0152], [0.176, 0.0118], [0.198, 0.0064], [0.214, 0.0018], [S1, -0.0012]];
const BELLY = [[S0, -0.0138], [0.068, -0.0168], [0.1, -0.0172], [0.15, -0.0166], [0.18, -0.0138], [0.203, -0.0088], [0.217, -0.004], [S1, -0.0012]];
const THICK = [[S0, 0.0024], [0.14, 0.0023], [0.185, 0.0017], [0.212, 0.0009], [S1, 0.0001]];

function blade() {
  const N = 40, flats = [], bevels = [];
  // two triangles for a-b-c-d, wound so they face (nx, ny)
  const quad = (out, a, b, c, d, nx, ny) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const flip = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny < 0;
    for (const p of flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d]) out.push(p[0], p[1], p[2]);
  };
  let prev = null;
  for (let i = 0; i <= N; i++) {
    // stations bunch up towards the point, where the outline turns fastest
    const s = S0 + (S1 - S0) * (1 - Math.pow(1 - i / N, 1.6)), top = spline(s, SPINE), bot = spline(s, BELLY), t = spline(s, THICK);
    const grind = bot + (top - bot) * 0.46, z = -s;
    const cur = { sl: [-t, top, z], sr: [t, top, z], gl: [-t, grind, z], gr: [t, grind, z], e: [0, bot, z] };
    if (prev) {
      quad(flats, prev.sl, prev.sr, cur.sr, cur.sl, 0, 1);
      quad(flats, prev.sr, prev.gr, cur.gr, cur.sr, 1, 0); quad(flats, prev.sl, prev.gl, cur.gl, cur.sl, -1, 0);
      quad(bevels, prev.gr, prev.e, cur.e, cur.gr, 1, -0.3); quad(bevels, prev.gl, prev.e, cur.e, cur.gl, -1, -0.3);
    }
    prev = cur;
  }
  const geo = (list) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(list), 3)); return g; };
  // the coating is rubbed thinner towards the point, and a line of bare steel shows where the grind breaks through it
  return [shade(finish(geo(flats), COAT, 0.5), (x, y, z) => 1 + 0.5 * Math.max(0, (-z - 0.15) / 0.07)), finish(geo(bevels), EDGE, 0.5)];
}

export function buildKnife() {
  const out = blade();
  // ricasso and tang shoulder inside the guard, the guard itself with its two quillons
  out.push(finish(slab(fillet([[0.05, -0.0138], [S0 + 0.001, -0.0138], [S0 + 0.001, 0.0152], [0.05, 0.0152]], 0.0004), 0.0048, 0.0003), COAT));
  out.push(finish(slab(fillet([[0.0535, -0.0262, 0.003], [0.0595, -0.0276, 0.003], [0.0612, -0.017, 0.002], [0.0612, 0.0172, 0.002], [0.0595, 0.0226, 0.003], [0.0535, 0.0212, 0.003]], 0.001), 0.0136, 0.0022, { seg: 3 }), GUARD));
  // grip: oval, swelled in the middle, waisted behind the guard, flared at the butt, with five grooves for the fingers to bite
  const path = [], n = 44;
  for (let i = 0; i <= n; i++) {
    const s = 0.0535 - 0.105 * i / n, u = i / n;
    const swell = 1 + 0.1 * Math.sin(Math.min(1, u * 1.1) * Math.PI) - 0.07 * Math.exp(-u * u * 90) + 0.09 * Math.exp(-(1 - u) * (1 - u) * 60);
    const groove = u > 0.14 && u < 0.86 ? 0.045 * Math.pow(Math.max(0, Math.cos((u - 0.14) / 0.72 * Math.PI * 10)), 6) : 0;
    path.push({ p: [0, -0.0008 - 0.0016 * Math.sin(u * Math.PI), -s], a: 0.0112 * (swell - groove), b: 0.0152 * (swell - groove), b2: 0.0166 * (swell - groove), n: 2.5 });
  }
  out.push(finish(sweep(path, 18, { up: [0, 1, 0], domeA: 0.2, domeB: 0.15 }), GRIP, 1.1));
  // pommel cap with a flat for striking
  out.push(finish(rbox(0.0222, 0.0318, 0.011, 0.0048, 3).translate(0, -0.0012, 0.0572), GUARD));
  return merge(out);
}
