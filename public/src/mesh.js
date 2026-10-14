// Modelling toolkit. The rifle and the characters are still built in code, but from real
// profiles - bevelled extrusions, lathes and lofted sections - instead of boxes and capsules.
// Every part ends in finish(), which gives it face-weighted normals (flat faces stay flat,
// bevels carry the highlight), box-projected UVs for the tiling detail maps, and the
// per-vertex colour / roughness / metalness the surface material reads.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V2 = (p) => new THREE.Vector2(p[0], p[1]);

// ------------------------------------------------------------------ surfaces
// color: base colour · rough / metal: PBR terms · detail: strength of the tiling normal map
// uv: repeats per metre · wear: how much exposed edges brighten and polish
export function surf(color, rough = 0.6, metal = 0, detail = 1, uv = 30, wear = 0, wearColor = 0x9a9ca0) {
  return { color: new THREE.Color(color), rough, metal, detail, uv, wear, wearColor: new THREE.Color(wearColor) };
}

// Give a raw geometry its shading attributes. `crease` is the largest angle (radians) that is
// still smoothed over; anything sharper stays a hard edge. A `tint` attribute (see skin) is
// multiplied into the colour.
export function finish(geo, s, crease = 0.87) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const tint = g.attributes.tint ? g.attributes.tint.array : null;
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.clearGroups();
  const pos = g.attributes.position.array, n = pos.length / 3, tris = n / 3;
  const fn = new Float32Array(tris * 3), area = new Float32Array(tris);
  for (let f = 0; f < tris; f++) {
    const k = f * 9;
    const ux = pos[k + 3] - pos[k], uy = pos[k + 4] - pos[k + 1], uz = pos[k + 5] - pos[k + 2];
    const vx = pos[k + 6] - pos[k], vy = pos[k + 7] - pos[k + 1], vz = pos[k + 8] - pos[k + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    area[f] = l;
    if (l > 1e-14) { fn[f * 3] = nx / l; fn[f * 3 + 1] = ny / l; fn[f * 3 + 2] = nz / l; } else fn[f * 3 + 1] = 1;
  }

  // corners that share a position
  const head = new Map(), next = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const key = Math.round(pos[i * 3] * 2e5) + ',' + Math.round(pos[i * 3 + 1] * 2e5) + ',' + Math.round(pos[i * 3 + 2] * 2e5);
    const h = head.get(key);
    if (h !== undefined) next[i] = h;
    head.set(key, i);
  }

  const nor = new Float32Array(n * 3), cosT = Math.cos(crease), group = [];
  for (const first of head.values()) {
    group.length = 0;
    for (let i = first; i >= 0; i = next[i]) group.push(i);
    for (const a of group) {
      const fa = (a / 3) | 0, ax = fn[fa * 3], ay = fn[fa * 3 + 1], az = fn[fa * 3 + 2];
      let x = 0, y = 0, z = 0;
      for (const b of group) {
        const fb = (b / 3) | 0, bx = fn[fb * 3], by = fn[fb * 3 + 1], bz = fn[fb * 3 + 2];
        if (ax * bx + ay * by + az * bz >= cosT) { const w = area[fb]; x += bx * w; y += by * w; z += bz * w; }
      }
      const l = Math.hypot(x, y, z);
      if (l > 1e-20) { nor[a * 3] = x / l; nor[a * 3 + 1] = y / l; nor[a * 3 + 2] = z / l; } else { nor[a * 3] = ax; nor[a * 3 + 1] = ay; nor[a * 3 + 2] = az; }
    }
  }

  const uv = new Float32Array(n * 2), col = new Float32Array(n * 3), sf = new Float32Array(n * 3);
  const c = s.color, wc = s.wearColor;
  for (let f = 0; f < tris; f++) {
    const nx = Math.abs(fn[f * 3]), ny = Math.abs(fn[f * 3 + 1]), nz = Math.abs(fn[f * 3 + 2]);
    const ax = nx >= ny && nx >= nz ? 0 : ny >= nz ? 1 : 2;
    const cx = (pos[f * 9] + pos[f * 9 + 3] + pos[f * 9 + 6]) / 3, cy = (pos[f * 9 + 1] + pos[f * 9 + 4] + pos[f * 9 + 7]) / 3, cz = (pos[f * 9 + 2] + pos[f * 9 + 5] + pos[f * 9 + 8]) / 3;
    for (let k = 0; k < 3; k++) {
      const i = f * 3 + k, px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      uv[i * 2] = (ax === 0 ? pz : px) * s.uv; uv[i * 2 + 1] = (ax === 1 ? pz : py) * s.uv;
      // bevels are where the smoothed normal leaves the face normal: convex ones wear bright, concave ones collect dirt
      let w = 0, dark = tint ? tint[i] : 1;
      if (s.wear > 0) {
        const dx = nor[i * 3] - fn[f * 3], dy = nor[i * 3 + 1] - fn[f * 3 + 1], dz = nor[i * 3 + 2] - fn[f * 3 + 2];
        const dev = Math.min(1, (dx * dx + dy * dy + dz * dz) * 2.2), convex = dx * (px - cx) + dy * (py - cy) + dz * (pz - cz) > 0;
        if (convex) w = dev * s.wear; else dark *= 1 - dev * 0.5;
      }
      col[i * 3] = (c.r + (wc.r - c.r) * w) * dark; col[i * 3 + 1] = (c.g + (wc.g - c.g) * w) * dark; col[i * 3 + 2] = (c.b + (wc.b - c.b) * w) * dark;
      sf[i * 3] = s.rough * (1 - 0.35 * w); sf[i * 3 + 1] = s.metal + (1 - s.metal) * w * 0.6; sf[i * 3 + 2] = s.detail;
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('surf', new THREE.BufferAttribute(sf, 3));
  return g;
}

export const merge = (list) => mergeGeometries(list.flat(Infinity).filter(Boolean));

// Multiply vertex colours by fn(x, y, z) - hand-placed occlusion in recesses.
export function shade(g, fn) {
  const p = g.attributes.position.array, c = g.attributes.color.array;
  for (let i = 0; i < p.length; i += 3) { const k = fn(p[i], p[i + 1], p[i + 2]); c[i] *= k; c[i + 1] *= k; c[i + 2] *= k; }
  return g;
}

// MeshStandardMaterial that takes roughness, metalness and normal-map strength per vertex
// (the `surf` attribute written by finish), so one draw call can mix cloth, polymer and steel.
export function surfaceMaterial({ normalMap = null, roughnessMap = null, normalScale = 1, envMapIntensity = 1 } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, normalMap, roughnessMap, envMapIntensity });
  m.normalScale.setScalar(normalScale);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 surf;\nvarying vec3 vSurf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = surf;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurf;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vSurf.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vSurf.y;')
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * vSurf.z;'));
  };
  m.customProgramCacheKey = () => 'surf';
  return m;
}

