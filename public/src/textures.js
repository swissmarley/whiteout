// Every texture in the game is painted here at load time. No image files on disk.

import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

// Tileable value noise + fbm.
function tileNoise(seed, period) {
  const r = rng(seed), g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0], b = g[y0 * period + x1], c = g[y1 * period + x0], d = g[y1 * period + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fbmField(seed, size, basePeriod, octaves) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const period = basePeriod << o, n = tileNoise(seed + o * 17, period), s = period / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] += n(x * s, y * s) * amp;
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function normalFromHeight(hgt, w, h, strength) {
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const yu = (y - 1 + h) % h, yd = (y + 1) % h;
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w;
      const dx = (hgt[y * w + xr] - hgt[y * w + xl]) * strength;
      const dy = (hgt[yd * w + x] - hgt[yu * w + x]) * strength;
      const il = 1 / Math.hypot(dx, dy, 1), k = (y * w + x) * 4;
      d[k] = (-dx * il * 0.5 + 0.5) * 255; d[k + 1] = (dy * il * 0.5 + 0.5) * 255; d[k + 2] = (il * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}

function grayToCanvas(field, w, h, lo = 0, hi = 1) {
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) { const v = (lo + (hi - lo) * field[i]) * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}

function heightOf(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, out = new Float32Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

const rgb = (c, k = 1) => `rgb(${Math.max(0, Math.min(255, c[0] * k)) | 0},${Math.max(0, Math.min(255, c[1] * k)) | 0},${Math.max(0, Math.min(255, c[2] * k)) | 0})`;

// ---------------------------------------------------------------------------- brick
export const BRICK_TILE = { w: 1.8, h: 1.5 };   // metres covered by one texture repeat

const BRICK_STYLES = [
  { base: [124, 60, 46], alt: [[100, 46, 38], [142, 74, 54], [88, 52, 46], [116, 66, 58]], mortar: [128, 122, 112] },
  { base: [118, 94, 72], alt: [[100, 78, 60], [134, 108, 84], [92, 74, 62], [124, 90, 66]], mortar: [120, 114, 104] },
  { base: [74, 62, 58], alt: [[60, 50, 48], [88, 72, 66], [54, 46, 46], [82, 60, 54]], mortar: [84, 80, 76] },
];

export function brickSet(style) {
  const S = 1024, cols = 8, rows = 20, bw = S / cols, bh = S / rows, m = 5;
  const st = BRICK_STYLES[style], r = rng(101 + style * 7);
  const col = canvas(S, S), cx = col.getContext('2d');
  const hc = canvas(S, S), hx = hc.getContext('2d');
  const rc = canvas(S, S), rx = rc.getContext('2d');
  cx.fillStyle = rgb(st.mortar); cx.fillRect(0, 0, S, S);
  hx.fillStyle = '#404040'; hx.fillRect(0, 0, S, S);
  rx.fillStyle = '#f4f4f4'; rx.fillRect(0, 0, S, S);
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * bw * 0.5 + (r() - 0.5) * 3;
    for (let i = -1; i < cols; i++) {
      const c0 = r() < 0.55 ? st.base : st.alt[(r() * st.alt.length) | 0];
      const k = 0.82 + r() * 0.36, burnt = r() < 0.07 ? 0.55 : 1;
      const x = i * bw + off + m / 2, y = j * bh + m / 2, w = bw - m - r() * 1.5, h = bh - m - r() * 1.5;
      const hv = 150 + r() * 50, rv = 190 + r() * 40;
      for (const dx of [0, S]) {          // wrap horizontally
        cx.fillStyle = rgb(c0, k * burnt); cx.fillRect(x + dx, y, w, h);
        const g = cx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
        cx.fillStyle = g; cx.fillRect(x + dx, y, w, h);
        hx.fillStyle = `rgb(${hv - 40},${hv - 40},${hv - 40})`; hx.fillRect(x + dx, y, w, h);
        hx.fillStyle = `rgb(${hv},${hv},${hv})`; hx.fillRect(x + dx + 2, y + 2, w - 4, h - 4);
        rx.fillStyle = `rgb(${rv},${rv},${rv})`; rx.fillRect(x + dx, y, w, h);
        // chips and pits
        for (let n = 0; n < 5; n++) {
          const px = x + dx + r() * w, py = y + r() * h, pr = 1 + r() * 3.5;
          cx.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(255,235,215,0.10)';
          cx.beginPath(); cx.arc(px, py, pr, 0, 7); cx.fill();
          hx.fillStyle = 'rgba(40,40,40,0.5)'; hx.beginPath(); hx.arc(px, py, pr, 0, 7); hx.fill();
        }
      }
    }
  }
  // fine grain over everything
  const grain = fbmField(31 + style, S, 64, 3);
  const img = cx.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < S * S; i++) { const g = 0.86 + grain[i] * 0.28; d[i * 4] *= g; d[i * 4 + 1] *= g; d[i * 4 + 2] *= g; }
  cx.putImageData(img, 0, 0);
  const hgt = heightOf(hc);
  for (let i = 0; i < hgt.length; i++) hgt[i] += (grain[i] - 0.5) * 0.16;
  return { map: tex(col), normalMap: normalFromHeight(hgt, S, S, 3.2), roughnessMap: tex(rc, { srgb: false }) };
}

