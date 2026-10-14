// First-person arms: gloved hands posed on the rifle, and the sleeves of a winter shell jacket
// running back from a cinched cuff, over the forearm and round the elbow towards the shoulder.
// Fingers are straight bones with a bend at each joint, so the grip reads as a hand rather
// than a mitten; the support hand is wrapped round the handguard by supportGrip(), wears a
// watch on the inside of the wrist, and works the reload and the knife through SupportArm.
// All coordinates are in gun space (+x right, +y up, -z down the bore) unless they say otherwise.

import * as THREE from 'three';
import { surf, finish, merge, shade, sweep, rbox, spline, jointed } from './mesh.js';
import { RIFLE } from './rifle.js';
import { KNIFE } from '../shared/constants.js';

const KNIT = surf(0x33363b, 0.92, 0, 1, 80);         // glove back and cuff
const LEATHER = surf(0x565a60, 0.6, 0, 0.5, 55);     // palm and fingers
const PAD = surf(0x3f4247, 0.5, 0, 0.35, 55);        // reinforced heel of the palm
const TPR = surf(0x0e0e10, 0.42, 0, 0.1, 40);        // moulded knuckle guard, closure tabs
const GUARD = surf(0x131416, 0.6, 0, 0.3, 40);       // moulded pads over the knuckles and fingers
const STRAP = surf(0x18191c, 0.82, 0, 1, 70);
const SHELL = surf(0x304a6c, 0.7, 0, 0.9, 60);       // jacket shell
const SEAM = surf(0x283e5c, 0.8, 0, 0.9, 60);
const RESIN = surf(0x1d2023, 0.46, 0.1, 0.3, 40, 0.5, 0x6a6e74);    // watch case
const BEZEL = surf(0x7d8187, 0.32, 1, 0.2, 40);
const GLASS = surf(0x10272c, 0.08, 0, 0, 40);
const LCD = surf(0x56695a, 0.16, 0, 0, 40);
const HEM = surf(0x1b2536, 0.86, 0, 1, 80);          // cuff binding and adjuster

const HG = { y: RIFLE.boreY, r: 0.0212 };            // the handguard as a tube round the bore

const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const unit = (p) => V(p).normalize();
const arr = (v) => [v.x, v.y, v.z];
const dot = (a, v) => a[0] * v.x + a[1] * v.y + a[2] * v.z;
const pw = (v, e) => (v < 0 ? -Math.pow(-v, e) : Math.pow(v, e));
const crease = (x) => 2 * Math.pow(Math.abs(Math.sin(x)), 0.65) - 1;   // broad ridges, sharp valleys
const ramp = (x, lo, hi) => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
const bezier = (a, b, c, t) => a.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(b, 2 * t * (1 - t)).addScaledVector(c, t * t);

// One finger or thumb through its joints; radii: one per joint. Not a tube: flatter across the
// back than underneath, swollen over each knuckle and creased under it, a pad under every bone
// and a fuller one under the tip, narrowing to the nail. The back is the glove's stretch
// fabric, darker than the leather of the pads and wrapped by it at the tip.
function digit(joints, radii, up, s) {
  const last = joints.length - 1;
  const part = (q, th) => {
    const sn = Math.sin(th), j = Math.round(q), d = (q - j) * 4;
    return { cs: Math.cos(th), back: Math.max(0, sn), palm: Math.max(0, -sn), knuckle: j > 0 && j < last ? Math.exp(-d * d) : 0, tip: Math.max(0, q - (last - 1)), along: Math.sin((q - Math.min(last - 1, Math.floor(q))) * Math.PI) };
  };
  const form = (q, th) => {
    const { cs, back, palm, knuckle, tip, along } = part(q, th);
    return 1 - 0.09 * back * back + knuckle * (0.11 * back * back - 0.09 * palm * palm + 0.04 * cs * cs) + along * 0.055 * palm * palm * (1 - tip)
      + tip * (0.1 * palm * palm - 0.16 * tip * back * back - 0.1 * tip * cs * cs);
  };
  const tone = (q, th) => {
    const { palm, knuckle, tip } = part(q, th);
    return (1 - 0.5 * ramp(Math.sin(th), -0.12, 0.25) * (1 - ramp(tip, 0.42, 0.7))) * (1 - 0.32 * knuckle * palm);
  };
  return finish(jointed(joints, radii, 12, { up, domeA: 0.5, domeB: 0.8, swell: 0, mid: 2, mod: form, tint: tone }), s, 1.3);
}

// Put a part built around the origin onto a frame (x across, y out of the surface).
function place(g, at, x, y) {
  const X = unit(x), Y = unit(y), Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  Y.crossVectors(Z, X);
  return g.applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(V(at)));
}

// Centre line of a bent arm: straight forearm, rounded elbow, straight upper arm. Sampled every
// `step` as far as the folds of the elbow reach and more coarsely beyond, where it is never in
// view. Returns the points with their distance along the arm, and the distance to the elbow.
function armLine(A, E, S, cut, step) {
  const pts = [], c0 = E.clone().lerp(A, cut / A.distanceTo(E)), c1 = E.clone().lerp(S, cut / E.distanceTo(S)), c2 = E.clone().lerp(S, (cut + 0.04) / E.distanceTo(S));
  const run = (a, b, from, d) => { const n = Math.max(1, Math.round(a.distanceTo(b) / d)); for (let i = from; i <= n; i++) pts.push(a.clone().lerp(b, i / n)); };
  run(A, c0, 0, step);
  const nb = 2 * Math.max(3, Math.round(cut / step)), iE = pts.length + nb / 2 - 1;
  for (let i = 1; i <= nb; i++) pts.push(bezier(c0, E, c1, i / nb));
  run(c1, c2, 1, step); run(c2, S, 1, step * 2.6);
  let s = 0;
  const line = pts.map((p, i) => { if (i) s += p.distanceTo(pts[i - 1]); return { p, s }; });
  return { line, sE: line[iE].s, len: s };
}