// ------------------------------------------------------------------ profiles
// Round the corners of a closed polygon. Points are [x, y] or [x, y, r] to override the radius
// for that corner (0 keeps it sharp).
export function fillet(pts, radius = 0, steps = 3) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n], r = p[2] ?? radius;
    let ax = a[0] - p[0], ay = a[1] - p[1], bx = b[0] - p[0], by = b[1] - p[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (!(r > 0) || la < 1e-9 || lb < 1e-9) { out.push([p[0], p[1]]); continue; }
    ax /= la; ay /= la; bx /= lb; by /= lb;
    const half = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by))) / 2;
    const d = Math.min(r / Math.tan(half), la * 0.45, lb * 0.45);
    if (!(d > 1e-7)) { out.push([p[0], p[1]]); continue; }
    const sx = p[0] + ax * d, sy = p[1] + ay * d, ex = p[0] + bx * d, ey = p[1] + by * d;
    for (let k = 0; k <= steps; k++) { const t = k / steps, u = 1 - t; out.push([u * u * sx + 2 * u * t * p[0] + t * t * ex, u * u * sy + 2 * u * t * p[1] + t * t * ey]); }
  }
  return out;
}

export function arc(cx, cy, r, a0, a1, steps = 8) {
  const out = [];
  for (let k = 0; k <= steps; k++) { const a = a0 + (a1 - a0) * k / steps; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

export const rect = (x0, y0, x1, y1, r = 0, steps = 3) => fillet([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], r, steps);

// Stadium-shaped slot, long axis along x.
export function slot(cx, cy, len, w, steps = 4) {
  const r = w / 2, h = len / 2 - r;
  return [...arc(cx + h, cy, r, -Math.PI / 2, Math.PI / 2, steps), ...arc(cx - h, cy, r, Math.PI / 2, Math.PI * 1.5, steps)];
}

// ------------------------------------------------------------------ extrusions
// Extrude a closed outline through `depth`, centred on z. A bevel rounds every edge of both
// faces (and of any holes) without growing the outline.
function extrude(pts, depth, bevel = 0, holes = null, seg = 2) {
  const shape = new THREE.Shape(pts.map(V2));
  if (holes) for (const h of holes) shape.holes.push(new THREE.Path(h.map(V2)));
  const b = Math.min(bevel, depth * 0.45);
  if (!(b > 0)) return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1, steps: 1 }).translate(0, 0, -depth / 2);
  return new THREE.ExtrudeGeometry(shape, { depth: depth - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: seg, curveSegments: 1, steps: 1 }).translate(0, 0, b - depth / 2);
}

