// Character art. One modelled mesh per rig capsule - head, neck, chest, stomach, and three
// segments per limb - for the gunman, rusher, heavy and for other players, plus the weapons
// they carry. Every mesh is shaped around its own capsule from shared/rig.js (radius from
// segRadius, lengths from BONE) and stays within about 3 cm of the capsules, so what is drawn
// is still what the server hit-tests.
//
// Local frames, as posed by actors.js:
//   limbs    +y runs down the bone (joint a -> joint b); -z is the side the limb "faces"
//            (front of a leg, elbow side of an arm, top of a foot)
//   hands    +y continues the forearm out to the fingers, the palm faces +z
//   torso    +x right, +y up, -z forward; the capsule lies along x
//   head     +y up, -z forward

import * as THREE from 'three';
import { surf, finish, merge, shade, loftY, sweep, rbox, slab, rod, fillet, spline, jointed } from './mesh.js';
import { SEG, SEG_COUNT, segRadius, BONE } from '../shared/rig.js';

const STYLE = {
  grunt: { head: 'helmet', vest: true, pads: true, pack: true, holster: true },
  player: { head: 'helmet', vest: true, pads: true, pack: true, holster: true },
  rusher: { head: 'hood', hoodie: true },
  heavy: { head: 'armour', vest: true, pads: true, armour: true },
};

const blend = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);