// Large-scale soot / water streaking, sampled in world space by the building shader.
export function grimeTex() {
  const S = 512, f = fbmField(77, S, 4, 5), c = canvas(S, S), ctx = c.getContext('2d');
  ctx.drawImage(grayToCanvas(f, S, S, 0.15, 1), 0, 0);
  const r = rng(5);
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 70; i++) {       // vertical drip streaks
    const x = r() * S, y = r() * S, len = 40 + r() * 180, w = 2 + r() * 9;
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(120,120,120,1)'); g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    for (const dy of [0, -S]) ctx.fillRect(x, y + dy, w, len);
  }
  return tex(c, { srgb: false });
}

// ---------------------------------------------------------------------------- snow
export function snowSet() {
  const S = 512;
  const f = fbmField(11, S, 8, 6), fine = fbmField(12, S, 64, 3);
  const hgt = new Float32Array(S * S);
  for (let i = 0; i < hgt.length; i++) hgt[i] = f[i] * 0.8 + fine[i] * 0.2;
  const col = canvas(S, S), cx = col.getContext('2d'), img = cx.createImageData(S, S), d = img.data;
  for (let i = 0; i < S * S; i++) {
    const v = 222 + f[i] * 30;
    d[i * 4] = v - 6; d[i * 4 + 1] = v - 2; d[i * 4 + 2] = v + 3; d[i * 4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return { map: tex(col), normalMap: normalFromHeight(hgt, S, S, 5.5) };
}

// World-mapped mask of where traffic has packed the snow down to wet tarmac.
// R = slush/wet amount. Covers x[-36,36] z[-48,48].
export const MASK_RECT = { x0: -36, z0: -48, w: 72, d: 96 };
export function groundMask() {
  const W = 768, H = 1024, c = canvas(W, H), ctx = c.getContext('2d'), r = rng(9);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const px = (x) => (x - MASK_RECT.x0) / MASK_RECT.w * W, pz = (z) => (z - MASK_RECT.z0) / MASK_RECT.d * H;
  ctx.globalCompositeOperation = 'lighter';
  const dab = (x, z, rad, a) => {
    const g = ctx.createRadialGradient(px(x), pz(z), 0, px(x), pz(z), rad * W / MASK_RECT.w);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px(x), pz(z), rad * W / MASK_RECT.w, 0, 7); ctx.fill();
  };
  const track = (x0, z0, x1, z1, wob, a) => {
    const n = Math.hypot(x1 - x0, z1 - z0) / 0.22;
    for (let i = 0; i < n; i++) {
      const t = i / n, w = Math.sin(t * 5 + wob) * 0.1;
      const nx = -(z1 - z0), nz = x1 - x0, nl = Math.hypot(nx, nz);
      dab(x0 + (x1 - x0) * t + nx / nl * w + (r() - 0.5) * 0.05, z0 + (z1 - z0) * t + nz / nl * w + (r() - 0.5) * 0.05, 0.2 + r() * 0.1, a * (0.75 + r() * 0.25));
    }
  };
  // tyre tracks: two ruts per pass, several overlapping passes
  for (const o of [-0.78, 0.78]) {
    track(o - 0.08, -46, o + 0.06, 46, 0, 0.55); track(o + 0.2, -46, o - 0.16, 46, 2, 0.16);
    track(-34, o + 0.06, 34, o - 0.08, 1, 0.55); track(-34, o - 0.2, 34, o + 0.16, 3, 0.16);
    track(4, -17 + o, 16, -17 + o * 1.2, 4, 0.5);
  }
  // foot traffic: scuffed patches where people actually walk
  const spots = [[0, 0, 4.2], [0, -17, 2.6], [10, -16, 3.5], [15.5, -6.5, 1.6], [-8, 17, 2.8], [-6, -32, 1.6], [6, 32, 1.6], [-22, -5, 1.6], [22, 5, 1.6], [10.5, -26, 2], [17, -18, 1.6]];
  for (const [x, z, rad] of spots) for (let i = 0; i < 26; i++) dab(x + (r() - 0.5) * rad * 2, z + (r() - 0.5) * rad * 2, 0.5 + r() * 0.9, 0.17);
  for (let i = 0; i < 260; i++) {
    const main = r() < 0.5;
    dab(main ? (r() - 0.5) * 6 : (r() - 0.5) * 60, main ? (r() - 0.5) * 84 : (r() - 0.5) * 4.6, 0.3 + r() * 0.7, 0.13);
  }
  const t = tex(c, { srgb: false, repeat: false, aniso: 4 });
  return t;
}

// ---------------------------------------------------------------------------- generic surfaces
export function concreteSet() {
  const S = 512, f = fbmField(21, S, 4, 6), fine = fbmField(22, S, 128, 2);
  const c = canvas(S, S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
  for (let i = 0; i < S * S; i++) { const v = 96 + f[i] * 70 + fine[i] * 26; d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v * 1.02; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const r = rng(3);
  ctx.strokeStyle = 'rgba(20,20,22,0.5)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 9; i++) {
    let x = r() * S, y = r() * S; ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 12; k++) { x += (r() - 0.5) * 50; y += (r() - 0.2) * 34; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const hgt = new Float32Array(S * S);
  for (let i = 0; i < hgt.length; i++) hgt[i] = f[i] * 0.5 + fine[i] * 0.5;
  return { map: tex(c), normalMap: normalFromHeight(hgt, S, S, 2.2) };
}

export function woodSet() {
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d'), r = rng(41);
  const hc = canvas(S, S), hx = hc.getContext('2d');
  hx.fillStyle = '#909090'; hx.fillRect(0, 0, S, S);
  const planks = 5, ph = S / planks;
  for (let p = 0; p < planks; p++) {
    const tone = 0.8 + r() * 0.4;
    ctx.fillStyle = rgb([126, 96, 62], tone); ctx.fillRect(0, p * ph, S, ph);
    for (let i = 0; i < 90; i++) {       // grain
      const y = p * ph + r() * ph, a = 0.05 + r() * 0.14;
      ctx.strokeStyle = r() < 0.6 ? `rgba(40,24,10,${a})` : `rgba(255,225,180,${a * 0.6})`;
      ctx.lineWidth = 0.6 + r() * 1.6; ctx.beginPath(); ctx.moveTo(0, y);
      for (let x = 0; x <= S; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 2.5);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(12,8,4,0.85)'; ctx.fillRect(0, p * ph, S, 3);
    hx.fillStyle = '#202020'; hx.fillRect(0, p * ph, S, 4);
    for (const x of [14, S - 14]) { ctx.fillStyle = 'rgba(20,18,16,0.9)'; ctx.beginPath(); ctx.arc(x, p * ph + ph / 2, 3, 0, 7); ctx.fill(); }
  }
  // crate frame: border boards + stencil
  ctx.fillStyle = 'rgba(60,40,22,0.55)';
  for (const [x, y, w, h] of [[0, 0, S, 46], [0, S - 46, S, 46], [0, 0, 46, S], [S - 46, 0, 46, S]]) ctx.fillRect(x, y, w, h);
  hx.fillStyle = '#d0d0d0';
  for (const [x, y, w, h] of [[0, 0, S, 46], [0, S - 46, S, 46], [0, 0, 46, S], [S - 46, 0, 46, S]]) hx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(15,12,10,0.6)'; ctx.font = '700 54px "Arial Narrow", sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('FRAGILE', S / 2, S / 2 + 4); ctx.font = '600 22px monospace'; ctx.fillText('LOT 7741-C', S / 2, S / 2 + 44);
  return { map: tex(c), normalMap: normalFromHeight(heightOf(hc), S, S, 2.5) };
}

// Painted, rusting sheet metal (dumpsters, van, barrels).
export function paintedMetal(color, seed, ribs = true) {
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d'), r = rng(seed), f = fbmField(seed, S, 4, 5);
  const img = ctx.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, n = f[i];
    // rust creeps up from the bottom edge and blooms in patches
    const rust = Math.max(0, Math.min(1, (n - 0.56) * 7 + (y / S - 0.72) * 2.6));
    const k = 0.8 + n * 0.4;
    d[i * 4] = color[0] * k * (1 - rust) + (96 + n * 50) * rust;
    d[i * 4 + 1] = color[1] * k * (1 - rust) + (50 + n * 26) * rust;
    d[i * 4 + 2] = color[2] * k * (1 - rust) + (26 + n * 12) * rust;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (ribs) for (let x = 64; x < S; x += 128) {
    const g = ctx.createLinearGradient(x - 12, 0, x + 12, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, 'rgba(0,0,0,0.38)'); g.addColorStop(0.65, 'rgba(255,255,255,0.14)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 12, 0, 24, S);
  }
  ctx.strokeStyle = 'rgba(210,215,220,0.22)'; ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) { const x = r() * S, y = r() * S; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 70, y + (r() - 0.5) * 22); ctx.stroke(); }
  return tex(c);
}

export function chainlinkTex() {
  const S = 128, c = canvas(S, S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = '#b9c0c6'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  for (let k = -1; k <= 2; k++) {
    ctx.beginPath(); ctx.moveTo(k * S - 4, -4); ctx.lineTo((k + 1) * S + 4, S + 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo((k + 1) * S + 4, -4); ctx.lineTo(k * S - 4, S + 4); ctx.stroke();
  }
  const t = tex(c); t.magFilter = THREE.LinearFilter; return t;
}

export function corrugatedTex() {
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
  for (let y = 0; y < S; y += 16) {
    const g = ctx.createLinearGradient(0, y, 0, y + 16);
    g.addColorStop(0, '#2a2d31'); g.addColorStop(0.45, '#5b6067'); g.addColorStop(1, '#1e2023');
    ctx.fillStyle = g; ctx.fillRect(0, y, S, 16);
  }
  return tex(c);
}

// ---------------------------------------------------------------------------- windows / signage
export function windowTex(kind) {
  const W = 128, H = 192, c = canvas(W, H), ctx = c.getContext('2d'), r = rng(60 + kind);
  if (kind === 0) {             // warm room, curtains
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#ffd89a'); g.addColorStop(1, '#d98a3a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(120,50,20,0.55)'; ctx.fillRect(0, 0, 30, H); ctx.fillRect(W - 26, 0, 26, H);
    ctx.fillStyle = 'rgba(60,24,10,0.5)'; ctx.beginPath(); ctx.arc(74, 150, 22, 0, 7); ctx.fill(); ctx.fillRect(56, 160, 36, 40);
  } else if (kind === 1) {      // cold TV light through blinds
    ctx.fillStyle = '#b9d0ff'; ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 9) { ctx.fillStyle = 'rgba(20,30,60,0.6)'; ctx.fillRect(0, y, W, 4); }
  } else if (kind === 2) {      // dim amber, half-drawn blind
    ctx.fillStyle = '#e8a64a'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(90,50,20,0.75)'; ctx.fillRect(0, 0, W, 70 + r() * 40);
  } else {                      // dark glass
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1a2230'); g.addColorStop(0.5, '#0b0f16'); g.addColorStop(1, '#161d28');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(160,190,230,0.07)'; ctx.beginPath(); ctx.moveTo(10, H); ctx.lineTo(60, 0); ctx.lineTo(84, 0); ctx.lineTo(34, H); ctx.fill();
  }
  // sash bars + frost creeping in from the corners
  ctx.fillStyle = '#141414'; ctx.fillRect(W / 2 - 3, 0, 6, H); ctx.fillRect(0, H / 2 - 3, W, 6);
  ctx.fillStyle = 'rgba(235,242,255,0.5)';
  for (let i = 0; i < 60; i++) { const x = r() * W, y = H - r() * r() * 46; ctx.beginPath(); ctx.arc(x, y, 1 + r() * 4, 0, 7); ctx.fill(); }
  return tex(c, { repeat: false, aniso: 4 });
}

export function neonTex() {
  const W = 512, H = 256, c = canvas(W, H), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '800 150px "Avenir Next Condensed", "Arial Narrow", sans-serif';
  for (const [blur, a] of [[34, 0.9], [14, 1], [0, 1]]) {
    ctx.shadowColor = '#ff2a7a'; ctx.shadowBlur = blur; ctx.strokeStyle = `rgba(255,170,205,${a})`; ctx.lineWidth = 7;
    ctx.strokeText('BAR', W / 2, 100);
  }
  ctx.font = '700 44px "Avenir Next Condensed", "Arial Narrow", sans-serif';
  for (const blur of [20, 6]) { ctx.shadowColor = '#22e0ff'; ctx.shadowBlur = blur; ctx.fillStyle = '#c8f6ff'; ctx.fillText('OPEN  LATE', W / 2, 212); }
  return tex(c, { repeat: false });
}

export function ammoTex() {
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d'), f = fbmField(90, S, 8, 4);
  const img = ctx.createImageData(S, S), d = img.data;
  for (let i = 0; i < S * S; i++) { const k = 0.8 + f[i] * 0.4; d[i * 4] = 62 * k; d[i * 4 + 1] = 74 * k; d[i * 4 + 2] = 44 * k; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = '#e6d36a'; ctx.font = '800 46px "Arial Narrow", sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('5.56 MM', S / 2, 112); ctx.font = '700 26px monospace'; ctx.fillText('BALL  M855', S / 2, 150);
  ctx.strokeStyle = '#e6d36a'; ctx.lineWidth = 4; ctx.strokeRect(22, 56, S - 44, 118);
  return tex(c);
}

export function graffitiTex(seed) {
  const W = 512, H = 256, c = canvas(W, H), ctx = c.getContext('2d'), r = rng(seed);
  const colors = ['#e9eff6', '#ff3d6e', '#39d0c8', '#ffb23c', '#b6ff4a'];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const col = colors[(r() * colors.length) | 0];
  for (let pass = 0; pass < 2; pass++) {
    const rr = rng(seed * 3 + 1);
    ctx.strokeStyle = pass ? col : 'rgba(0,0,0,0.75)'; ctx.lineWidth = pass ? 13 : 22;
    let x = 50;
    for (let g = 0; g < 5; g++) {
      ctx.beginPath(); ctx.moveTo(x, 70 + rr() * 110);
      for (let k = 0; k < 3; k++) ctx.bezierCurveTo(x + rr() * 80 - 10, 20 + rr() * 200, x + rr() * 80 - 10, 20 + rr() * 200, x + 20 + rr() * 60, 50 + rr() * 150);
      ctx.stroke(); x += 82;
    }
  }
  ctx.fillStyle = col; ctx.globalAlpha = 0.5;
  for (let i = 0; i < 26; i++) { ctx.beginPath(); ctx.arc(r() * W, 180 + r() * 70, 1 + r() * 3, 0, 7); ctx.fill(); }
  return tex(c, { repeat: false });
}

export function farWindowsTex() {
  const W = 256, H = 512, c = canvas(W, H), ctx = c.getContext('2d'), r = rng(4);
  ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, W, H);
  for (let y = 10; y < H; y += 22) for (let x = 8; x < W; x += 18) {
    if (r() < 0.085) { ctx.fillStyle = r() < 0.75 ? `rgba(255,${170 + r() * 50},${90 + r() * 50},${0.25 + r() * 0.6})` : 'rgba(170,200,255,0.6)'; ctx.fillRect(x + r() * 3, y, 7 + r() * 3, 11); }
  }
  return tex(c);
}

// ---------------------------------------------------------------------------- effects
export function flashTex() {
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d'), r = rng(8);
  ctx.translate(S / 2, S / 2);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 11; i++) {
    const a = r() * Math.PI * 2, len = 50 + r() * 74, w = 0.1 + r() * 0.22;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
    g.addColorStop(0, 'rgba(255,240,200,0.9)'); g.addColorStop(0.4, 'rgba(255,170,70,0.5)'); g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, len, a - w, a + w); ctx.closePath(); ctx.fill();
  }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 56);
  g.addColorStop(0, 'rgba(255,255,245,1)'); g.addColorStop(0.5, 'rgba(255,200,110,0.55)'); g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 56, 0, 7); ctx.fill();
  return tex(c, { repeat: false });
}

