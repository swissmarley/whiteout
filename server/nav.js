// Navigation grid + A* built straight from the shared collision boxes, so the AI can never
// path through something the player collides with. 0.5 m cells, 2.5D (per-cell floor height
// lets enemies climb the loading-dock stairs).

import { BOUNDS, SOLIDS } from '../shared/map.js';

const CELL = 0.5;
const AGENT_R = 0.36;
const MAX_STEP = 0.35;

export class Nav {
  constructor() {
    this.x0 = BOUNDS.x0; this.z0 = BOUNDS.z0;
    this.w = Math.round((BOUNDS.x1 - BOUNDS.x0) / CELL);
    this.h = Math.round((BOUNDS.z1 - BOUNDS.z0) / CELL);
    const n = this.w * this.h;
    this.floor = new Float32Array(n);
    this.free = new Uint8Array(n);

    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const cx = this.x0 + (i + 0.5) * CELL, cz = this.z0 + (j + 0.5) * CELL;
        let fl = 0;
        for (const s of SOLIDS) {
          if (s.walk && cx > s.x0 && cx < s.x1 && cz > s.z0 && cz < s.z1 && s.y1 > fl) fl = s.y1;
        }
        let blocked = false;
        for (const s of SOLIDS) {
          if (cx + AGENT_R > s.x0 && cx - AGENT_R < s.x1 && cz + AGENT_R > s.z0 && cz - AGENT_R < s.z1 &&
              fl + 1.7 > s.y0 && fl + 0.38 < s.y1) { blocked = true; break; }
        }
        const k = j * this.w + i;
        this.floor[k] = fl;
        this.free[k] = blocked ? 0 : 1;
      }
    }

    // A* scratch
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n);
    this.sid = 0;
  }

  cell(x, z) {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  cx(k) { return this.x0 + ((k % this.w) + 0.5) * CELL; }
  cz(k) { return this.z0 + (Math.floor(k / this.w) + 0.5) * CELL; }

  floorAt(x, z) { const k = this.cell(x, z); return k < 0 ? 0 : this.floor[k]; }

  walkable(x, z, y) {
    const k = this.cell(x, z);
    return k >= 0 && this.free[k] === 1 && Math.abs(this.floor[k] - y) <= 0.6;
  }

  nearestFree(x, z, maxR = 8) {
    const k = this.cell(x, z);
    if (k >= 0 && this.free[k]) return k;
    const ci = Math.floor((x - this.x0) / CELL), cj = Math.floor((z - this.z0) / CELL);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= maxR && best < 0; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          const kk = j * this.w + i;
          if (!this.free[kk]) continue;
          const d = di * di + dj * dj;
          if (d < bd) { bd = d; best = kk; }
        }
      }
    }
    return best;
  }

  // Straight walkable line? Sampled every 0.2 m.
  lineFree(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(len / 0.2));
    let prev = this.cell(x0, z0);
    if (prev < 0) return false;
    for (let s = 1; s <= n; s++) {
      const k = this.cell(x0 + dx * s / n, z0 + dz * s / n);
      if (k < 0 || !this.free[k]) return false;
      if (Math.abs(this.floor[k] - this.floor[prev]) > MAX_STEP) return false;
      prev = k;
    }
    return true;
  }

  findPath(sx, sz, tx, tz) {
    const start = this.nearestFree(sx, sz), goal = this.nearestFree(tx, tz);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: this.cx(goal), z: this.cz(goal) }];
    const { w, h, g, f, came, stamp, closed, heap, free, floor } = this;
    const sid = ++this.sid;
    const gi = goal % w, gj = Math.floor(goal / w);
    const heur = (k) => {
      const dx = Math.abs((k % w) - gi), dz = Math.abs(Math.floor(k / w) - gj);
      return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)) * CELL;
    };
    let size = 0;
    const push = (k) => {
      let i = size++; heap[i] = k;
      while (i > 0) { const p = (i - 1) >> 1; if (f[heap[p]] <= f[heap[i]]) break; const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; }
    };
    const pop = () => {
      const top = heap[0]; const last = heap[--size];
      if (size > 0) {
        heap[0] = last; let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1; let m = i;
          if (l < size && f[heap[l]] < f[heap[m]]) m = l;
          if (r < size && f[heap[r]] < f[heap[m]]) m = r;
          if (m === i) break;
          const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
        }
      }
      return top;
    };

    g[start] = 0; f[start] = heur(start); came[start] = -1; stamp[start] = sid; push(start);
    let found = false, iter = 0;
    while (size > 0 && iter++ < 20000) {
      const cur = pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur] === sid) continue;
      closed[cur] = sid;
      const ci = cur % w, cj = Math.floor(cur / w), cf = floor[cur];
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
          const nk = nj * w + ni;
          if (!free[nk] || closed[nk] === sid) continue;
          if (Math.abs(floor[nk] - cf) > MAX_STEP) continue;
          if (di && dj && (!free[cj * w + ni] || !free[nj * w + ci])) continue;   // no corner cutting
          const ng = g[cur] + (di && dj ? Math.SQRT2 : 1) * CELL;
          if (stamp[nk] === sid && ng >= g[nk]) continue;
          g[nk] = ng; f[nk] = ng + heur(nk); came[nk] = cur; stamp[nk] = sid; push(nk);
        }
      }
    }
    if (!found) return null;
    const out = [];
    for (let k = goal; k !== -1 && k !== start; k = came[k]) out.push({ x: this.cx(k), z: this.cz(k) });
    out.reverse();
    return out;
  }
}