function surfaces(P, st) {
  const cloth = (c, rough = 0.9) => surf(c, rough, 0, 1, 70);
  const hard = (c, rough = 0.5) => surf(c, rough, 0, 0.2, 40);
  return {
    jacket: cloth(P.jacket), pants: cloth(P.pants, 0.93), vest: st.armour ? hard(P.vest, 0.55) : cloth(P.vest, 0.84),
    // the palette's gear colour is an accent (helmet strap, chest panel); pouches, packs and pads stay near the vest
    accent: cloth(P.gear, 0.8), gear: cloth(blend(P.vest, P.gear, st.armour ? 0.7 : 0.07), 0.82), plate: hard(blend(P.vest, P.gear, st.armour ? 0.75 : 0.1), 0.56), shell: st.head === 'hood' ? cloth(P.helmet) : st.armour ? hard(P.helmet, 0.45) : surf(P.helmet, 0.7, 0, 0.7, 60), face: cloth(P.skin, 0.8),
    cuff: cloth(blend(P.jacket, 0x000000, 0.42), 0.88), glove: surf(P.glove, 0.7, 0, 0.5, 60), boot: surf(P.boot, 0.55, 0, 0.4, 50), sole: surf(0x060606, 0.9, 0, 0.6, 40),
    lens: surf(0x040405, 0.14, 0, 0, 40), dark: surf(0x09090a, 0.6, 0, 0.3, 40),
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pw = (v, e) => (v < 0 ? -Math.pow(-v, e) : Math.pow(v, e));
// rings along a bone: [t (0 at joint a .. 1 at joint b), half-width, back, front, exponent]
const along = (len, spec) => spec.map(([t, a, b, bf, n]) => ({ y: (t - 0.5) * len, a, b: b ?? a, bf: bf ?? b ?? a, n }));
// soft creases running round and along a sleeve or trouser leg
const folds = (amp, kt, ki) => (i, th) => 1 + amp * Math.sin(th * kt + i * ki) * Math.cos(th * 0.5 + i * 0.6);

// Point and outward normal on a section { a, a2, b, bf, n } at angle th (-PI/2 = front, 0 = right, PI/2 = back).
function onRing(r, th) {
  const e = 2 / (r.n || 2), c = Math.cos(th), s = Math.sin(th), a = c >= 0 ? r.a : r.a2 ?? r.a, b = s >= 0 ? r.b : r.bf ?? r.b;
  const nx = pw(c, 2 - e) / a, nz = pw(s, 2 - e) / b, l = Math.hypot(nx, nz) || 1;
  return { x: pw(c, e) * a, z: pw(s, e) * b, nx: nx / l, nz: nz / l };
}
// Curved plate that follows a section from th0 to th1, standing `lift` proud of it (pads, armour, pockets).
function plateOn(r, y, th0, th1, lift, thick, tall, n = 3, steps = 6) {
  const path = [];
  for (let i = 0; i <= steps; i++) { const q = onRing(r, th0 + (th1 - th0) * i / steps); path.push({ p: [q.x + q.nx * lift, y, q.z + q.nz * lift], a: thick / 2, b: tall / 2, n }); }
  return sweep(path, 8, { up: [0, 1, 0], domeA: 0.25, domeB: 0.25 });
}
// Flat pouch sat on a section at angle th, its back face sunk `sink` into the surface.
function pouchOn(r, y, th, w, h, d, sink = 0.004) {
  const q = onRing(r, th), o = d / 2 - sink;
  return rbox(w, h, d, Math.min(0.008, d * 0.3), 1).rotateY(Math.atan2(q.nx, q.nz)).translate(q.x + q.nx * o, y, q.z + q.nz * o);
}
const FRONT = -Math.PI / 2;

// ------------------------------------------------------------------ arms
// An arm in its bone frames: -z is the outside of the elbow, +z the crook, and `side` (+1 right
// arm, -1 left) says which way +x points out from the body. Profiles are keys of
// [t along the bone, half-width outwards, inwards, depth to the crook, depth to the elbow].
const CROOK = Math.PI / 2;
const section = (keys, t, side, n = 2.2) => { const o = spline(t, keys, 1), i = spline(t, keys, 2); return { a: side > 0 ? o : i, a2: side > 0 ? i : o, b: spline(t, keys, 3), bf: spline(t, keys, 4), n }; };

// Loft a limb through its keys from t0 to t1. cloth(t, th) is how far a fold pushes the surface
// in or out there (a fraction of the radius); the same number shades the inside of the fold.
function limb(len, keys, side, t0, t1, rings, seg, cloth, opts) {
  const list = [];
  for (let i = 0; i <= rings; i++) { const t = t0 + (t1 - t0) * i / rings; list.push({ y: (t - 0.5) * len, ...section(keys, t, side) }); }
  if (!cloth) return loftY(list, seg, opts);
  const f = (i, th, r) => cloth(r.c[1] / len + 0.5, th);
  return loftY(list, seg, { ...opts, mod: (i, th, r) => 1 + f(i, th, r), tint: (i, th, r) => clamp(1 + 3.2 * f(i, th, r), 0.6, 1.08) });
}
const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const crook = (th) => Math.max(0, Math.sin(th)) ** 1.5;

// Shoulder to elbow: the cap of the shoulder, a fuller upper half, narrowing into the elbow.
function upperArm(R, len, S, st, side) {
  const k = st.armour ? 0.001 : st.hoodie ? 0.004 : 0.006;
  const keys = [[0, R + 0.008, R + 0.004, R + 0.006, R + 0.009], [0.14, R + 0.012 + k, R + 0.005, R + 0.009, R + 0.012], [0.34, R + 0.007 + k * 0.5, R + 0.004, R + 0.009, R + 0.007], [0.56, R + 0.001, R, R + 0.005, R + 0.002], [0.78, R - 0.005, R - 0.005, R - 0.003, R - 0.003], [0.92, R - 0.005, R - 0.005, R - 0.005, R + 0.002], [1, R - 0.005, R - 0.005, R - 0.006, R + 0.001]];
  // sleeve hanging in soft diagonals from the shoulder, bunched where the elbow bends
  const cloth = (t, th) => bump(t, 0.5, 0.3) * 0.022 * Math.sin(th * 2 + t * 9) + bump(t, 0.93, 0.16) * crook(th) * (0.07 * Math.sin(t * 60 + Math.sin(th * 2)) - 0.03);
  const out = [finish(limb(len, keys, side, 0, 1, 16, 12, cloth, { domeA: 0.9, domeB: 0.85 }), S.jacket, 1.3)];
  const outer = side > 0 ? -0.45 : Math.PI + 0.45, at = (t) => section(keys, t, side), y = (t) => (t - 0.5) * len;
  if (st.armour) out.push(finish(plateOn(at(0.15), y(0.15), outer - 1.5, outer + 1.5, 0.004, 0.02, 0.105, 3.2, 8), S.plate, 1), finish(plateOn(at(0.47), y(0.47), outer - 1.15, outer + 1.15, 0.004, 0.016, 0.085, 3.2, 7), S.plate, 1));
  else if (st.vest) out.push(finish(plateOn(at(0.3), y(0.3), outer - 0.42, outer + 0.42, 0.001, 0.006, 0.05, 3.4, 4), S.accent, 1));   // unit patch
  return merge(out);
}

// Elbow to wrist: the sleeve is fullest just below the elbow and narrows to its cuff, with the
// cuff of the glove running on to the wrist.
function foreArm(R, len, S, st, side) {
  const k = st.hoodie ? 0.003 : 0;
  const keys = [[0, R + 0.002, R + 0.002, R + 0.001, R + 0.005], [0.14, R + 0.007 + k, R + 0.006 + k, R + 0.004 + k, R + 0.007 + k], [0.32, R + 0.006 + k, R + 0.005 + k, R + 0.003 + k, R + 0.004 + k], [0.56, R - 0.002 + k, R - 0.002 + k, R - 0.004 + k, R - 0.004 + k], [0.74, R - 0.009, R - 0.009, R - 0.012, R - 0.012], [0.8, R - 0.0105, R - 0.0105, R - 0.0155, R - 0.0155], [1, R - 0.012, R - 0.012, R - 0.019, R - 0.019]];
  const cloth = (t, th) => bump(t, 0.06, 0.15) * crook(th) * (0.07 * Math.sin(t * 60 + Math.sin(th * 2)) - 0.03) + bump(t, 0.6, 0.14) * 0.05 * Math.sin(t * 66 + 1.5 * Math.sin(th + 1)) + bump(t, 0.36, 0.2) * 0.02 * Math.sin(th * 3 - t * 8);
  const grow = (d) => keys.map(([t, ...r]) => [t, ...r.map((v) => v + d)]);
  const out = [
    finish(limb(len, keys, side, 0, 0.75, 14, 12, cloth, { domeA: 0.9, domeB: 0 }), S.jacket, 1.3),
    finish(limb(len, grow(0.0022), side, 0.685, 0.755, 2, 12, null, { domeA: 0.15, domeB: 0.3 }), st.hoodie ? S.jacket : S.cuff, 1.1),   // cuff binding
    finish(limb(len, keys, side, 0.73, 1, 4, 10, null, { domeA: 0, domeB: 0.5 }), S.glove, 1.3),
  ];
  const at = (t) => section(keys, t, side), y = (t) => (t - 0.5) * len;
  if (st.armour) out.push(finish(plateOn(at(0.36), y(0.36), FRONT - 1.25, FRONT + 1.25, 0.004, 0.016, 0.12, 3.2, 7), S.plate, 1));        // vambrace
  if (st.pads) out.push(finish(plateOn(at(0.06), y(0.06), FRONT - 0.85, FRONT + 0.85, 0.008, 0.014, 0.085), S.plate, 1.1));              // elbow pad
  return merge(out);
}

// Gloved hand closed round a grip: centre of the palm at the origin, fingers curling over to the
// palm side, thumb (on +x of a right hand) wrapped across them.
function hand(R, S, side) {
  const k = R / 0.05, P = (x, y, z) => [side * x * k, y * k, z * k], out = [];
  out.push(finish(loftY([[-0.05, 0.027, 0.019, 0.021], [-0.02, 0.036, 0.02, 0.0225], [0.008, 0.041, 0.0175, 0.0225], [0.024, 0.0405, 0.012, 0.02]].map(([y, a, b, bf]) => ({ y: y * k, a: a * k, b: b * k, bf: bf * k, n: 2.6 })), 10, { domeA: 0.25, domeB: 0.5 }), S.glove, 1.3));
  const bone = (a, l, deg) => [a[0], a[1] + l * Math.cos(deg * Math.PI / 180), a[2] + l * Math.sin(deg * Math.PI / 180)];
  [[0.029, 0.95, 0], [0.0098, 1, 3], [-0.0098, 0.96, 5], [-0.029, 0.82, 8]].forEach(([x, l, more]) => {
    const j0 = [x, 0.02, -0.004], j1 = bone(j0, 0.04 * l, 48 + more), j2 = bone(j1, 0.026 * l, 128 + more), j3 = bone(j2, 0.02 * l, 176 + more), r = (l < 0.9 ? 0.0092 : 0.0102) * k;
    out.push(finish(jointed([j0, j1, j2, j3].map((p) => P(...p)), [r, r * 0.97, r * 0.9, r * 0.82], 6, { bend: 0.009 * k, steps: 2, up: [0, 0, -1], domeA: 0.4, domeB: 0.8 }), S.glove, 1.3));
  });
  out.push(finish(jointed([P(0.03, -0.03, 0.006), P(0.047, -0.004, 0.02), P(0.038, 0.016, 0.039), P(0.02, 0.024, 0.051)], [0.0155 * k, 0.0122 * k, 0.0108 * k, 0.0094 * k], 6, { bend: 0.009 * k, steps: 2, up: [0, 0, -1], domeA: 0.5, domeB: 0.8 }), S.glove, 1.3));
  out.push(finish(rbox(0.066 * k, 0.014 * k, 0.006 * k, 0.0025 * k, 1).translate(0, 0.013 * k, -0.0225 * k), S.dark));   // knuckle guard
  return merge(out);
}

// ------------------------------------------------------------------ legs
function thigh(R, len, S, st, side) {
  const out = [finish(loftY(along(len, [[0, R + 0.01, R + 0.014, R + 0.004], [0.2, R + 0.008], [0.5, R - 0.002], [0.8, R - 0.01], [1, R - 0.006, R - 0.008, R - 0.002]]), 14, { domeA: 0.95, domeB: 1, mod: folds(0.03, 2, 1.3) }), S.pants, 1.3)];
  const mid = { a: R - 0.002, b: R - 0.002 }, out0 = side > 0 ? 0 : Math.PI;
  if (st.armour) out.push(finish(plateOn(mid, -0.02, FRONT - 0.8, FRONT + 0.8, 0.012, 0.018, 0.2), S.plate, 1.1));
  if (st.holster && side > 0) {             // drop-leg holster with the pistol's grip showing, on its thigh strap
    out.push(finish(rbox(0.026, 0.14, 0.06, 0.008, 1).translate(R + 0.008, -0.01, 0.004), S.vest), finish(rbox(0.022, 0.05, 0.03, 0.007, 1).rotateX(-0.35).translate(R + 0.008, -0.095, 0.022), S.dark));
    out.push(finish(loftY(along(len, [[0.3, R + 0.006], [0.36, R + 0.006]]), 12, { domeA: 0, domeB: 0 }), S.vest, 0.8));
  } else if (!st.armour) out.push(finish(plateOn(mid, -0.012, out0 - 0.62, out0 + 0.62, 0.006, 0.014, 0.15), S.pants, 1.1), finish(plateOn(mid, -0.072, out0 - 0.66, out0 + 0.66, 0.009, 0.014, 0.042), S.pants, 1.1));   // cargo pocket and flap
  return merge(out);
}

function shin(R, len, S, st) {
  const out = [finish(loftY(along(len, [[0, R + 0.006, R + 0.002, R + 0.008], [0.25, R + 0.004, R + 0.014, R - 0.004], [0.48, R - 0.002, R + 0.006, R - 0.006], [0.58, R + 0.006], [0.63, R + 0.002]]), 12, { domeA: 0.85, domeB: 0, mod: folds(0.035, 2, 1.9) }), S.pants, 1.3)];
  // boot shaft with its padded collar and lacing
  out.push(finish(loftY(along(len, [[0.6, R + 0.004], [0.66, R], [0.85, R - 0.006, R - 0.004, R - 0.006], [1, R - 0.008, R - 0.002, R - 0.008]]), 12, { domeA: 0.2, domeB: 0.6 }), S.boot, 1.3));
  out.push(finish(plateOn({ a: R - 0.006, b: R - 0.006 }, 0.31 * len, FRONT - 0.3, FRONT + 0.3, 0.003, 0.01, len * 0.33, 3, 2), S.dark, 1.1));
  if (st.pads) {
    out.push(finish(plateOn({ a: R + 0.004, b: R + 0.004 }, -0.44 * len, FRONT - 0.95, FRONT + 0.95, 0.01, 0.02, 0.13), S.plate, 1.1));
    for (const t of [0.03, 0.17]) out.push(finish(loftY(along(len, [[t, R + 0.009], [t + 0.04, R + 0.009]]), 12, { domeA: 0, domeB: 0 }), S.vest, 0.8));
  }
  return merge(out);
}

// Boot. The capsule runs from the ankle down to the toe, so the flat sole is a slanted plane in
// local space. Under the heel the capsule is 4 cm off the ground; the sole is allowed 3.5 cm
// there (the one place a part leaves its capsule by more than 3) so boots stand flat instead
// of on tiptoe.
function foot(R, len, sc, S) {
  const k = R / 0.05, L = len / 0.17;
  const under = (y) => Math.sqrt(Math.max(0, R * R - Math.max(0, Math.abs(y) - len / 2) ** 2));      // capsule surface below the axis
  const sole = (y) => Math.min(0.0698 * sc - 0.2646 * y - 0.004, under(y) + (y < 0 ? 0.035 : 0.025));
  const prof = [[-0.128, 0.03, 0.024], [-0.105, 0.041, 0.048], [-0.06, 0.046, 0.052], [0, 0.05, 0.042], [0.06, 0.05, 0.03], [0.105, 0.044, 0.024], [0.128, 0.03, 0.018]];
  return merge([
    finish(loftY(prof.map(([y, a, top]) => ({ y: y * L, a: a * k, b: sole(y * L), bf: top * k, n: 3 })), 12, { domeA: 0.3, domeB: 0.4 }), S.boot, 1.2),
    finish(loftY(prof.map(([y, a]) => ({ y: y * L, a: a * k - 0.002, b: 0.007, z: sole(y * L) - 0.006, n: 3 })), 10, { domeA: 0.2, domeB: 0.2 }), S.sole, 1.0),
  ]);
}

// ------------------------------------------------------------------ torso
// Chest and stomach are two horizontal capsules stacked along the spine. Seen from the side
// their union is a snowman; a jacket is not. This describes one continuous body surface from
// hips to shoulders, flattened across the waist as far as the fit tolerance allows, which the
// two torso meshes then each take their half of. t = height along the spine above the
// stomach capsule's centre.
function torso(def) {
  const sc = def.scale, Rc = segRadius(SEG.CHEST, def), Rs = segRadius(SEG.STOMACH, def), Hc = BONE.chestHalf * sc, Hs = BONE.stomachHalf * sc, T = 0.25 * sc;
  const sq = (v) => (v > 0 ? Math.sqrt(v) : -1);
  const ring = (t, grow = 0, n = 2.6) => {
    const s = sq(Rs * Rs - t * t), c = sq(Rc * Rc - (t - T) * (t - T)), d = Math.max(s, c, 0), w = Math.max(s >= 0 ? Hs + s : 0, c >= 0 ? Hc + c : 0);
    let m = clamp(t / T, 0, 1); m = m * m * (3 - 2 * m);
    const f = Math.min(clamp(Rs - 0.014 + (Rc - Rs - 0.006) * m, d - 0.02, d + 0.022) + grow, d + 0.029);
    const b = Math.min(clamp(Rs - 0.018 + (Rc - Rs - 0.004) * m, d - 0.022, d + 0.02) + grow, d + 0.029);
    const a = Math.min(clamp(Hs + Rs - 0.014 + (Hc + Rc - Hs - Rs) * m, w - 0.022, w + 0.01) + grow, w + 0.029);
    return { a: Math.max(0.012, a), bf: Math.max(0.012, f), b: Math.max(0.012, b), n };
  };
  return { T, Rc, Rs, sc, def, split: (T * T + Rs * Rs - Rc * Rc) / (2 * T), ring };
}
// loft a stretch of the torso surface; y0 = where this mesh's origin sits on the spine
const span = (B, y0, ts, grow, n, opts) => loftY(ts.map((t) => ({ y: t - y0, ...B.ring(t, grow, n) })), 20, opts);

function chest(B, S, st) {
  const { T, Rc, split } = B, at = (k) => T + k * Rc, y = (k) => k * Rc, s = Rc / 0.168;
  const out = [finish(span(B, T, [split - 0.03, at(-0.45), at(-0.15), at(0.2), at(0.5), at(0.74), at(0.9), at(0.97)], 0, 2.6, { domeA: 0, domeB: 0.5 }), S.jacket, 1.3)];
  // a ball at each shoulder joint closes the gap between jacket body and sleeve in every arm pose
  const sr = segRadius(SEG.UARM_L, B.def) + 0.014;
  for (const sx of [-1, 1]) out.push(finish(loftY([{ y: 0.105 * B.sc - sr * 0.5, a: sr * 0.87, x: sx * 0.2 * B.sc }, { y: 0.105 * B.sc + sr * 0.5, a: sr * 0.87, x: sx * 0.2 * B.sc }], 10, { domeA: 0.58, domeB: 0.58 }), st.armour ? S.plate : S.jacket, 1.3));
  if (st.vest) {
    // plate carrier: plate bags front and back, yoke over the shoulders, admin panel, pack
    out.push(finish(span(B, T, [split - 0.02, at(-0.4), at(0.1), at(0.42), at(0.6)], 0.012, 2.7, { domeA: 0, domeB: 0.2 }), S.vest, 1.1));
    out.push(finish(loftY([at(0.55), at(0.72), at(0.84)].map((t, i) => { const r = B.ring(t, 0.01); return { y: t - T, a: r.a * (0.6 - i * 0.06), bf: r.bf, b: r.b, n: 2.6 }; }), 16, { domeA: 0, domeB: 0.3 }), S.vest, 1.1));
    out.push(finish(pouchOn(B.ring(at(0.24), 0.012, 2.7), y(0.24), FRONT, 0.13 * s, 0.05, 0.014), st.armour ? S.plate : S.accent));
    if (st.pack) out.push(finish(plateOn(B.ring(at(-0.02), 0.012, 2.7), y(-0.02), Math.PI / 2 - 0.62, Math.PI / 2 + 0.62, 0.008, 0.022, 0.72 * Rc, 3.4), S.gear, 1.1), finish(pouchOn(B.ring(at(0.42), 0.012, 2.7), y(0.42), Math.PI / 2, 0.15 * s, 0.04, 0.02), S.gear));
    if (st.armour) out.push(finish(plateOn(B.ring(at(-0.05), 0.012, 2.7), y(-0.05), FRONT - 0.75, FRONT + 0.75, 0.007, 0.018, 0.62 * Rc, 3.4), S.plate, 1.1), finish(plateOn(B.ring(at(-0.02), 0.012, 2.7), y(-0.02), Math.PI / 2 - 0.75, Math.PI / 2 + 0.75, 0.007, 0.018, 0.7 * Rc, 3.4), S.plate, 1.1));
  }
  if (st.hoodie) {
    // zip, and the hood gathered behind the neck
    out.push(finish(pouchOn(B.ring(at(-0.1)), y(-0.1), FRONT, 0.012, 0.8 * Rc, 0.008, 0.003), S.dark));
    out.push(finish(plateOn(B.ring(at(0.48)), y(0.48), Math.PI / 2 - 0.9, Math.PI / 2 + 0.9, 0.002, 0.016, 0.045, 2.4), S.jacket, 1.3));
  }
  return merge(out);
}

function stomach(B, S, st) {
  const { Rs, split } = B, at = (k) => k * Rs, s = Rs / 0.152;
  const out = [
    finish(span(B, 0, [at(-0.97), at(-0.8), at(-0.6), at(-0.42)], -0.004, 2.5, { domeA: 0.8, domeB: 0 }), S.pants, 1.3),                                   // hips
    finish(span(B, 0, [at(-0.68), at(-0.55), at(-0.1), at(0.35), split + 0.03], 0, 2.6, { domeA: 0, domeB: 0, mod: folds(0.02, 4, 1.1) }), S.jacket, 1.3),   // jacket down to its hem
  ];
  if (st.hoodie) out.push(finish(plateOn(B.ring(at(-0.1)), at(-0.1), FRONT - 0.7, FRONT + 0.7, 0.004, 0.012, 0.1 * s, 3.4), S.jacket, 1.1));       // pouch pocket
  else {
    // duty belt and buckle
    out.push(finish(span(B, 0, [at(-0.62), at(-0.4)], 0.005, 2.6, { domeA: 0, domeB: 0 }), S.vest, 0.8));
    out.push(finish(pouchOn(B.ring(at(-0.51), 0.005), at(-0.51), FRONT, 0.05, 0.034, 0.012, 0.008), S.plate));
    for (const sx of [-1, 1]) out.push(finish(pouchOn(B.ring(at(-0.4), 0.005), at(-0.4), sx > 0 ? 0.3 : Math.PI - 0.3, 0.055, 0.042, 0.018, 0.01), S.gear));
  }
  if (st.vest) {
    // cummerbund and three magazine pouches across the belly
    out.push(finish(span(B, 0, [at(-0.25), at(0.1), at(0.4), split + 0.02], 0.012, 2.7, { domeA: 0.1, domeB: 0 }), S.vest, 1.1));
    if (st.armour) for (const th of [-0.62, 0, 0.62]) out.push(finish(plateOn(B.ring(at(-0.1), 0.012, 2.7), at(-0.1), FRONT + th - 0.28, FRONT + th + 0.28, 0.006, 0.016, 0.5 * Rs, 3.2, 3), S.plate, 1.1));
    else for (const th of [-0.5, 0, 0.5]) out.push(finish(pouchOn(B.ring(at(0.08), 0.012, 2.7), at(0.08), FRONT + th, 0.066, 0.08, 0.024), S.gear), finish(pouchOn(B.ring(at(0.08), 0.012, 2.7), at(0.08) + 0.026, FRONT + th, 0.068, 0.028, 0.027), S.gear));
  }
  return merge(out);
}

function neck(R, len, S, st) {
  return merge([
    finish(loftY([{ y: -len / 2, a: R - 0.004 }, { y: len / 2 + 0.03, a: R - 0.008 }], 12, { domeA: 0, domeB: 0 }), S.face, 1.3),
    finish(loftY([{ y: -len / 2 - 0.03, a: R + 0.02, b: R + 0.014 }, { y: -len / 2 + 0.004, a: R + 0.014, b: R + 0.01 }, { y: -len / 2 + 0.03, a: R + 0.004, b: R + 0.002 }], 14, { domeA: 0.2, domeB: 0.15 }), st.armour ? S.plate : S.jacket, 1.1),
  ]);
}

// ------------------------------------------------------------------ heads
// Rings are [y, half-width, front, back] around the centre of the head sphere.
const skull = (spec, k, n = 2.3) => spec.map(([y, a, f, b]) => ({ y: y * k, a: a * k, bf: f * k, b: b * k, n }));
const HEAD = [[-0.108, 0.04, 0.074, 0.03], [-0.095, 0.058, 0.092, 0.05], [-0.07, 0.064, 0.098, 0.066], [-0.04, 0.072, 0.102, 0.086], [-0.01, 0.076, 0.1, 0.096], [0.025, 0.078, 0.098, 0.1], [0.06, 0.075, 0.09, 0.098], [0.09, 0.064, 0.072, 0.086], [0.108, 0.044, 0.048, 0.06]];
// a band wrapped round the head between two angles (0 = straight ahead), e.g. goggles or a visor
const wrap = (k, y, r, a0, a1, thick, tall, n, steps = 8) => {
  const path = [];
  for (let i = 0; i <= steps; i++) { const g = a0 + (a1 - a0) * i / steps; path.push({ p: [Math.sin(g) * r * k, y * k, -Math.cos(g) * r * k * 1.1], a: thick * k, b: tall * k, n }); }
  return sweep(path, 8, { up: [0, 1, 0], domeA: 0.25, domeB: 0.25 });
};

function head(R, S, st) {
  const k = R / 0.118, out = [];
  if (st.head === 'armour') {
    // sealed assault helmet: shell, jaw guard, brow ridge, crest, dark face shield (the glowing slit is added by the actor)
    out.push(finish(loftY(skull([[-0.1, 0.078, 0.086, 0.082], [-0.07, 0.1, 0.106, 0.105], [-0.02, 0.11, 0.113, 0.116], [0.04, 0.112, 0.115, 0.12], [0.085, 0.098, 0.102, 0.108], [0.11, 0.064, 0.068, 0.072]], k, 2.5), 18, { domeA: 0.25, domeB: 0.45 }), S.shell, 1.2));
    out.push(finish(wrap(k, -0.004, 0.103, -1.05, 1.05, 0.006, 0.04, 3), S.lens, 1.2));
    out.push(finish(wrap(k, -0.07, 0.092, -0.8, 0.8, 0.009, 0.02, 3), S.plate, 1.1), finish(wrap(k, 0.052, 0.101, -0.9, 0.9, 0.008, 0.011, 3), S.plate, 1.1));
    out.push(finish(rbox(0.026 * k, 0.014 * k, 0.12 * k, 0.006 * k, 1).translate(0, 0.118 * k, 0.004 * k), S.plate));
    for (const sx of [-1, 1]) out.push(finish(rbox(0.016 * k, 0.06 * k, 0.06 * k, 0.007 * k, 1).translate(sx * 0.112 * k, -0.02 * k, 0.01 * k), S.plate));
    return merge(out);
  }
  // the head itself: balaclava or mask over a proper skull shape - jaw, cheek, brow, crown
  const face = finish(loftY(skull(HEAD, k), 16, { domeA: 0.5, domeB: 0.5 }), S.face, 1.4);
  out.push(finish(loftY([{ y: -0.045 * k, a: 0.012 * k, b: 0.012 * k, z: -0.1 * k }, { y: -0.012 * k, a: 0.009 * k, b: 0.009 * k, z: -0.101 * k }], 8, { domeA: 0.8, domeB: 0.8 }), S.face, 1.4));      // nose
  if (st.head === 'hood') {
    // mask: hollow eyes and a slotted mouth, framed by the hood
    out.push(face);
    for (const sx of [-1, 1]) out.push(finish(rbox(0.03 * k, 0.019 * k, 0.012 * k, 0.007 * k, 2).rotateZ(sx * -0.16).rotateY(sx * -0.3).translate(sx * 0.033 * k, -0.002 * k, -0.092 * k), S.lens));
    for (let i = 0; i < 5; i++) out.push(finish(rbox(0.004 * k, 0.016 * k, 0.008 * k, 0.0015 * k, 1).translate((i - 2) * 0.0095 * k, -0.066 * k, -0.095 * k), S.lens));
    out.push(finish(loftY(skull([[-0.085, 0.086, 0.02, 0.106], [-0.04, 0.098, 0.058, 0.113], [0, 0.101, 0.078, 0.116], [0.05, 0.099, 0.105, 0.114], [0.09, 0.086, 0.096, 0.101], [0.114, 0.056, 0.062, 0.066]], k, 2.2), 16, { domeA: 0.3, domeB: 0.5, mod: folds(0.02, 3, 1.4) }), S.shell, 1.4));
    return merge(out);
  }
  // ballistic helmet over the balaclava, goggles on a strap, headset
  out.push(shade(face, (x, y) => (y > 0.02 * k ? 0.55 : 1)));
  out.push(finish(loftY(skull([[0.026, 0.107, 0.119, 0.123], [0.034, 0.109, 0.122, 0.126], [0.06, 0.11, 0.123, 0.127], [0.095, 0.094, 0.104, 0.11], [0.118, 0.07, 0.076, 0.082], [0.13, 0.04, 0.044, 0.048]], k, 2.3), 18, { domeA: 0, domeB: 0.3 }), S.shell, 1.2));
  out.push(finish(wrap(k, -0.004, 0.092, -1.15, 1.15, 0.008, 0.024, 3.4), S.dark, 1.2), finish(wrap(k, -0.004, 0.097, -0.95, 0.95, 0.006, 0.018, 3), S.lens, 1.2));
  out.push(finish(wrap(k, 0.046, 0.113, 1.1, Math.PI * 2 - 1.1, 0.003, 0.011, 3, 12), S.accent, 1.2));
  out.push(finish(rbox(0.036 * k, 0.026 * k, 0.012 * k, 0.005 * k, 1).translate(0, 0.05 * k, -0.126 * k), S.dark));                 // NVG shroud
  for (const sx of [-1, 1]) out.push(finish(rbox(0.03 * k, 0.06 * k, 0.052 * k, 0.012 * k, 1).translate(sx * 0.087 * k, -0.012 * k, 0.012 * k), S.dark), finish(rbox(0.007 * k, 0.014 * k, 0.075 * k, 0.003 * k, 1).translate(sx * 0.112 * k, 0.05 * k, 0.004 * k), S.dark));
  return merge(out);
}

// ------------------------------------------------------------------ carried weapons
// Authored with the muzzle towards -z and the firing hand at the origin; `s` = distance forward.
const STEEL = surf(0x17181a, 0.5, 0.75, 0.4, 40, 0.4, 0x8a8d92), POLY = surf(0x121314, 0.7, 0, 0.9, 45, 0.15, 0x3c3c40), EARTH = surf(0x4c4333, 0.7, 0, 0.9, 45, 0.15, 0x7a6e58), BLADE = surf(0x9aa0a6, 0.28, 1, 0.2, 40);

function carbine() {       // the player's MK4, simplified
  const B = 0.045;
  return merge([
    finish(slab(fillet([[-0.07, 0.012], [0.135, 0.012], [0.135, 0.07], [-0.07, 0.07]], 0.004, 2), 0.032, 0.003, { seg: 1 }), STEEL),
    finish(slab([[0.05, 0.014], [0.105, 0.014], [0.118, -0.125], [0.07, -0.13]], 0.024, 0.003, { seg: 1 }), EARTH),
    finish(slab(fillet([[0, 0.014], [-0.036, 0.014], [-0.075, -0.085], [-0.04, -0.09]], 0.006, 2), 0.028, 0.005, { seg: 1 }), EARTH),
    finish(rod(0.021, 0.135, 0.42, 0, B, 8, 0.001), STEEL, 0.5), finish(slab([[-0.06, 0.068], [0.41, 0.068], [0.41, 0.078], [-0.06, 0.078]], 0.02, 0.001, { seg: 1 }), STEEL),
    finish(rod(0.009, 0.42, 0.56, 0, B, 8), STEEL), finish(rod(0.0115, 0.555, 0.6, 0, B, 8), STEEL),
    finish(rod(0.014, -0.24, -0.07, 0, B, 8), STEEL),
    finish(slab(fillet([[-0.12, 0.066], [-0.27, 0.066], [-0.276, -0.04], [-0.262, -0.046], [-0.15, 0.02], [-0.12, 0.02]], 0.005, 2), 0.036, 0.004, { seg: 1 }), EARTH),
    finish(slab(fillet([[0.02, 0.078], [0.09, 0.078], [0.09, 0.125], [0.036, 0.125], [0.02, 0.1]], 0.004, 2), 0.036, 0.003, { seg: 1 }), STEEL),
    finish(rod(0.013, 0.33, 0.43, -0.027, 0.07, 8), STEEL),
  ]);
}

function assaultRifle() {  // the gunman's rifle: stamped receiver, curved magazine, gas tube over the barrel
  const B = 0.045;
  return merge([
    finish(slab(fillet([[-0.09, 0.015], [0.13, 0.015], [0.13, 0.062], [0.06, 0.071], [-0.09, 0.071]], 0.004, 2), 0.034, 0.003, { seg: 1 }), STEEL),
    finish(slab([[0.045, 0.016], [0.1, 0.016], [0.135, -0.07], [0.175, -0.15], [0.127, -0.166], [0.086, -0.08]], 0.026, 0.003, { seg: 1 }), STEEL),
    finish(slab(fillet([[0.002, 0.016], [-0.034, 0.016], [-0.07, -0.085], [-0.036, -0.09]], 0.006, 2), 0.028, 0.005, { seg: 1 }), POLY),
    finish(slab(fillet([[0.13, 0.02], [0.32, 0.028], [0.32, 0.064], [0.13, 0.064]], 0.006, 2), 0.04, 0.007, { seg: 1 }), POLY),
    finish(rod(0.009, 0.13, 0.35, 0, 0.07, 8), STEEL), finish(rod(0.0085, 0.32, 0.56, 0, B, 8), STEEL), finish(rod(0.0115, 0.555, 0.6, 0, B, 8), STEEL),
    finish(slab([[0.34, 0.04], [0.362, 0.04], [0.362, 0.082], [0.34, 0.082]], 0.022, 0.003, { seg: 1 }), STEEL),
    finish(slab([[0.495, 0.045], [0.515, 0.045], [0.511, 0.096], [0.499, 0.096]], 0.012, 0.002, { seg: 1 }), STEEL),
    finish(slab([[-0.02, 0.071], [0.01, 0.071], [0.01, 0.086], [-0.02, 0.082]], 0.02, 0.002, { seg: 1 }), STEEL),
    finish(slab(fillet([[-0.09, 0.066], [-0.3, 0.05], [-0.31, -0.045], [-0.29, -0.05], [-0.09, 0.02]], 0.006, 2), 0.034, 0.005, { seg: 1 }), POLY),
  ]);
}

function machineGun(sc) {  // the heavy's belt-fed: feed cover, ammunition box, carry handle, bipod folded under the barrel
  const B = 0.05, m = 0.6 * sc;
  return merge([
    finish(slab(fillet([[-0.12, 0.008], [0.2, 0.008], [0.2, 0.086], [0.05, 0.096], [-0.12, 0.09]], 0.005, 2), 0.05, 0.004, { seg: 1 }), STEEL),
    finish(rbox(0.09, 0.11, 0.13, 0.012, 1).translate(-0.03, -0.05, -0.1), surf(0x2b3028, 0.75, 0, 0.8, 45, 0.2, 0x6d7466)),
    finish(slab(fillet([[0.004, 0.01], [-0.034, 0.01], [-0.066, -0.09], [-0.03, -0.095]], 0.006, 2), 0.03, 0.005, { seg: 1 }), POLY),
    finish(slab(fillet([[0.2, 0.012], [0.42, 0.02], [0.42, 0.074], [0.2, 0.08]], 0.006, 2), 0.05, 0.008, { seg: 1 }), POLY),
    finish(rod(0.012, 0.2, m - 0.04, 0, B, 8), STEEL), finish(rod(0.015, m - 0.045, m, 0, B, 8), STEEL), finish(rod(0.009, 0.2, 0.47, 0, 0.022, 6), STEEL),
    finish(slab([[0.24, 0.086], [0.36, 0.086], [0.36, 0.118], [0.33, 0.126], [0.27, 0.126], [0.24, 0.118]], 0.014, 0.003, { seg: 1, holes: [[[0.262, 0.096], [0.338, 0.096], [0.338, 0.112], [0.262, 0.112]]] }), STEEL),
    ...[-1, 1].map((sx) => finish(rod(0.005, 0.24, 0.5, sx * 0.02, 0.006, 6), STEEL)),
    finish(slab(fillet([[-0.12, 0.084], [-0.33, 0.07], [-0.34, -0.04], [-0.31, -0.045], [-0.12, 0.012]], 0.007, 2), 0.04, 0.005, { seg: 1, holes: [fillet([[-0.16, 0.06], [-0.3, 0.05], [-0.305, -0.015], [-0.16, 0.03]], 0.008, 2)] }), POLY),
  ]);
}

function machete() {
  return merge([
    finish(slab(fillet([[0.075, -0.02], [0.5, -0.03], [0.572, 0.002], [0.56, 0.03], [0.5, 0.034], [0.075, 0.022]], 0.006, 2), 0.004, 0.0018, { seg: 1 }), BLADE),
    finish(rbox(0.014, 0.062, 0.014, 0.004, 1).translate(0, 0.001, -0.075), STEEL),
    finish(loftY([{ y: -0.07, a: 0.014, b: 0.019 }, { y: 0, a: 0.015, b: 0.02 }, { y: 0.07, a: 0.013, b: 0.018 }], 8, { domeA: 0.5, domeB: 0.3 }).rotateX(Math.PI / 2), POLY, 1.2),
  ]);
}

// 16 part geometries (indexed by SEG) and the carried weapon for one character type.
export function buildBody(kind, def, palette) {
  const st = STYLE[kind], S = surfaces(palette, st), sc = def.scale, R = (i) => segRadius(i, def), B = torso(def), parts = new Array(SEG_COUNT);
  parts[SEG.HEAD] = head(R(SEG.HEAD), S, st);
  parts[SEG.NECK] = neck(R(SEG.NECK), 0.06 * sc, S, st);
  parts[SEG.CHEST] = chest(B, S, st);
  parts[SEG.STOMACH] = stomach(B, S, st);
  for (const [u, l, h, side] of [[SEG.UARM_L, SEG.LARM_L, SEG.HAND_L, -1], [SEG.UARM_R, SEG.LARM_R, SEG.HAND_R, 1]]) {
    parts[u] = upperArm(R(u), BONE.uarm * sc, S, st, side); parts[l] = foreArm(R(l), BONE.larm * sc, S, st, side); parts[h] = hand(R(h), S, side);
  }
  for (const [u, l, f, side] of [[SEG.ULEG_L, SEG.LLEG_L, SEG.FOOT_L, -1], [SEG.ULEG_R, SEG.LLEG_R, SEG.FOOT_R, 1]]) {
    parts[u] = thigh(R(u), BONE.uleg * sc, S, st, side); parts[l] = shin(R(l), BONE.lleg * sc, S, st); parts[f] = foot(R(f), BONE.foot * sc, sc, S);
  }
  const weapon = def.melee ? machete() : kind === 'heavy' ? machineGun(sc) : kind === 'player' ? carbine() : assaultRifle();
  return { parts, weapon };
}