// Half-width (across the wrist) and half-depth of the sleeve. x: 0 cuff, 1 elbow, 2 shoulder end.
const WIDE = [[0, 0.0345], [0.08, 0.035], [0.15, 0.0395], [0.42, 0.0445], [0.74, 0.0495], [1, 0.0515], [1.35, 0.054], [2, 0.059]];
const DEEP = [[0, 0.0285], [0.08, 0.029], [0.15, 0.0345], [0.42, 0.04], [0.74, 0.0462], [1, 0.0495], [1.35, 0.0525], [2, 0.058]];
const CUFF = 0.023;   // length of the cuff binding

// Jacket sleeve from the cuff at A, round the elbow E, to its closed end at S. `ulnar` is the
// section angle of the little-finger side, where the cuff adjuster and the sleeve seam sit.
function sleeve(out, A, E, S, D, F, ulnar) {
  const { line, sE, len } = armLine(A, E, S, 0.065, 0.0035), n = line.length - 1, NS = 2.15;
  const inner = A.clone().sub(E).normalize().add(S.clone().sub(E).normalize()).normalize();   // towards the crook of the elbow
  const path = line.map(({ p, s }) => { const x = s < sE ? s / sE : 1 + (s - sE) / (len - sE); return { p: arr(p), a: spline(x, WIDE), b: spline(x, DEEP), n: NS }; });

  // cloth: slack stacked in rings above the cuff, compressed folds in the crook of the elbow,
  // the point of the elbow pushing out on the far side, and a soft twisting drape everywhere else
  const cloth = (i, th, u, v) => {
    const s = line[Math.max(0, Math.min(n, i))].s, slack = ramp(s, CUFF, CUFF + 0.018);
    const stack = slack * Math.exp(-Math.max(0, s - CUFF) / 0.07) * 0.1 * (0.62 + 0.38 * Math.sin(th * 2 + s * 24)) * crease(s * 118 + 1.7 * Math.sin(th + 0.5) + 0.8 * Math.sin(th * 2 - 1.2));
    const de = (s - sE) / 0.06, side = Math.cos(th - Math.atan2(dot(v, inner), dot(u, inner)));
    const crook = Math.exp(-de * de) * Math.pow(Math.max(0, side), 1.5), tip = Math.exp(-de * de * 2.2) * Math.pow(Math.max(0, -side), 2);
    const fold = crook * 0.12 * crease((s - sE) * 140 + 0.8 * Math.sin(th * 2));
    // long folds pulled round the forearm between elbow and cuff, finer ones across them
    const drape = slack * (0.036 * Math.sin(th * 3 + s * 34) + 0.02 * Math.sin(th * 5 - s * 57 + 1.7) + 0.024 * crease(th * 2 + s * 41 + 0.7) * (1 - crook) + 0.022 * crease(th + s * 19 + 0.4) * ramp(s, 0.05, 0.11));
    const fine = stack + fold + drape;
    return [1 + fine - 0.06 * crook + 0.05 * tip, Math.min(1.1, Math.max(0.5, 1 + 2.9 * fine - 0.3 * crook))];
  };
  out.push(finish(sweep(path, 24, { up: arr(D), domeA: 0, domeB: 0.8, mod: (i, th, r) => cloth(i, th, r.u, r.v)[0], tint: (i, th, r) => cloth(i, th, r.u, r.v)[1] }), SHELL, 1.25));

  // felled seam down the little-finger side of the forearm, following the cloth
  const up = D.clone(), t = new THREE.Vector3(), seam = [];
  for (let i = 0; i <= n; i++) {
    t.copy(line[Math.min(n, i + 1)].p).sub(line[Math.max(0, i - 1)].p).normalize();
    up.addScaledVector(t, -up.dot(t)).normalize();
    const u = arr(new THREE.Vector3().crossVectors(t, up)), v = arr(up), q = path[i], th = ulnar + 0.35, k = cloth(i, th, u, v)[0] + 0.0012 / q.a;
    const x = pw(Math.cos(th), 2 / NS) * q.a * k, y = pw(Math.sin(th), 2 / NS) * q.b * k;
    if (line[i].s > CUFF && line[i].s < sE + 0.06) seam.push({ p: [q.p[0] + u[0] * x + v[0] * y, q.p[1] + u[1] * x + v[1] * y, q.p[2] + u[2] * x + v[2] * y], a: 0.0024, b: 0.0011, n: 3 });
  }
  out.push(finish(sweep(seam, 6, { up: [seam[0].p[0] - path[0].p[0], seam[0].p[1] - path[0].p[1], seam[0].p[2] - path[0].p[2]], domeA: 0.3, domeB: 0.3 }), SEAM, 1));

  // cuff binding, and the adjuster tab that cinches it
  const U = new THREE.Vector3().crossVectors(F, D).normalize(), Vd = new THREE.Vector3().crossVectors(U, F), a0 = WIDE[0][1], b0 = DEEP[0][1];
  out.push(finish(sweep([{ p: arr(A.clone().addScaledVector(F, -0.005)), a: a0 + 0.0002, b: b0 + 0.0002, n: 2.2 }, { p: arr(A.clone().addScaledVector(F, 0.002)), a: a0 + 0.0014, b: b0 + 0.0014, n: 2.2 }, { p: arr(A.clone().addScaledVector(F, CUFF)), a: a0 + 0.0018, b: b0 + 0.0018, n: 2.2 }], 24, { up: arr(D), domeA: 0.5, domeB: 0.12 }), HEM, 1.2));
  const round = (th0, th1, lift, thick, tall, s) => {
    const p = [];
    for (let k = 0; k <= 8; k++) { const th = ulnar + th0 + (th1 - th0) * k / 8; p.push({ p: arr(A.clone().addScaledVector(F, CUFF * 0.5).addScaledVector(U, Math.cos(th) * (a0 + lift)).addScaledVector(Vd, Math.sin(th) * (b0 + lift))), a: thick, b: tall, n: 3.4 }); }
    return finish(sweep(p, 8, { up: arr(F), domeA: 0.3, domeB: 0.3 }), s, 1);
  };
  out.push(round(-0.85, 0.5, 0.0032, 0.0013, 0.0085, STRAP), round(0.32, 0.72, 0.0044, 0.0016, 0.0098, TPR));
}