// The three ways a profile gets used. `s` is distance forward along the bore (so z = -s).
//   slab:  side view  [s, y] extruded across the width (x)
//   bar:   cross-section [x, y] extruded along the bore from s0 to s1
//   plate: top view   [x, s] extruded vertically from y0 to y1
export const slab = (pts, width, bevel = 0.0006, { x = 0, holes = null, seg = 2 } = {}) => extrude(pts, width, bevel, holes, seg).rotateY(Math.PI / 2).translate(x, 0, 0);
export const bar = (pts, s0, s1, bevel = 0, { holes = null, seg = 2 } = {}) => extrude(pts, Math.abs(s1 - s0), bevel, holes, seg).translate(0, 0, -(s0 + s1) / 2);
export const plate = (pts, y0, y1, bevel = 0, { holes = null, seg = 2 } = {}) => extrude(pts, Math.abs(y1 - y0), bevel, holes, seg).rotateX(-Math.PI / 2).translate(0, (y0 + y1) / 2, 0);

// Box with every edge rounded, centred on the origin.
export function rbox(w, h, d, r = 0.001, seg = 2) {
  const rr = Math.min(r, w * 0.49, h * 0.49, d * 0.45);
  return extrude(rect(-w / 2, -h / 2, w / 2, h / 2, rr, seg + 1), d, rr, null, seg);
}

// ------------------------------------------------------------------ lathes
// Make a closed mesh face outwards (signed volume), whatever order it was built in.
export function outward(g) {
  const p = g.attributes.position.array, ix = g.index ? g.index.array : null, n = ix ? ix.length : p.length / 3;
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  let vol = 0;
  for (let i = 0; i < n; i += 3) {
    const a = (ix ? ix[i] : i) * 3, b = (ix ? ix[i + 1] : i + 1) * 3, d = (ix ? ix[i + 2] : i + 2) * 3;
    const ax = p[a] - c.x, ay = p[a + 1] - c.y, az = p[a + 2] - c.z, bx = p[b] - c.x, by = p[b + 1] - c.y, bz = p[b + 2] - c.z, dx = p[d] - c.x, dy = p[d + 1] - c.y, dz = p[d + 2] - c.z;
    vol += ax * (by * dz - bz * dy) + ay * (bz * dx - bx * dz) + az * (bx * dy - by * dx);
  }
  if (vol < 0) {
    if (ix) for (let i = 0; i < n; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    else for (let i = 0; i < n; i += 3) for (let k = 0; k < 3; k++) { const t = p[(i + 1) * 3 + k]; p[(i + 1) * 3 + k] = p[(i + 2) * 3 + k]; p[(i + 2) * 3 + k] = t; }
  }
  return g;
}

// Revolve a closed profile [radius, s] around the bore direction, centred on (x, y).
export const lathe = (pts, seg = 20, x = 0, y = 0) => outward(new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(Math.max(0, p[0]), p[1])), seg).rotateX(-Math.PI / 2).translate(x, y, 0));

// Solid rod along the bore from s0 to s1, ends chamfered.
export const rod = (r, s0, s1, x = 0, y = 0, seg = 16, ch = 0.0004) => lathe([[0, s0], [r - ch, s0], [r, s0 + ch], [r, s1 - ch], [r - ch, s1], [0, s1]], seg, x, y);
// Hollow tube along the bore.
export const tube = (ro, ri, s0, s1, x = 0, y = 0, seg = 16, ch = 0.0004) => lathe([[ri, s0], [ro - ch, s0], [ro, s0 + ch], [ro, s1 - ch], [ro - ch, s1], [ri, s1], [ri, s0]], seg, x, y);
// Rod across the width, from x0 to x1 at height y and station s (pins, bolts, battery caps).
export const pin = (r, x0, x1, y, s, seg = 14, ch = 0.0003) => rod(r, 0, x1 - x0, 0, 0, seg, ch).rotateY(-Math.PI / 2).translate(x0, y, -s);

