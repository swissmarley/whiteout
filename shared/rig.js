// Procedural humanoid rig. One pure function turns a replicated state row into 16 world-space
// capsules. The client skins its character meshes onto these capsules; the server rewinds the
// same state and ray-tests the same capsules. So the thing you see IS the hitbox - limbs,
// walk cycle, crouch, aim pose and all.

import { rayCapsule } from './collide.js';

export const SEG = {
  HEAD: 0, NECK: 1, CHEST: 2, STOMACH: 3,
  UARM_L: 4, LARM_L: 5, HAND_L: 6, UARM_R: 7, LARM_R: 8, HAND_R: 9,
  ULEG_L: 10, LLEG_L: 11, FOOT_L: 12, ULEG_R: 13, LLEG_R: 14, FOOT_R: 15,
};
export const SEG_COUNT = 16;
export const SEG_GROUP = ['head', 'chest', 'chest', 'stomach', 'arm', 'arm', 'arm', 'arm', 'arm', 'arm', 'leg', 'leg', 'leg', 'leg', 'leg', 'leg'];
export const SEG_RADIUS = [0.118, 0.062, 0.168, 0.152, 0.052, 0.045, 0.05, 0.052, 0.045, 0.05, 0.08, 0.06, 0.05, 0.08, 0.06, 0.05];
const BULK_EXP = [0.3, 0.6, 1, 1, 1, 1, 0.5, 1, 1, 0.5, 1, 1, 0.5, 1, 1, 0.5];
export const BONE = { uarm: 0.29, larm: 0.27, uleg: 0.44, lleg: 0.43, foot: 0.17, chestHalf: 0.085, stomachHalf: 0.062 };

export function segRadius(i, def) { return SEG_RADIUS[i] * Math.pow(def.bulk, BULK_EXP[i]) * def.scale; }

export function makeRig() {
  return {
    a: new Float64Array(SEG_COUNT * 3), b: new Float64Array(SEG_COUNT * 3), r: new Float64Array(SEG_COUNT),
    cx: 0, cy: 0, cz: 0, bound: 1.3,
    chest: [0, 0, 0], head: [0, 0, 0], grip: [0, 0, 0], wdir: [0, 0, -1], muzzle: [0, 0, 0],
    lean: 0, yaw: 0, pitch: 0,
  };
}

// local joint slots (r = right, u = up, f = forward)
const PELVIS = 0, STOM = 1, CHEST = 2, SHC = 3, NECK = 4, HEAD = 5, SHL = 6, SHR = 7, HIPL = 8, HIPR = 9,
  ELL = 10, ELR = 11, HAL = 12, HAR = 13, KNL = 14, KNR = 15, ANL = 16, ANR = 17, TOEL = 18, TOER = 19,
  CHL = 20, CHR = 21, STL = 22, STR = 23, GRIP = 24, MUZ = 25;
const L = new Float64Array(26 * 3);

function set(i, r, u, f) { L[i * 3] = r; L[i * 3 + 1] = u; L[i * 3 + 2] = f; }

// Two-bone IK in local space. Writes the mid joint and clamps the end joint to reach.
function ik2(ia, it, ij, l1, l2, pr, pu, pf) {
  const ax = L[ia * 3], ay = L[ia * 3 + 1], az = L[ia * 3 + 2];
  let dx = L[it * 3] - ax, dy = L[it * 3 + 1] - ay, dz = L[it * 3 + 2] - az;
  let d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) { dx = 0; dy = -1; dz = 0; d = 1; }
  const nx = dx / d, ny = dy / d, nz = dz / d;
  const dd = Math.min((l1 + l2) * 0.999, Math.max(Math.abs(l1 - l2) + 0.01, d));
  const a1 = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a1 * a1));
  const dot = pr * nx + pu * ny + pf * nz;
  let qx = pr - nx * dot, qy = pu - ny * dot, qz = pf - nz * dot;
  let ql = Math.hypot(qx, qy, qz);
  if (ql < 1e-5) { qx = 1; qy = 0; qz = 0; ql = 1; }
  qx /= ql; qy /= ql; qz /= ql;
  set(ij, ax + nx * a1 + qx * h, ay + ny * a1 + qy * h, az + nz * a1 + qz * h);
  set(it, ax + nx * dd, ay + ny * dd, az + nz * dd);
}

const mix = (a, b, t) => a + (b - a) * t;