// h: { wrist, knuckle, back, row, elbow, shoulder, fingers: [[4 joints] x4], thumb: [joints] }
//   back = which way the back of the hand faces, row = along the knuckles towards the index.
//   The forearm runs from the wrist to the elbow, the upper arm on to the shoulder.
//   watch: wear one.
function frameOf(h) {
  const W = V(h.wrist), K = V(h.knuckle), D = unit(h.back), R = unit(h.row), E = V(h.elbow);
  const F = E.clone().sub(W).normalize(), H = K.clone().sub(W), L = H.length();
  H.normalize();
  return { W, K, D, R, E, F, H, L, index: new THREE.Vector3().crossVectors(H, D).dot(R) > 0 };   // index: does a sweep's +a side face the index finger?
}

// The glove on a hand, with its fingers and thumb through the given joints. The parts always
// come out in the same order with the same vertex counts, whatever the pose.
function glove(h, f, fingers, thumb) {
  const out = [], { W, K, D, R, F, H, L, index } = f;
  const at = (base, ...terms) => { const p = base.clone(); for (let i = 0; i < terms.length; i += 2) p.addScaledVector(terms[i], terms[i + 1]); return arr(p); };
  // palm section at d along the hand: half-widths to the index and little-finger sides, back and palm depths
  const ring = (d, ai, ap, bb, bp, n, lift = 0) => ({ p: at(W, H, d * L, D, lift), a: index ? ai : ap, a2: index ? ap : ai, b: bb, b2: bp, n });

  // palm with the heel of the hand, fingers, thumb on its mound
  out.push(finish(sweep([ring(-0.06, 0.0272, 0.0262, 0.0165, 0.0185, 2.3), ring(0.28, 0.0352, 0.0342, 0.0155, 0.0205, 2.4), ring(0.62, 0.0405, 0.039, 0.0146, 0.017, 2.5), ring(1, 0.0425, 0.04, 0.0138, 0.0148, 2.6)], 16, { up: h.back, domeA: 0.2, domeB: 0.6 }), LEATHER, 1.2));
  const fr = (i) => (i === 3 ? 0.0097 : 0.0108);
  fingers.forEach((j, i) => { const r = fr(i); out.push(digit(j, [r * 1.04, r * 0.97, r * 0.9, r * 0.8], h.back, LEATHER)); });
  const thumbR = thumb.map((_, j) => 0.0106 + 0.0082 * Math.pow(1 - j / (thumb.length - 1), 1.5));
  out.push(digit(thumb, thumbR, h.back, LEATHER));
  // web of the glove between thumb and index finger
  const T0 = V(thumb[0]), T1 = V(thumb[1]), I0 = V(fingers[0][0]);
  out.push(finish(sweep([{ p: arr(T0.clone().lerp(T1, 0.5)), a: 0.0125, b: 0.008 }, { p: arr(T0.clone().lerp(T1, 0.8).lerp(I0, 0.5)), a: 0.012, b: 0.0062 }, { p: arr(I0), a: 0.0105, b: 0.007 }], 10, { up: h.back, domeA: 0.4, domeB: 0.4 }), PAD, 1.2));
  // reinforcing pad on the little-finger side of the heel, knit panel over the back of the hand, knuckle guard
  out.push(finish(sweep([ring(0.06, 0.004, 0.0275, 0.004, 0.0202, 2.6), ring(0.28, 0.006, 0.0332, 0.004, 0.0218, 2.8), ring(0.48, 0.006, 0.0345, 0.004, 0.0196, 2.8)], 14, { up: h.back, domeA: 0.25, domeB: 0.25 }), PAD, 1.2));
  out.push(finish(sweep([ring(-0.02, 0.0278, 0.0268, 0.0148, 0.0085, 2.2, 0.0035), ring(0.3, 0.0358, 0.0348, 0.0142, 0.0085, 2.25, 0.0035), ring(0.64, 0.0411, 0.0396, 0.0134, 0.0085, 2.3, 0.0035), ring(0.93, 0.043, 0.0405, 0.0124, 0.0085, 2.3, 0.0035)], 16, { up: h.back, domeA: 0.2, domeB: 0.45 }), KNIT, 1.2));
  // moulded guard: a pad over each knuckle joined by a low band across the back of the hand,
  // and a rib along the first bone of each finger, which bends with it
  const kn = fingers.map((j) => V(j[0]));
  out.push(finish(sweep(kn.map((m) => ({ p: at(m, D, 0.015, H, -0.0065), a: 0.0066, b: 0.0026 })), 8, { up: h.back, domeA: 0.7, domeB: 0.7 }), GUARD, 1.2));
  kn.forEach((m, i) => { const k = fr(i) / 0.0108; out.push(finish(sweep([{ p: at(m, H, -0.0135, D, 0.015), a: 0.0072 * k, b: 0.0028 }, { p: at(m, H, -0.004, D, 0.0162), a: 0.0086 * k, b: 0.0037 }, { p: at(m, H, 0.0055, D, 0.0145), a: 0.007 * k, b: 0.0028 }], 10, { up: h.back, domeA: 0.9, domeB: 0.9 }), GUARD, 1.2)); });
  fingers.forEach((j, i) => {
    const a = V(j[0]), b = V(j[1]).sub(a), len = b.length();
    b.divideScalar(len);
    const side = R.clone().addScaledVector(b, -R.dot(b)).normalize(), top = new THREE.Vector3().crossVectors(side, b), r = fr(i) * 0.94;
    const p = (u, lift) => arr(a.clone().addScaledVector(b, u * len).addScaledVector(top, r + lift));
    out.push(finish(sweep([{ p: p(0.4, -0.0008), a: 0.0048, b: 0.0015 }, { p: p(0.56, 0.0003), a: 0.0056, b: 0.002 }, { p: p(0.73, -0.0008), a: 0.0046, b: 0.0015 }], 8, { up: arr(top), domeA: 0.8, domeB: 0.8 }), GUARD, 1.2));
  });
  // glove cuff running up under the sleeve (slim enough there to turn inside it), wrist strap with its pull tab
  out.push(finish(sweep([{ p: at(W, F, -0.012), a: 0.0282, b: 0.0202, n: 2.4 }, { p: at(W, F, 0.012), a: 0.03, b: 0.0225, n: 2.3 }, { p: at(W, F, 0.026), a: 0.0294, b: 0.0234, n: 2.2 }, { p: at(W, F, 0.035), a: 0.027, b: 0.0236, n: 2.1 }, { p: at(W, F, 0.05), a: 0.026, b: 0.0232, n: 2 }], 18, { up: h.back, domeA: 0.35, domeB: 0.1 }), KNIT, 1.2));
  out.push(finish(sweep([{ p: at(W, F, 0.003), a: 0.0312, b: 0.0236, n: 2.5 }, { p: at(W, F, 0.022), a: 0.0321, b: 0.025, n: 2.5 }], 18, { up: h.back, domeA: 0.08, domeB: 0.08 }), STRAP, 0.7));
  out.push(finish(place(rbox(0.03, 0.0034, 0.016, 0.0015, 2), at(W, F, 0.0125, D, 0.0262), h.row, h.back), TPR));
  if (h.watch) {
    // digital watch worn face-in on the wrist, over the strap of the glove
    const Y = D.clone().addScaledVector(F, -D.dot(F)).normalize().negate(), Z = new THREE.Vector3().crossVectors(F, Y), on = (g, x, y, z, s) => finish(place(g, at(W, F, 0.0125 + x, Y, 0.0243 + y, Z, z), arr(F), arr(Y)), s);
    out.push(on(rbox(0.036, 0.0105, 0.04, 0.004, 2), 0, 0.0045, 0, RESIN), on(rbox(0.0335, 0.0028, 0.0355, 0.0014, 2), 0, 0.0108, 0, BEZEL), on(rbox(0.0255, 0.0012, 0.027, 0.0004, 1), 0, 0.0124, 0, GLASS), on(rbox(0.0135, 0.0006, 0.019, 0.0002, 1), -0.0015, 0.0131, 0, LCD));
    for (const [x, z] of [[-0.0105, -1], [0.0105, -1], [-0.0105, 1], [0.0105, 1]]) out.push(on(rbox(0.005, 0.0036, 0.003, 0.001, 1), x, 0.0052, z * 0.0208, RESIN));
  }
  return out;
}