export function glowTex() {
  const S = 128, c = canvas(S, S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return tex(c, { repeat: false });
}

export function holeTex() {
  const S = 64, c = canvas(S, S), ctx = c.getContext('2d'), r = rng(2);
  ctx.translate(S / 2, S / 2);
  ctx.fillStyle = 'rgba(210,200,190,0.5)';      // chipped halo
  for (let i = 0; i < 16; i++) { const a = r() * 7, d = 8 + r() * 12; ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 2 + r() * 5, 0, 7); ctx.fill(); }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 15);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(8,6,5,0.92)'); g.addColorStop(1, 'rgba(20,16,14,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.fill();
  return tex(c, { repeat: false });
}

export function snowHoleTex() {
  const S = 64, c = canvas(S, S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(40,52,74,0.85)'); g.addColorStop(0.45, 'rgba(90,108,138,0.5)'); g.addColorStop(1, 'rgba(120,140,170,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return tex(c, { repeat: false });
}

// Blood splatter. `screen` = the big drippy lens version, otherwise a world decal.
export function bloodCanvas(seed, S = 256, screen = false) {
  const c = canvas(S, S), ctx = c.getContext('2d'), r = rng(seed);
  ctx.translate(S / 2, S / 2);
  const blob = (x, y, rad, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${screen ? 150 : 92},${screen ? 6 : 4},4,${a})`); g.addColorStop(0.7, `rgba(${screen ? 120 : 70},3,3,${a * 0.9})`); g.addColorStop(1, 'rgba(70,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
  };
  const core = screen ? 0.6 : 1;
  for (let i = 0; i < (screen ? 13 : 22); i++) { const a = r() * 7, d = r() * S * 0.13 * core; blob(Math.cos(a) * d, Math.sin(a) * d, S * (0.05 + r() * 0.1) * core, 0.95); }
  for (let i = 0; i < (screen ? 70 : 46); i++) {              // flung droplets, elongated along their direction
    const a = r() * 7, d = S * (0.14 * core + r() * r() * 0.36), rad = S * (0.004 + r() * (screen ? 0.012 : 0.022));
    for (let k = 0; k < 4; k++) blob(Math.cos(a) * (d + k * rad * 0.9), Math.sin(a) * (d + k * rad * 0.9), rad * (1 - k * 0.18), 0.9);
  }
  if (screen) for (let i = 0; i < 7; i++) {   // gravity drips
    const x = (r() - 0.5) * S * 0.22, len = S * (0.1 + r() * 0.3), w = S * (0.005 + r() * 0.008);
    for (let y = 0; y < len; y += w * 0.8) blob(x + Math.sin(y * 0.05) * 2, y, w * (1 - y / len * 0.5), 0.85);
  }
  return c;
}

export function bloodTex(seed) { return tex(bloodCanvas(seed), { repeat: false }); }

export function footprintTex() {
  const S = 64, c = canvas(S, S * 2), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(60,76,104,0.62)';
  ctx.beginPath(); ctx.ellipse(S / 2, 44, 17, 34, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(S / 2, 100, 14, 19, 0, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(40,52,76,0.5)';
  for (let y = 18; y < 72; y += 9) ctx.fillRect(S / 2 - 12, y, 24, 3);
  return tex(c, { repeat: false });
}

export function nameTagTex(name) {
  const c = canvas(256, 64), ctx = c.getContext('2d');
  ctx.font = '700 30px "Avenir Next Condensed", "Arial Narrow", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000'; ctx.shadowBlur = 6; ctx.fillStyle = '#9fd0ff';
  ctx.fillText(name.toUpperCase(), 128, 34);
  return tex(c, { repeat: false });
}

// ---------------------------------------------------------------------------- model surfaces
// Tiling detail for the modelled rifle and characters. The geometry carries colour, roughness
// and metalness per vertex; these only add the micro-relief and stop any surface being uniform.

// Blotchy roughness multiplier (green channel), meant to be tiled far larger than the normal map.
function smudgeTex(seed, lo, scratches) {
  const S = 256, f = fbmField(seed, S, 4, 5), c = grayToCanvas(f, S, S, lo, 1), ctx = c.getContext('2d'), r = rng(seed + 1);
  ctx.lineWidth = 1;
  for (let i = 0; i < scratches; i++) {     // handling marks: thin polished lines
    const x = r() * S, y = r() * S, a = r() * 6.283, len = 8 + r() * 46;
    ctx.strokeStyle = `rgba(${90 + r() * 60 | 0},${90 + r() * 60 | 0},${90 + r() * 60 | 0},${0.25 + r() * 0.4})`;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  }
  return tex(c, { srgb: false, aniso: 4 });
}

// Bead-blasted metal / moulded polymer: fine isotropic grain with the odd pit.
export function grainSet() {
  const S = 256, a = fbmField(301, S, 32, 3), b = fbmField(302, S, 8, 2), r = rng(303), hgt = new Float32Array(S * S);
  for (let i = 0; i < hgt.length; i++) hgt[i] = a[i] * 0.9 + b[i] * 0.1;
  for (let i = 0; i < 220; i++) { const x = (r() * S) | 0, y = (r() * S) | 0; hgt[y * S + x] -= 0.35; hgt[y * S + (x + 1) % S] -= 0.18; hgt[((y + 1) % S) * S + x] -= 0.18; }
  return { normalMap: normalFromHeight(hgt, S, S, 2.6), roughnessMap: smudgeTex(310, 0.72, 46) };
}

// Woven cloth: over-under threads, a ripstop grid, and slub noise so it is not a perfect lattice.
export function clothSet() {
  const S = 256, N = 32, slub = fbmField(321, S, 16, 3), hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S * N, v = y / S * N, fu = u - Math.floor(u), fv = v - Math.floor(v);
    const over = (Math.floor(u) + Math.floor(v)) & 1;
    const warp = Math.sin(fu * Math.PI) * (0.55 + 0.45 * Math.cos(fv * Math.PI * 2) * (over ? 1 : -1));
    const weft = Math.sin(fv * Math.PI) * (0.55 + 0.45 * Math.cos(fu * Math.PI * 2) * (over ? -1 : 1));
    const rip = (Math.floor(u) % 8 === 0 ? Math.sin(fu * Math.PI) : 0) + (Math.floor(v) % 8 === 0 ? Math.sin(fv * Math.PI) : 0);
    hgt[y * S + x] = Math.max(warp, weft) * 0.8 + rip * 0.1 + (slub[y * S + x] - 0.5) * 0.6;
  }
  return { normalMap: normalFromHeight(hgt, S, S, 2.4), roughnessMap: smudgeTex(330, 0.84, 0) };
}