// ------------------------------------------------------------------ lofts
const pw = (v, e) => (v < 0 ? -Math.pow(-v, e) : Math.pow(v, e));

// Smooth curve through keys [x, v1, v2, ...]; `col` picks which value (limb and sleeve profiles).
export function spline(x, k, col = 1) {
  let i = 1;
  while (i < k.length - 1 && x > k[i][0]) i++;
  const a = k[i - 1], b = k[i], p = k[Math.max(0, i - 2)], q = k[Math.min(k.length - 1, i + 1)], w = b[0] - a[0];
  const u = Math.min(1, Math.max(0, (x - a[0]) / w)), u2 = u * u, u3 = u2 * u;
  const m0 = (b[col] - p[col]) / (b[0] - p[0]) * w, m1 = (q[col] - a[col]) / (q[0] - a[0]) * w;
  return (2 * u3 - 3 * u2 + 1) * a[col] + (u3 - 2 * u2 + u) * m0 + (3 * u2 - 2 * u3) * b[col] + (u3 - u2) * m1;
}

// Skin a row of cross-sections. Each ring: { c, u, v, t, a, a2, b, b2, n } - centre, the two
// section axes, the direction of travel, half-sizes along +u / -u / +v / -v, and the
// superellipse exponent (2 = ellipse, higher = boxier). `dome` rounds off an end. `mod` scales
// the section and `tint` shades it, both as fn(ring index, angle, ring) - folds and the
// shadow inside them.
function skin(rings, seg, { domeA = 1, domeB = 1, mod = null, tint = null } = {}) {
  const all = [];
  const cap = (r, dir, dome) => {
    const list = [], h = Math.min(r.a, r.a2 ?? r.a, r.b, r.b2 ?? r.b) * dome;
    if (dome > 0) for (const ang of [0.55, 1.05]) {
      const k = Math.cos(ang), o = Math.sin(ang) * h * dir;
      list.push({ ...r, c: [r.c[0] + r.t[0] * o, r.c[1] + r.t[1] * o, r.c[2] + r.t[2] * o], a: r.a * k, a2: (r.a2 ?? r.a) * k, b: r.b * k, b2: (r.b2 ?? r.b) * k, n: 2 + ((r.n || 2) - 2) * k });
    }
    return { list, tip: [r.c[0] + r.t[0] * h * dir, r.c[1] + r.t[1] * h * dir, r.c[2] + r.t[2] * h * dir] };
  };
  const A = cap(rings[0], -1, domeA), B = cap(rings[rings.length - 1], 1, domeB);
  all.push(...A.list.reverse(), ...rings, ...B.list);

  const R = all.length, pos = new Float32Array((R * seg + 2) * 3), idx = [], tn = tint ? new Float32Array(R * seg + 2).fill(1) : null;
  for (let i = 0; i < R; i++) {
    const r = all[i], e = 2 / (r.n || 2);
    for (let j = 0; j < seg; j++) {
      const th = j / seg * Math.PI * 2, cs = pw(Math.cos(th), e), sn = pw(Math.sin(th), e);
      const k = mod ? mod(i - A.list.length, th, r) : 1;
      const x = cs * (cs >= 0 ? r.a : r.a2 ?? r.a) * k, y = sn * (sn >= 0 ? r.b : r.b2 ?? r.b) * k, o = (i * seg + j) * 3;
      pos[o] = r.c[0] + r.u[0] * x + r.v[0] * y; pos[o + 1] = r.c[1] + r.u[1] * x + r.v[1] * y; pos[o + 2] = r.c[2] + r.u[2] * x + r.v[2] * y;
      if (tn) tn[i * seg + j] = tint(i - A.list.length, th, r);
    }
  }
  const ta = R * seg, tb = ta + 1;
  pos.set(A.tip, ta * 3); pos.set(B.tip, tb * 3);
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + (j + 1) % seg, c = a + seg, d = b + seg;
    idx.push(a, c, b, b, c, d);
  }
  for (let j = 0; j < seg; j++) { idx.push(ta, j, (j + 1) % seg, tb, (R - 1) * seg + (j + 1) % seg, (R - 1) * seg + j); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
  if (tn) g.setAttribute('tint', new THREE.BufferAttribute(tn, 1));
  return outward(g);
}