// A whole arm as one rigid piece: glove, then the sleeve from its cuff to the shoulder end.
function arm(h) {
  const f = frameOf(h), out = glove(h, f, h.fingers, h.thumb);
  sleeve(out, f.W.clone().addScaledVector(f.F, 0.03), f.E, V(h.shoulder), f.D, f.F, f.index ? 0 : Math.PI);
  return merge(out);
}

// Support hand wrapped round the handguard from below, wrist back and to the left. Every finger
// follows a helix round the tube from its knuckle, so the grip can be turned (`around`: where
// the row of knuckles sits, as an angle about the bore), angled forward (`yaw`) or slid along
// (`z`) and the fingers stay on the surface. `drop` lets the heel of the hand hang clear.
function supportGrip({ z, around, yaw, drop, fore, upper }) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), rk = HG.r + 0.0148, pt = (th, zz, r) => [Math.cos(th) * r, HG.y + Math.sin(th) * r, zz];
  const fingers = [[0.03, 0.95], [0.0102, 1], [-0.0098, 0.96], [-0.029, 0.82]].map(([off, l]) => [[0, rk], [0.044, HG.r + 0.0142], [0.071, HG.r + 0.0128], [0.093, HG.r + 0.011]].map(([d, r]) => pt(around - sy * off / rk + d * l * cy / (HG.r + 0.012), z - cy * off - d * l * sy, r)));
  // palm: tangent to the tube at the knuckles, running back along the fingers' line
  const n = V([Math.cos(around), Math.sin(around), 0]), tf = V([-Math.sin(around) * cy, Math.cos(around) * cy, -sy]);
  const H = tf.clone().multiplyScalar(Math.cos(drop)).addScaledVector(n, -Math.sin(drop)), D = n.clone().multiplyScalar(Math.cos(drop)).addScaledVector(tf, Math.sin(drop)), R = new THREE.Vector3().crossVectors(H, D);
  const K = V(pt(around, z, rk)), W = K.clone().addScaledVector(H, -0.092);
  // thumb: off the heel of the hand, up to the near side of the tube and forward along it
  const c = W.clone().addScaledVector(H, 0.012).addScaledVector(R, 0.027).addScaledVector(D, -0.01);
  const thumb = [arr(c), pt(3.26, c.z - 0.031, HG.r + 0.036), pt(3.14, c.z - 0.057, HG.r + 0.0152), pt(3.1, c.z - 0.083, HG.r + 0.0118)];
  const E = W.clone().addScaledVector(unit(fore), 0.275);
  return { wrist: arr(W), knuckle: arr(K), back: arr(D), row: arr(R), elbow: arr(E), shoulder: arr(E.clone().addScaledVector(unit(upper), 0.26)), fingers, thumb };
}