// s: { x,y,z, yaw, pitch, ph, mv, cr, aim, atk }   def: { scale, bulk, stride, melee }
export function computeRig(s, def, o) {
  const sc = def.scale, melee = def.melee;
  const mv = s.mv, cr = s.cr, ph = s.ph, aim = s.aim;
  const sinP = Math.sin(ph), cosP = Math.cos(ph);

  const lean = 0.08 * mv + 0.30 * cr + (melee ? 0.24 * mv : 0.06 * aim);
  const sl = Math.sin(lean), cl = Math.cos(lean);
  const hipH = 0.93 - 0.50 * cr - 0.03 * mv + Math.abs(sinP) * 0.035 * mv;

  // spine
  set(PELVIS, 0, hipH, 0);
  set(STOM, 0, hipH + 0.13 * cl, 0.13 * sl);
  set(CHEST, 0, hipH + 0.38 * cl, 0.38 * sl);
  set(SHC, 0, hipH + 0.50 * cl, 0.50 * sl);
  set(NECK, 0, hipH + 0.56 * cl, 0.56 * sl);
  const hl = lean * 0.45;
  set(HEAD, 0, L[NECK * 3 + 1] + 0.135 * Math.cos(hl), L[NECK * 3 + 2] + 0.135 * Math.sin(hl) + 0.01);
  const shU = L[SHC * 3 + 1], shF = L[SHC * 3 + 2];
  set(SHL, -0.2, shU - 0.015, shF);
  set(SHR, 0.2, shU - 0.015, shF);
  set(HIPL, -0.095, hipH - 0.02, 0);
  set(HIPR, 0.095, hipH - 0.02, 0);
  set(CHL, -BONE.chestHalf, L[CHEST * 3 + 1], L[CHEST * 3 + 2]);
  set(CHR, BONE.chestHalf, L[CHEST * 3 + 1], L[CHEST * 3 + 2]);
  set(STL, -BONE.stomachHalf, L[STOM * 3 + 1], L[STOM * 3 + 2]);
  set(STR, BONE.stomachHalf, L[STOM * 3 + 1], L[STOM * 3 + 2]);

  // legs: feet follow a planted-then-swing cycle, knees solved by IK
  const S = def.stride * mv, lift = (melee ? 0.2 : 0.13) * mv, still = 1 - mv;
  const spread = 0.105 + 0.05 * cr;
  set(ANL, -spread, 0.09 + lift * Math.max(0, cosP), S * sinP + still * (0.10 * aim + 0.16 * cr));
  set(ANR, spread, 0.09 + lift * Math.max(0, -cosP), -S * sinP - still * (0.08 * aim + 0.22 * cr));
  ik2(HIPL, ANL, KNL, BONE.uleg, BONE.lleg, -0.15, 0.1, 1);
  ik2(HIPR, ANR, KNR, BONE.uleg, BONE.lleg, 0.15, 0.1, 1);
  set(TOEL, L[ANL * 3], Math.max(0.035, L[ANL * 3 + 1] - 0.045), L[ANL * 3 + 2] + BONE.foot);
  set(TOER, L[ANR * 3], Math.max(0.035, L[ANR * 3 + 1] - 0.045), L[ANR * 3 + 2] + BONE.foot);

  // arms + weapon
  let wr, wu, wf;
  if (!melee) {
    const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
    wr = mix(-0.38, 0, aim); wu = mix(-0.42, sp, aim); wf = mix(0.82, cp, aim);
    const wl = Math.hypot(wr, wu, wf); wr /= wl; wu /= wl; wf /= wl;
    const swing = Math.sin(ph * 2) * 0.015 * mv;
    const gr = mix(0.13, 0.10, aim);
    const gu = mix(L[STOM * 3 + 1] + 0.10 + swing, shU - 0.065 + sp * 0.18, aim);
    const gf = mix(L[STOM * 3 + 2] + 0.24, shF + 0.20 * cp, aim);
    set(GRIP, gr, gu, gf);
    set(HAR, gr, gu, gf);
    set(HAL, gr + wr * 0.27 - 0.04, gu + wu * 0.27 + 0.01, gf + wf * 0.27);
    ik2(SHR, HAR, ELR, BONE.uarm, BONE.larm, 0.6, -1, -0.3);
    ik2(SHL, HAL, ELL, BONE.uarm, BONE.larm, -0.7, -0.9, 0.1);
    set(MUZ, gr + wr * 0.60, gu + wu * 0.60 + 0.045, gf + wf * 0.60);
  } else {
    const k = s.atk;
    // base carry -> wind-up over the shoulder -> strike forward and down
    const br = 0.25, bu = shU - 0.47 + 0.1 * mv, bf = shF + 0.06 + 0.24 * sinP * mv;
    const ur = 0.24, uu = shU + 0.22, uf = shF - 0.10;
    const hr = -0.02, hu = shU - 0.18, hf = shF + 0.50;
    let pr, pu, pf, dr, du, df;
    if (k <= 0) { pr = br; pu = bu; pf = bf; dr = 0.1; du = 0.75; df = 0.65; }
    else if (k < 0.35) { const t = k / 0.35; pr = mix(br, ur, t); pu = mix(bu, uu, t); pf = mix(bf, uf, t); dr = 0.1; du = mix(0.75, 0.9, t); df = mix(0.65, -0.4, t); }
    else if (k < 0.6) { const t = (k - 0.35) / 0.25; pr = mix(ur, hr, t); pu = mix(uu, hu, t); pf = mix(uf, hf, t); dr = mix(0.1, -0.2, t); du = mix(0.9, -0.25, t); df = mix(-0.4, 0.94, t); }
    else { const t = (k - 0.6) / 0.4; pr = mix(hr, br, t); pu = mix(hu, bu, t); pf = mix(hf, bf, t); dr = mix(-0.2, 0.1, t); du = mix(-0.25, 0.75, t); df = mix(0.94, 0.65, t); }
    const dl = Math.hypot(dr, du, df); wr = dr / dl; wu = du / dl; wf = df / dl;
    set(HAR, pr, pu, pf);
    set(HAL, -0.25, shU - 0.47 + 0.1 * mv, shF + 0.06 - 0.24 * sinP * mv);
    ik2(SHR, HAR, ELR, BONE.uarm, BONE.larm, 0.35, -0.3, -1);
    ik2(SHL, HAL, ELL, BONE.uarm, BONE.larm, -0.35, -0.3, -1);
    set(GRIP, L[HAR * 3], L[HAR * 3 + 1], L[HAR * 3 + 2]);
    set(MUZ, L[HAR * 3] + wr * 0.6, L[HAR * 3 + 1] + wu * 0.6, L[HAR * 3 + 2] + wf * 0.6);
  }

  // local -> world
  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
  const Fx = -sy, Fz = -cy, Rx = cy, Rz = -sy;
  const A = o.a, Bv = o.b;
  const put = (arr, k, j) => {
    const r = L[j * 3], u = L[j * 3 + 1], f = L[j * 3 + 2];
    arr[k] = s.x + (Rx * r + Fx * f) * sc;
    arr[k + 1] = s.y + u * sc;
    arr[k + 2] = s.z + (Rz * r + Fz * f) * sc;
  };
  const seg = (i, ja, jb) => { put(A, i * 3, ja); put(Bv, i * 3, jb); o.r[i] = segRadius(i, def); };
  seg(SEG.HEAD, HEAD, HEAD);
  seg(SEG.NECK, SHC, NECK);
  seg(SEG.CHEST, CHL, CHR);
  seg(SEG.STOMACH, STL, STR);
  seg(SEG.UARM_L, SHL, ELL); seg(SEG.LARM_L, ELL, HAL); seg(SEG.HAND_L, HAL, HAL);
  seg(SEG.UARM_R, SHR, ELR); seg(SEG.LARM_R, ELR, HAR); seg(SEG.HAND_R, HAR, HAR);
  seg(SEG.ULEG_L, HIPL, KNL); seg(SEG.LLEG_L, KNL, ANL); seg(SEG.FOOT_L, ANL, TOEL);
  seg(SEG.ULEG_R, HIPR, KNR); seg(SEG.LLEG_R, KNR, ANR); seg(SEG.FOOT_R, ANR, TOER);

  put(o.chest, 0, CHEST); put(o.head, 0, HEAD); put(o.grip, 0, GRIP); put(o.muzzle, 0, MUZ);
  o.wdir[0] = Rx * wr + Fx * wf; o.wdir[1] = wu; o.wdir[2] = Rz * wr + Fz * wf;
  o.lean = lean; o.yaw = s.yaw; o.pitch = s.pitch;
  o.cx = s.x; o.cy = s.y + 0.9 * sc; o.cz = s.z; o.bound = 1.35 * sc;
  return o;
}

const res = { t: -1, seg: -1 };

// Nearest capsule hit along a ray. `pad` inflates every capsule (used only for the
// favour-the-shooter tolerance check on the server).
export function rayRig(rig, ox, oy, oz, dx, dy, dz, maxT, pad = 0) {
  res.t = -1; res.seg = -1;
  // bounding sphere reject
  const mx = rig.cx - ox, my = rig.cy - oy, mz = rig.cz - oz;
  const along = mx * dx + my * dy + mz * dz;
  const br = rig.bound + pad;
  if (along < -br || along > maxT + br) return res;
  if (mx * mx + my * my + mz * mz - along * along > br * br) return res;

  let best = maxT;
  const a = rig.a, b = rig.b;
  for (let i = 0; i < SEG_COUNT; i++) {
    const k = i * 3;
    const t = rayCapsule(ox, oy, oz, dx, dy, dz, a[k], a[k + 1], a[k + 2], b[k], b[k + 1], b[k + 2], rig.r[i] + pad);
    if (t >= 0 && t < best) { best = t; res.seg = i; }
  }
  if (res.seg >= 0) res.t = best;
  return res;
}