// Loft straight up the local Y axis. Rings: { y, a, b, bf, x, z, n } - half-width, half-depth
// towards the back (+z) and, if different, towards the front (bf, -z).
export function loftY(rings, seg = 12, opts = {}) {
  return skin(rings.map((r) => ({ c: [r.x || 0, r.y, r.z || 0], u: [1, 0, 0], v: [0, 0, 1], t: [0, 1, 0], a: r.a, a2: r.a2, b: r.b ?? r.a, b2: r.bf ?? r.b ?? r.a, n: r.n })), seg, opts);
}

// Sweep a section along a path of { p: [x, y, z], a, a2, b, b2, n } points (fingers, sleeves, straps).
// `up` picks which way the section's v axis leans at the start; frames are then carried along.
export function sweep(path, seg = 10, { up = [0, 1, 0], ...opts } = {}) {
  const n = path.length, rings = [];
  let u = new THREE.Vector3(...up);
  const t = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)].p, b = path[Math.min(n - 1, i + 1)].p;
    t.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    u.addScaledVector(t, -u.dot(t));
    if (u.lengthSq() < 1e-8) u.set(1, 0, 0).addScaledVector(t, -t.x);
    u.normalize(); v.crossVectors(t, u);
    const q = path[i];
    rings.push({ c: q.p, u: [v.x, v.y, v.z], v: [u.x, u.y, u.z], t: [t.x, t.y, t.z], a: q.a, a2: q.a2, b: q.b ?? q.a, b2: q.b2, n: q.n });
  }
  return skin(rings, seg, opts);
}

// Tube through a chain of joints [x, y, z]: straight bones with a rounded bend at each joint and
// a slight swell over it (fingers and thumbs). radii: one per joint; steps: sections per bend;
// mid: extra sections along each bone. `mod` and `tint` shape and shade the section as
// fn(q, angle), q counting joints along the chain (1.5 = half-way down the second bone).
export function jointed(joints, radii, seg = 10, { bend = 0.011, swell = 0.07, steps = 4, mid = 0, mod = null, tint = null, ...opts } = {}) {
  const P = joints.map((p) => new THREE.Vector3(p[0], p[1], p[2])), last = P.length - 1, path = [], qs = [];
  const rad = (q) => {
    const i = Math.min(last - 1, Math.max(0, Math.floor(q))), j = Math.round(q), d = (q - j) * 5;
    return (radii[i] + (radii[i + 1] - radii[i]) * (q - i)) * (1 + (j > 0 && j < last ? swell * Math.exp(-d * d) : 0));
  };
  const put = (p, q) => { path.push({ p: [p.x, p.y, p.z], a: rad(q) }); qs.push(q); };
  const straight = (from, q0, to, q1) => { for (let m = 1; m <= mid; m++) put(from.clone().lerp(to, m / (mid + 1)), q0 + (q1 - q0) * m / (mid + 1)); };
  put(P[0], 0);
  let from = P[0], q0 = 0;
  for (let i = 1; i < last; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1], ka = Math.min(0.32, bend / a.distanceTo(b)), kc = Math.min(0.32, bend / b.distanceTo(c));
    const p0 = b.clone().lerp(a, ka), p1 = b.clone().lerp(c, kc);
    straight(from, q0, p0, i - ka);
    for (let j = 0; j <= steps; j++) {
      const t = j / steps, u = 1 - t;
      put(p0.clone().multiplyScalar(u * u).addScaledVector(b, 2 * u * t).addScaledVector(p1, t * t), i + (t < 0.5 ? -ka * (1 - 2 * t) : kc * (2 * t - 1)));
    }
    from = p1; q0 = i + kc;
  }
  straight(from, q0, P[last], last);
  put(P[last], last);
  const at = (i) => qs[Math.max(0, Math.min(qs.length - 1, i))];
  return sweep(path, seg, { ...opts, mod: mod && ((i, th) => mod(at(i), th)), tint: tint && ((i, th) => tint(at(i), th)) });
}