// ------------------------------------------------------------------ the support arm, moving
// A hand pose is, for each finger and then the thumb, where it leaves the palm and which way
// each of its bones points, in the palm's own frame: x towards the knuckles, y along them to
// the index finger, z out of the back of the hand. Bones keep their lengths between poses.
const toPose = (digits) => digits.map((j) => ({ m: j[0], d: j.slice(1).map((p, i) => p.clone().sub(j[i]).normalize()), l: j.slice(1).map((p, i) => p.distanceTo(j[i])) }));
const fromPose = (pose) => pose.map(({ m, d, l }) => { const j = [m.clone()]; d.forEach((v, i) => j.push(j[i].clone().addScaledVector(v, l[i]))); return j; });
function turn(a, b, t) {
  const w = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
  return w < 1e-4 ? a.clone() : a.clone().multiplyScalar(Math.sin((1 - t) * w) / Math.sin(w)).addScaledVector(b, Math.sin(t * w) / Math.sin(w));
}
const between = (a, b, t) => a.map((x, i) => ({ m: x.m, l: x.l, d: x.d.map((v, k) => turn(v, b[i].d[k], t)) }));
// fingers: [knuckle, middle, end joint bent by, spread towards the index] in degrees each; thumb: where its joints go
const curled = (grip, fingers, thumb) => grip.map((x, i) => {
  if (i === 4) return { m: x.m, l: x.l, d: thumb.map((p, k) => V(p).sub(k ? V(thumb[k - 1]) : x.m).normalize()) };
  const [a, b, c, spread] = fingers[i].map((v) => v * Math.PI / 180);
  let bent = 0;
  return { m: x.m, l: x.l, d: [a, b, c].map((v) => { bent += v; return new THREE.Vector3(Math.cos(spread) * Math.cos(bent), Math.sin(spread) * Math.cos(bent), -Math.sin(bent)); }) };
});
const OPEN = [[[16, 26, 16, 7], [18, 28, 18, 2], [20, 30, 18, -3], [22, 32, 20, -9]], [[0.045, 0.05, -0.02], [0.071, 0.066, -0.027], [0.094, 0.076, -0.031]]];
const MAG = [[[24, 84, 62, 2], [25, 86, 64, 0], [26, 86, 64, -2], [28, 86, 62, -5]], [[0.047, 0.047, -0.009], [0.076, 0.06, -0.004], [0.1, 0.068, -0.003]]];       // closed round the magazine
const PRESS = [[[10, 18, 12, 6], [12, 20, 12, 2], [14, 22, 14, -3], [16, 24, 16, -8]], [[0.04, 0.056, -0.02], [0.058, 0.082, -0.028], [0.07, 0.105, -0.036]]];   // thumb out to the bolt release
const FIST = [[[50, 92, 60, 5], [57, 93, 62, 1], [64, 94, 64, -2], [71, 94, 62, -6]], [[0.046, 0.05, -0.028], [0.074, 0.05, -0.048], [0.094, 0.038, -0.064]]];    // closed on the knife, thumb braced behind its guard
const TARGETS = ['gripHalf', 'open', 'magHalf', 'mag', 'press', 'fist'];

