// Pure geometry used by both sides: ray vs box, ray vs capsule, box overlap queries.
// A "solid" is an axis-aligned box { x0,y0,z0,x1,y1,z1, mat, ... }.

const hit = { t: -1, solid: null, nx: 0, ny: 0, nz: 0 };

// Slab test. Returns entry distance or -1. Writes the entry face normal into `n` (array of 3).
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT, n) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;

  if (Math.abs(dx) < 1e-9) { if (ox < b.x0 || ox > b.x1) return -1; }
  else {
    const inv = 1 / dx; let t1 = (b.x0 - ox) * inv, t2 = (b.x1 - ox) * inv, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < b.y0 || oy > b.y1) return -1; }
  else {
    const inv = 1 / dy; let t1 = (b.y0 - oy) * inv, t2 = (b.y1 - oy) * inv, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < b.z0 || oz > b.z1) return -1; }
  else {
    const inv = 1 / dz; let t1 = (b.z0 - oz) * inv, t2 = (b.z1 - oz) * inv, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (axis === -1) return -1; // origin inside the box
  if (n) { n[0] = axis === 0 ? sign : 0; n[1] = axis === 1 ? sign : 0; n[2] = axis === 2 ? sign : 0; }
  return tmin;
}

const _n = [0, 0, 0];

// Nearest hit against the static world + the ground plane (y = 0).
// bullets=true lets rays pass through solids flagged `pass` (chain-link fences).
export function raycastWorld(solids, ox, oy, oz, dx, dy, dz, maxT, bullets) {
  let best = maxT, bs = null, bx = 0, by = 0, bz = 0;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (bullets && s.pass) continue;
    const t = rayBox(ox, oy, oz, dx, dy, dz, s, best, _n);
    if (t >= 0 && t < best) { best = t; bs = s; bx = _n[0]; by = _n[1]; bz = _n[2]; }
  }
  if (dy < -1e-9) {
    const t = -oy / dy;
    if (t >= 0 && t < best) { best = t; bs = GROUND; bx = 0; by = 1; bz = 0; }
  }
  hit.t = bs ? best : -1; hit.solid = bs; hit.nx = bx; hit.ny = by; hit.nz = bz;
  return hit;
}

export const GROUND = { ground: true, mat: 'snow', x0: -1e3, y0: -1, z0: -1e3, x1: 1e3, y1: 0, z1: 1e3 };

// Line of sight between two points (true = clear).
export function clearLine(solids, ax, ay, az, bx, by, bz) {
  let dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  dx /= len; dy /= len; dz /= len;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (s.pass) continue;
    const t = rayBox(ax, ay, az, dx, dy, dz, s, len, null);
    if (t >= 0 && t < len) return false;
  }
  return true;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const mx = ox - cx, my = oy - cy, mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c <= 0) return 0;            // origin inside
  if (b > 0) return -1;            // pointing away
  const h = b * b - c;
  if (h < 0) return -1;
  return -b - Math.sqrt(h);
}

// Ray vs capsule (segment a-b, radius r). d must be normalised. Returns distance or -1.
export function rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-10) return raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  const oax = ox - ax, oay = oy - ay, oaz = oz - az;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  if (a > 1e-9) {
    const b = baba * rdoa - baoa * bard;
    const c = baba * oaoa - baoa * baoa - r * r * baba;
    const h = b * b - a * c;
    if (h < 0) return -1;
    const sq = Math.sqrt(h);
    let t = (-b - sq) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) {
      if (t >= 0) return t;
      return (-b + sq) / a > 0 ? 0 : -1;   // started inside the cylinder
    }
    // fall through to the end caps
    const ta = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
    const tb = raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
    if (ta < 0) return tb;
    if (tb < 0) return ta;
    return Math.min(ta, tb);
  }
  // Ray parallel to the capsule axis: only the caps can be hit first.
  const ta = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  const tb = raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
  if (ta < 0) return tb;
  if (tb < 0) return ta;
  return Math.min(ta, tb);
}

// First solid overlapping the box [x±hw, y..y+h, z±hw], or null.
export function overlapBox(solids, x, y, z, hw, h) {
  const x0 = x - hw, x1 = x + hw, z0 = z - hw, z1 = z + hw, y1 = y + h;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (x1 > s.x0 && x0 < s.x1 && z1 > s.z0 && z0 < s.z1 && y1 > s.y0 && y < s.y1) return s;
  }
  return null;
}

// Highest surface under the footprint whose top is at or below `maxY` (0 = ground).
export function supportY(solids, x, z, hw, maxY) {
  const x0 = x - hw, x1 = x + hw, z0 = z - hw, z1 = z + hw;
  let top = 0;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (x1 > s.x0 && x0 < s.x1 && z1 > s.z0 && z0 < s.z1 && s.y1 <= maxY && s.y1 > top) top = s.y1;
  }
  return top;
}