// The knife cut as the arm makes it, in view space (+x right, +y up, -z ahead of the eye):
// where the wrist is, which way the forearm runs (elbow to wrist), which way the back of the
// hand faces, how far the wrist is cocked back (-) or snapped through (+), and how much of its
// speed the arm carries through the key (`k`: 0 comes to rest there, 1 passes straight through).
const SHOULDER = [-0.2, -0.22, 0.1], FOREARM = 0.275;
const CUT = [
  { t: 0.13, w: [-0.12, -0.4, -0.2], fore: [0.25, -0.55, -0.8], back: [-0.7, 0.2, 0.68], dev: 0, k: 0.7 },                 // down to the sheath, out of sight
  { t: 0.235, w: [-0.23, -0.08, -0.36], fore: [-0.55, 0.4, -0.73], back: [-0.3, 0.75, 0.59], dev: -0.17, k: 0.12 },        // up beside the head, blade cocked back
  { t: KNIFE.hitAt, w: [-0.06, -0.09, -0.46], fore: [-0.1, 0.16, -0.98], back: [-0.22, 0.82, 0.53], dev: 0.06, k: 1 },      // across the middle, at full speed
  { t: 0.365, w: [0.07, -0.17, -0.42], fore: [0.5, -0.05, -0.86], back: [-0.1, 0.86, 0.5], dev: 0.19, k: 0.6 },            // through, the wrist snapping after the arm
  { t: 0.5, w: [0.1, -0.235, -0.38], fore: [0.68, -0.18, -0.71], back: [0, 0.85, 0.52], dev: 0.12, k: 0 },                 // spent
  { t: 0.63, w: [-0.1, -0.42, -0.22], fore: [0.3, -0.5, -0.81], back: [-0.6, 0.3, 0.74], dev: 0, k: 0.7 },                 // back to the sheath
];
// what the fingers do meanwhile: let go, close on the grip while the hand is out of sight, and come back empty
const CUT_FINGERS = [['grip', 0], ['gripHalf', 0.035], ['open', 0.08], ['open', 0.125], ['fist', 0.15], ['fist', 0.615], ['open', 0.65], ['open', 0.7], ['gripHalf', 0.775], ['grip', KNIFE.time]];
const KNIFE_OUT = [0.14, 0.63];     // the knife is in the hand between these, both while the hand is below the frame

// Pieces of the support arm: the sleeve, the hand about its wrist with one morph target per
// finger pose, and where the arm goes for each thing the hand does (`at`).
function supportArm() {
  const h = { ...supportGrip({ z: -0.312, around: 4.363, yaw: 0.8, drop: 0.244, fore: [-0.52, -0.36, 0.775], upper: [0.08, 0.3, 0.95] }), watch: true }, f = frameOf(h);
  const local = (p) => { const d = V(p).sub(f.W); return new THREE.Vector3(d.dot(f.H), d.dot(f.R), d.dot(f.D)); };
  const gun = (v) => arr(f.W.clone().addScaledVector(f.H, v.x).addScaledVector(f.R, v.y).addScaledVector(f.D, v.z));
  const poses = { grip: toPose([...h.fingers, h.thumb].map((j) => j.map(local))) };
  poses.open = curled(poses.grip, ...OPEN); poses.mag = curled(poses.grip, ...MAG); poses.press = curled(poses.grip, ...PRESS); poses.fist = curled(poses.grip, ...FIST);
  poses.gripHalf = between(poses.grip, poses.open, 0.5); poses.magHalf = between(poses.open, poses.mag, 0.5);
  const build = (name) => { const j = fromPose(poses[name]).map((d) => d.map(gun)); return merge(glove(h, f, j.slice(0, 4), j[4])); };
  // the hand at rest on the handguard, with a contact shadow where it closes on it
  const hand = shade(build('grip'), (x, y, z) => (z > -0.16 || z < -0.48 ? 1 : 0.5 + 0.5 * ramp(Math.hypot(x, y - HG.y) - HG.r, 0.0005, 0.02))).translate(-f.W.x, -f.W.y, -f.W.z);
  hand.morphAttributes.position = []; hand.morphAttributes.normal = [];
  for (const name of TARGETS) {
    const g = build(name).translate(-f.W.x, -f.W.y, -f.W.z);
    for (const k of ['position', 'normal']) { g.attributes[k].name = name; hand.morphAttributes[k].push(g.attributes[k]); }
  }
  const out = [];
  sleeve(out, f.W.clone().addScaledVector(f.F, 0.03), f.E, V(h.shoulder), f.D, f.F, 0);

  // Where the arm goes: the hand is given (wrist, which way it points, which way its back
  // faces) and the forearm follows it. The sleeve turns as little as it can, keeping the
  // upper arm towards `upper`; whatever is left over the hand turns inside its cuff (`roll`).
  const basis = (x, y, z) => new THREE.Matrix4().makeBasis(x, y, z), cross = (a, b) => new THREE.Vector3().crossVectors(a, b);
  const U0 = V(h.shoulder).sub(f.E).normalize(), n0 = cross(f.F, U0).normalize(), rest = basis(f.F, n0, cross(f.F, n0)).transpose(), restHand = basis(f.H, f.R, f.D).transpose();
  const station = (wrist, toward, back, upper) => {
    const H = unit(toward), D = unit(back);
    D.addScaledVector(H, -D.dot(H)).normalize();
    const turned = basis(H, cross(H, D), D).multiply(restHand), F = f.F.clone().applyMatrix4(turned), n = cross(F, unit(upper)).normalize();
    const arm = new THREE.Quaternion().setFromRotationMatrix(basis(F, n, cross(F, n)).multiply(rest));
    const v = n0.clone().applyMatrix4(turned).applyQuaternion(arm.clone().invert());
    return { wrist: V(wrist), arm, roll: Math.atan2(cross(n0, v).dot(f.F), n0.dot(v)) };
  };
  // The knife in the fist: its grip lies across the palm under the knuckles, the blade comes
  // out past the thumb, canted forward of the knuckle line, edge towards the knuckles.
  const cant = 0.2, tip = f.R.clone().multiplyScalar(Math.cos(cant)).addScaledVector(f.H, Math.sin(cant)), edge = f.H.clone().multiplyScalar(Math.cos(cant)).addScaledVector(f.R, -Math.sin(cant));
  const knife = { p: f.H.clone().multiplyScalar(0.088).addScaledVector(f.R, 0.006).addScaledVector(f.D, -0.028), q: new THREE.Quaternion().setFromRotationMatrix(basis(cross(edge, tip), edge.negate(), tip.negate())) };

  // A key of a free movement, as the 13 numbers that get blended: wrist, the hand's two axes,
  // which way the upper arm goes, wrist deviation.
  const key = (w, H, D, U, dev) => Float64Array.of(w.x, w.y, w.z, H.x, H.y, H.z, D.x, D.y, D.z, U.x, U.y, U.z, dev);
  const frame = (a, b) => { const z = b.clone().addScaledVector(a, -b.dot(a)).normalize(); return basis(a, cross(z, a), z); };
  const restArm = frame(f.F.clone().negate(), f.D).transpose();
  const cut = CUT.map(({ t, w, fore, back, dev, k }) => {
    const F = unit(fore), turned = frame(F, unit(back)).multiply(restArm), W = V(w);
    return { t, k, c: key(W, f.H.clone().applyMatrix4(turned), f.D.clone().applyMatrix4(turned), V(SHOULDER).sub(W.clone().addScaledVector(F, -FOREARM)).normalize(), dev) };
  });

  return {
    sleeve: merge(out), hand, wrist: f.W, fore: f.F, back: f.D, toward: f.H, upper: U0, knife, cut, station,
    rest: key(f.W, f.H, f.D, U0, 0),
    at: {
      grip: { wrist: f.W.clone(), arm: new THREE.Quaternion(), roll: 0 },
      mag: station([-0.0592, -0.137, -0.0297], [0.35, 0.13, -0.93], [-0.93, 0.05, -0.36], [0.08, 0.3, 0.95]),       // palm on the left face of the magazine, fingers round its front
      press: station([-0.0645, -0.1166, -0.0466], [0, 0.42, -0.907], [-1, 0, 0], [0.08, 0.3, 0.95]),               // beside the magazine well, thumb on the bolt release
    },
  };
}

// How the fingers get from one job to the next: [pose, when] along the move, always by way of
// an open hand.
const MOVES = {
  'grip>mag': [['grip', 0], ['gripHalf', 0.17], ['open', 0.36], ['open', 0.6], ['magHalf', 0.81], ['mag', 1]],
  'mag>press': [['mag', 0], ['magHalf', 0.2], ['open', 0.42], ['press', 1]],
  'press>grip': [['press', 0], ['open', 0.3], ['open', 0.56], ['gripHalf', 0.8], ['grip', 1]],
};
const ease = (t) => t * t * (3 - 2 * t);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _w = new THREE.Vector3(), _c = new Float64Array(13);
const _st = { wrist: new THREE.Vector3(), arm: new THREE.Quaternion(), roll: 0 };

// The support arm as the rifle drives it. The sleeve is one rigid piece that carries the wrist
// wherever the hand is needed; the hand turns inside the cuff and its fingers blend between
// poses. `knife`: the mesh it draws for a cut, kept in the fist and hidden until then.
export class SupportArm {
  constructor(parts, material, knife) {
    this.parts = parts;
    this.group = new THREE.Group();
    this.group.add(new THREE.Mesh(parts.sleeve, material));
    this.wrist = new THREE.Group(); this.wrist.position.copy(parts.wrist); this.group.add(this.wrist);
    this.hand = new THREE.Mesh(parts.hand, material); this.wrist.add(this.hand);
    this.knife = knife; knife.position.copy(parts.knife.p); knife.quaternion.copy(parts.knife.q); knife.visible = false; this.wrist.add(knife);
    // the cut's keys, between two that ride on the rifle: where the hand let go, and the handguard
    const end = (t) => ({ t, k: 0, c: new Float64Array(13) });
    this.keys = [end(0), ...parts.cut, end(KNIFE.time)];
    this.from = Float64Array.from(parts.rest); this.fromCurl = new Float32Array(TARGETS.length);
  }

  // Put the arm where a station says (rifle space), the hand bent `dev` towards its little finger.
  place(st, dev = 0) {
    const { wrist, fore, back } = this.parts;
    this.group.quaternion.copy(st.arm);
    this.group.position.copy(wrist).applyQuaternion(st.arm).negate().add(st.wrist);
    this.wrist.quaternion.setFromAxisAngle(fore, st.roll);
    if (dev) this.wrist.quaternion.multiply(_q2.setFromAxisAngle(back, dev));
  }

  // Finger poses along a move: [[pose, when], ...].
  curl(move, t) {
    const m = this.hand.morphTargetInfluences, id = this.hand.morphTargetDictionary;
    m.fill(0);
    let i = 1;
    while (i < move.length - 1 && t > move[i][1]) i++;
    const [p0, t0] = move[i - 1], [p1, t1] = move[i], k = ease(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
    if (p0 !== 'grip') m[id[p0]] += 1 - k;
    if (p1 !== 'grip') m[id[p1]] += k;
  }

  // Part-way (t: 0..1) from one station to another: 'grip', 'mag' or 'press'. `drop` carries the
  // hand down with the magazine, `push` presses it in towards the rifle.
  set(from, to, t, drop = 0, push = 0) {
    // the fingers let go before the hand sets off, and it arrives before they close
    const { at } = this.parts, A = at[from], B = at[to], s = ease(Math.min(1, Math.max(0, (t - 0.1) / 0.78))), lift = Math.sin(s * Math.PI) * 0.03;
    _st.arm.slerpQuaternions(A.arm, B.arm, s);
    _st.wrist.lerpVectors(A.wrist, B.wrist, s);
    _st.wrist.x += push - lift * 0.5; _st.wrist.y += drop - lift * 0.8;      // swing out and under the rifle on the way
    _st.roll = A.roll + (B.roll - A.roll) * s;
    this.place(_st);
    this.knife.visible = false;
    const move = MOVES[from + '>' + to];
    if (move) this.curl(move, t);
    else { const m = this.hand.morphTargetInfluences; m.fill(0); if (from !== 'grip') m[this.hand.morphTargetDictionary[from]] = 1; }
  }

  // Before a cut: note where the hand is and what its fingers are doing (it may be half-way
  // through a reload), so the cut starts from there.
  begin() {
    const { parts } = this, c = this.from;
    _w.copy(parts.wrist).applyQuaternion(this.group.quaternion).add(this.group.position).toArray(c, 0);
    _q.multiplyQuaternions(this.group.quaternion, this.wrist.quaternion);
    _w.copy(parts.toward).applyQuaternion(_q).toArray(c, 3); _w.copy(parts.back).applyQuaternion(_q).toArray(c, 6);
    _w.copy(parts.upper).applyQuaternion(this.group.quaternion).toArray(c, 9);
    this.fromCurl.set(this.hand.morphTargetInfluences);
  }

  // The knife cut, `t` seconds in. `gun` is the rifle's group: the keys are in view space, and
  // the first and last of them move with the rifle.
  cut(t, gun) {
    const keys = this.keys, n = keys.length, { parts } = this, ride = (src, dst) => {
      _w.fromArray(src, 0).applyQuaternion(gun.quaternion).add(gun.position).toArray(dst, 0);
      for (let j = 3; j < 12; j += 3) _w.fromArray(src, j).applyQuaternion(gun.quaternion).toArray(dst, j);
    };
    ride(this.from, keys[0].c); ride(parts.rest, keys[n - 1].c);

    // smooth through the keys, each tangent scaled by how fast the arm is still going there
    let i = 1;
    while (i < n - 1 && t > keys[i].t) i++;
    const a = keys[i - 1], b = keys[i], p = keys[Math.max(0, i - 2)], q = keys[Math.min(n - 1, i + 1)], span = b.t - a.t;
    const u = Math.min(1, Math.max(0, (t - a.t) / span)), u2 = u * u, u3 = u2 * u, ka = a.k * span / (b.t - p.t), kb = b.k * span / (q.t - a.t);
    for (let j = 0; j < 13; j++) _c[j] = (2 * u3 - 3 * u2 + 1) * a.c[j] + (u3 - 2 * u2 + u) * (b.c[j] - p.c[j]) * ka + (3 * u2 - 2 * u3) * b.c[j] + (u3 - u2) * (q.c[j] - a.c[j]) * kb;

    // the arm that puts the hand there, brought into the rifle's own space, where it hangs
    const st = parts.station([_c[0], _c[1], _c[2]], [_c[3], _c[4], _c[5]], [_c[6], _c[7], _c[8]], [_c[9], _c[10], _c[11]]);
    _q.copy(gun.quaternion).invert();
    st.wrist.sub(gun.position).applyQuaternion(_q); st.arm.premultiply(_q);
    this.place(st, _c[12]);

    this.curl(CUT_FINGERS, t);
    const m = this.hand.morphTargetInfluences, k = Math.min(1, t / 0.07);
    if (k < 1) for (let j = 0; j < m.length; j++) m[j] = this.fromCurl[j] * (1 - k) + m[j] * k;
    this.knife.visible = t > KNIFE_OUT[0] && t < KNIFE_OUT[1];
  }
}

// The firing arm is rigid with the rifle; the support arm comes in pieces for SupportArm. Elbows
// and shoulders are placed where the upper arms stay out of frame in every weapon pose.
export function buildArms() {
  // firing hand wrapped round the pistol grip, index finger on the trigger, elbow down
  const right = arm({
    wrist: [0.02, -0.064, 0.12], knuckle: [0.026, -0.062, 0.056], back: [0.97, 0.1, 0.2], row: [0.1, 0.98, 0.02], elbow: [0.117, -0.231, 0.309], shoulder: [0.13, -0.075, 0.517],
    fingers: [
      [[0.0245, -0.031, 0.044], [0.0205, -0.034, 0], [0.012, -0.038, -0.027], [-0.003, -0.04, -0.033]],
      [[0.026, -0.052, 0.052], [0.0235, -0.057, 0.006], [-0.008, -0.06, 0.007], [-0.0235, -0.063, 0.024]],
      [[0.026, -0.074, 0.06], [0.0235, -0.079, 0.014], [-0.008, -0.082, 0.015], [-0.0235, -0.085, 0.032]],
      [[0.0245, -0.094, 0.066], [0.022, -0.099, 0.026], [-0.004, -0.102, 0.024], [-0.021, -0.104, 0.036]],
    ],
    thumb: [[0.016, -0.046, 0.09], [-0.003, -0.032, 0.078], [-0.0175, -0.029, 0.052], [-0.0245, -0.025, 0.03], [-0.0245, -0.022, 0.006]],
  });
  return { right, left: supportArm() };
}
