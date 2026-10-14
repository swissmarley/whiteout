// The MK4 carbine, modelled part by part: AR-pattern receiver set with a working ejection
// port, free-float M-LOK handguard over the barrel and gas system, holographic sight,
// weapon light, collapsible stock, and a separate magazine and bolt carrier.
//
// Gun space: +x right, +y up, -z down the bore. Profiles below are written as `s` = distance
// forward of the grip (z = -s), so a side view reads left-to-right like a drawing.

import { surf, finish, merge, shade, fillet, arc, rect, slot, slab, bar, plate, rbox, lathe, rod, tube, pin } from './mesh.js';

const YB = 0.034;        // bore axis
const RT = 0.0665;       // top of the Picatinny rail
const SY = 0.1055;       // sight line (centre of the optic window)
const W = 0.0168;        // upper receiver half-width
const LX = -0.0272, LY = 0.0612;   // weapon light axis (10:30 on the handguard)

export const RIFLE = {
  boreY: YB, sightY: SY,
  muzzle: [0, YB, -0.615],
  port: [0.021, 0.037, -0.05],
  window: rect(-0.017, SY - 0.013, 0.017, SY + 0.013, 0.004, 4),   // optic aperture outline (x, y)
  lensZ: [-0.0555, -0.0985],                                        // rear and front panes
  light: { x: LX, y: LY, z: -0.4636, r: 0.0138 },
};

const ANO = surf(0x2a2b2f, 0.52, 0.35, 0.7, 42, 0.55, 0x85888e);      // hard-anodised aluminium
const STEEL = surf(0x1b1c1f, 0.5, 0.75, 0.5, 42, 0.5, 0x8f9297);   // phosphated steel
const DARK = surf(0x101012, 0.6, 0.3, 0.5, 42, 0.25, 0x55575c);
const BRIGHT = surf(0xa4a7ac, 0.3, 1, 0.3, 34);                     // bolt carrier
const POLY = surf(0x5c513d, 0.68, 0, 1, 48, 0.16, 0x8a7c62);         // dark-earth polymer
const POLYB = surf(0x151517, 0.7, 0, 1, 48, 0.14, 0x404046);
const RUBBER = surf(0x0d0d0e, 0.92, 0, 0.8, 24);
const BRASS = surf(0xb48a45, 0.32, 1, 0.2, 30);
const COPPER = surf(0xa8623c, 0.36, 1, 0.2, 30);
const MARK = surf(0xd6d6cc, 0.6, 0, 0, 30), MARK_RED = surf(0xb3261e, 0.6, 0, 0, 30);

const mirror = (half) => [...half, ...half.slice().reverse().map((p) => [-p[0], p[1], p[2]])];
const sector = (ri, ro, a0, a1, n = 5) => [...arc(0, 0, ro, a0, a1, n), ...arc(0, 0, ri, a1, a0, n)];
const swap = (pts) => pts.map((p) => [p[1], p[0]]);
const DEG = Math.PI / 180;

// Rail cross-sections. The lower dovetail runs the full length; the lugs sit on it every 10 mm.
const RAIL_LUG = [[-0.0106, 0.06375], [-0.0104, 0.0634], [0.0104, 0.0634], [0.0106, 0.06375], [0.0081, RT - 0.0002], [0.0078, RT], [-0.0078, RT], [-0.0081, RT - 0.0002]];
function railLugs(out, i0, i1) {
  for (let i = i0; i <= i1; i++) { const c = -0.043 + 0.01 * i; out.push(finish(bar(RAIL_LUG, c - 0.0024, c + 0.0024, 0.0003, { seg: 1 }), ANO)); }
}

function upper(out) {
  // cross-section, right half from the mating face up to the rail
  const half = [[0.0128, 0.0142], [0.0128, 0.0165], [0.015, 0.022, 0.003], [W, 0.03, 0.004], [W, 0.04], [0.0158, 0.0505, 0.005], [0.0122, 0.0575, 0.002], [0.0079, 0.0592], [0.0079, 0.0611], [0.0104, 0.0636]];
  const full = fillet(mirror(half), 0, 3);
  out.push(finish(bar(full, -0.05, 0.014), ANO), finish(bar(full, 0.086, 0.15), ANO));
  // ejection-port section: same outline, opened on the right into the carrier bore
  const R = 0.0128, top = 0.0445, bot = 0.0255;
  const a0 = Math.atan2(bot - YB, Math.sqrt(R * R - (bot - YB) ** 2)), a1 = Math.atan2(top - YB, Math.sqrt(R * R - (top - YB) ** 2)) - Math.PI * 2;
  const c = fillet(mirror(half), 0, 3).filter((p) => !(p[0] > 0.012 && p[1] > bot && p[1] < top));
  const k = c.findIndex((p) => p[0] > 0.012 && p[1] >= top);       // first outline point above the port, on the right
  const ring = [...c.slice(k), ...c.slice(0, k)];
  const port = [[W, top], ...ring, [0.0158, bot], ...arc(0, YB, R, a0, a1, 22)];
  out.push(shade(finish(bar(port, 0.014, 0.086), ANO), (x, y) => (Math.hypot(x, y - YB) < 0.0131 ? 0.4 : 1)));
  railLugs(out, 0, 19);

  // forward assist: housing and plunger angled out of the right rear
  const fa = (g) => g.rotateY(0.38).translate(0.0135, 0.031, 0);
  out.push(finish(fa(rod(0.0057, -0.035, 0.006, 0, 0, 14, 0.0008)), ANO), finish(fa(lathe([[0, -0.0425], [0.0052, -0.0425], [0.0066, -0.041], [0.0066, -0.0375], [0.0046, -0.0365], [0.0046, -0.034], [0, -0.034]], 14)), STEEL));
  // brass deflector behind the port
  out.push(finish(plate(fillet([[0.0155, 0.014], [0.0155, -0.012], [0.0205, -0.0075, 0.002], [0.0245, 0.003, 0.002], [0.0222, 0.0125, 0.0015]]), 0.0262, 0.049, 0.0009), ANO));
  // dust cover, sprung open below the port, on its hinge pin
  out.push(finish(rbox(0.0017, 0.0195, 0.07, 0.0006, 1).translate(0, -0.00975, 0).rotateZ(0.42).translate(0.0172, 0.0243, -0.05), ANO), finish(rod(0.0017, 0.011, 0.089, 0.0172, 0.0243, 8, 0.0003), STEEL));
  // charging handle
  out.push(finish(plate(fillet([[-0.027, -0.053], [-0.027, -0.0625, 0.002], [-0.02, -0.065, 0.004], [0.02, -0.065, 0.004], [0.027, -0.0625, 0.002], [0.027, -0.053], [0.0235, -0.0505, 0.002], [0.012, -0.05], [-0.012, -0.05], [-0.0235, -0.0505, 0.002]]), 0.053, 0.0592, 0.0009), ANO));
  out.push(finish(rbox(0.011, 0.0052, 0.0125, 0.0012).translate(-0.0208, 0.0561, 0.0585), STEEL));
}

function lower(out) {
  const main = fillet([[-0.076, 0.03], [-0.05, 0.03], [-0.05, 0.0142], [0.146, 0.0142, 0.0015], [0.146, -0.003, 0.004], [0.132, -0.0095], [0.056, -0.022], [-0.012, -0.022], [-0.016, -0.03], [-0.046, -0.026], [-0.058, -0.016, 0.004], [-0.076, 0.008, 0.006]]);
  out.push(finish(slab(main, 0.0225, 0.0009), ANO));
  out.push(finish(slab(fillet([[0.0575, 0.0138], [0.1315, 0.0138], [0.134, -0.066, 0.003], [0.059, -0.056, 0.003], [0.0575, -0.024]]), 0.0285, 0.0012), ANO));
  out.push(finish(tube(0.0186, 0.0146, -0.074, -0.05, 0, YB, 22, 0.0009), ANO));                  // buffer tower
  // flared mouth of the magazine well, a machined flat on each side, selector position marks
  out.push(finish(slab(fillet([[0.058, -0.049], [0.1345, -0.059], [0.1348, -0.0665, 0.002], [0.0585, -0.0565, 0.002]]), 0.0312, 0.0012), ANO));
  out.push(finish(slab(fillet([[0.064, 0.008], [0.126, 0.008], [0.1275, -0.04, 0.004], [0.066, -0.032, 0.004]], 0.002), 0.0293, 0.0006), ANO));
  for (const [sm, y, c] of [[-0.0085, 0.0045, MARK], [-0.02, 0.0135, MARK], [-0.0405, 0.0045, MARK_RED]]) out.push(finish(pin(0.0011, -0.01155, -0.0112, y, sm, 8, 0.0001), c));
  // pins
  out.push(finish(pin(0.0032, -0.0122, 0.0122, 0.0035, 0.1385), STEEL), finish(pin(0.0032, -0.0122, 0.0122, 0.0085, -0.034), STEEL));
  out.push(finish(pin(0.002, -0.0118, 0.0118, -0.006, 0.014, 10), STEEL), finish(pin(0.002, -0.0118, 0.0118, 0.002, 0.036, 10), STEEL));
  // bolt catch (left), with its grip ribs
  out.push(finish(slab(fillet([[0.06, 0.022], [0.073, 0.022], [0.073, 0.008], [0.0705, 0.006], [0.0705, -0.006], [0.0625, -0.006], [0.0625, 0.006], [0.06, 0.008]], 0.0015), 0.004, 0.0008, { x: -0.0158 }), STEEL));
  for (const y of [0.0115, 0.015, 0.0185]) out.push(finish(rbox(0.001, 0.0014, 0.0105, 0.0004, 1).translate(-0.0181, y, -0.0665), STEEL));
  // selector (left), set to AUTO
  out.push(finish(pin(0.005, -0.0138, -0.0108, 0.0045, -0.02), STEEL), finish(slab(rect(-0.038, 0.0015, -0.016, 0.0075, 0.0022), 0.0042, 0.0009, { x: -0.0155 }), STEEL));
  // magazine release (right) inside its fence
  out.push(finish(slab(rect(0.036, -0.013, 0.06, 0.009, 0.003), 0.0022, 0.0006, { x: 0.0122, holes: [rect(0.041, -0.008, 0.055, 0.004, 0.002)] }), ANO), finish(rbox(0.003, 0.009, 0.011, 0.001).translate(0.0125, -0.002, -0.048), STEEL));
  // trigger and guard
  out.push(finish(slab(fillet([[0.0105, -0.02], [0.0175, -0.02], [0.019, -0.03], [0.0205, -0.04], [0.0235, -0.049], [0.0205, -0.0505], [0.016, -0.042], [0.0135, -0.032]], 0.001), 0.0065, 0.0012), STEEL));
  out.push(finish(slab([[0.06, -0.0505], [0.06, -0.0545], [-0.014, -0.0595], [-0.014, -0.0555]], 0.0125, 0.0009), ANO));
  // pistol grip
  const grip = fillet([[-0.009, -0.0225], [-0.0125, -0.033, 0.003], [-0.019, -0.056, 0.01], [-0.03, -0.086, 0.01], [-0.044, -0.121, 0.005], [-0.086, -0.112, 0.005], [-0.079, -0.08, 0.02], [-0.066, -0.045, 0.02], [-0.064, -0.025, 0.006], [-0.056, -0.014, 0.004], [-0.048, -0.018]], 0, 4);
  out.push(finish(slab(grip, 0.03, 0.0048, { seg: 3 }), POLY));
}

function stock(out) {
  out.push(finish(lathe([[0, -0.24], [0.0125, -0.24], [0.0146, -0.2375], [0.0146, -0.05], [0, -0.05]], 22, 0, YB), ANO));     // receiver extension
  out.push(finish(slab(rect(-0.232, 0.0085, -0.068, 0.0215), 0.0105, 0.001), ANO));                                              // its position rail
  // castle nut and end plate
  const nut = []; for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; nut.push(...arc(0, 0, 0.0188, a, a + 0.66, 3), ...arc(0, 0, 0.0168, a + 0.7, a + 1.01, 2)); }
  out.push(finish(bar(nut, -0.066, -0.0555, 0.0005).translate(0, YB, 0), STEEL), finish(bar(rect(-0.016, YB - 0.027, 0.016, YB + 0.0185, 0.006), -0.0555, -0.05, 0.0005), STEEL));
  // collapsible stock body with its triangular window
  const body = fillet([[-0.104, 0.0535, 0.003], [-0.266, 0.0535, 0.006], [-0.2745, 0.044, 0.004], [-0.279, -0.066, 0.005], [-0.268, -0.073, 0.004], [-0.15, -0.008, 0.01], [-0.12, -0.012, 0.004], [-0.104, -0.004, 0.004]], 0, 4);
  out.push(finish(slab(body, 0.036, 0.0036, { seg: 3, holes: [fillet([[-0.18, 0.006], [-0.256, 0.006], [-0.258, -0.047], [-0.18, -0.004]], 0.005, 4)] }), POLY));
  out.push(finish(slab(fillet([[-0.275, 0.048], [-0.284, 0.045, 0.004], [-0.289, -0.067, 0.004], [-0.2795, -0.0705]], 0, 4), 0.038, 0.003, { seg: 3 }), RUBBER));
  out.push(finish(slab(fillet([[-0.12, -0.0125], [-0.15, -0.01], [-0.156, -0.02, 0.003], [-0.125, -0.023, 0.003]]), 0.018, 0.002), POLYB));     // release latch
  for (const sx of [-1, 1]) out.push(finish(pin(0.006, sx > 0 ? 0.0172 : -0.0192, sx > 0 ? 0.0192 : -0.0172, -0.02, -0.262, 14, 0.0006), STEEL));   // QD sling sockets
}

function handguard(out) {
  const a = 0.02, t = 0.0028, s0 = 0.17, s1 = 0.47, side = a * Math.tan(Math.PI / 8);
  const outline = [[-side, s0], [side, s0], [side, s1], [-side, s1]];
  for (let k = 0; k < 8; k++) {
    const holes = [];
    if (k % 2 === 0 && k !== 0) for (let i = 0; i < 7; i++) holes.push(swap(slot(0.2 + 0.04 * i, 0, 0.032, 0.007)));          // M-LOK
    else if (k % 2 === 1) for (let i = 0; i < 7; i++) holes.push(swap(slot(0.181 + 0.04 * i, 0, 0.02, 0.0055)));              // lightening cuts
    out.push(finish(plate(outline, a - t, a, 0.0005, { holes, seg: 1 }).rotateZ(k * Math.PI / 4).translate(0, YB, 0), ANO));
    const ang = Math.PI / 8 + k * Math.PI / 4, rc = (a - 0.0016) / Math.cos(Math.PI / 8);
    out.push(finish(rod(0.0016, s0, s1, Math.cos(ang) * rc, YB + Math.sin(ang) * rc, 6, 0.0003), ANO));                     // rounded corners
  }
  out.push(finish(tube(0.0222, 0.015, 0.15, 0.1715, 0, YB, 24, 0.001), ANO));                                                  // barrel-nut clamp
  for (const s of [0.1565, 0.166]) out.push(finish(pin(0.0027, -0.0146, 0.0146, YB - 0.0178, s, 10), STEEL));
  const oct = (r) => { const p = []; for (let k = 0; k < 8; k++) { const g = Math.PI / 8 + k * Math.PI / 4; p.push([Math.cos(g) * r, Math.sin(g) * r]); } return p; };
  out.push(finish(bar(oct((a + 0.0003) / Math.cos(Math.PI / 8)), 0.469, 0.472, 0.0005, { holes: [oct((a - t - 0.0012) / Math.cos(Math.PI / 8))] }).translate(0, YB, 0), ANO));
  // full-length top rail
  out.push(finish(bar([[-0.0079, YB + a - 0.001], [0.0079, YB + a - 0.001], [0.0079, 0.0611], [0.0104, 0.0636], [-0.0104, 0.0636], [-0.0079, 0.0611]], s0, s1), ANO));
  railLugs(out, 22, 51);
}

function barrel(out) {
  out.push(finish(rod(0.015, 0.15, 0.186, 0, YB, 16), DARK));                                                                  // barrel nut
  out.push(finish(lathe([[0, 0.15], [0.0125, 0.15], [0.0125, 0.16], [0.01, 0.162], [0.01, 0.335], [0.0095, 0.336], [0.0095, 0.365], [0.0093, 0.366], [0.0093, 0.47], [0.0086, 0.54], [0.0086, 0.5475], [0.0098, 0.548], [0.0098, 0.552], [0, 0.552]], 20, 0, YB), STEEL));
  // low-profile gas block and tube, seen through the handguard slots
  out.push(finish(tube(0.0128, 0.009, 0.337, 0.363, 0, YB, 16, 0.0008), DARK), finish(rbox(0.012, 0.009, 0.026, 0.002).translate(0, YB + 0.0145, -0.35), DARK));
  out.push(finish(rod(0.0022, 0.15, 0.345, 0, YB + 0.0158, 8, 0.0002), surf(0x6d6f73, 0.42, 1, 0.2, 34)));
  // birdcage flash hider: collar, five slots (closed underneath), crown
  out.push(finish(lathe([[0.0045, 0.552], [0.01, 0.552], [0.0109, 0.553], [0.0109, 0.56], [0.01, 0.561], [0.01, 0.564], [0.0109, 0.565], [0.0109, 0.572], [0.0045, 0.572], [0.0045, 0.552]], 20, 0, YB), STEEL));
  for (const [a0, a1] of [[-2, 26], [50, 78], [102, 130], [154, 182], [206, 334]]) out.push(finish(bar(sector(0.0068, 0.0109, a0 * DEG, a1 * DEG, a1 - a0 > 60 ? 12 : 4), 0.5715, 0.6035, 0.0004, { seg: 1 }).translate(0, YB, 0), STEEL));
  out.push(finish(lathe([[0.0048, 0.603], [0.0109, 0.603], [0.0109, 0.6105], [0.0098, 0.612], [0.0062, 0.612], [0.0048, 0.6095], [0.0048, 0.603]], 20, 0, YB), STEEL));
}

function optic(out) {
  // rail clamp and housing
  out.push(finish(bar(fillet([[-0.0135, 0.0606], [0.0135, 0.0606], [0.015, 0.064], [0.015, 0.0745], [-0.015, 0.0745], [-0.015, 0.064]], 0.001), 0.03, 0.108, 0.0008), DARK));
  out.push(finish(slab(fillet([[0.03, 0.0745], [0.108, 0.0745], [0.108, 0.085, 0.003], [0.104, 0.0893, 0.002], [0.05, 0.0893, 0.002], [0.038, 0.085, 0.004], [0.03, 0.082, 0.002]]), 0.036, 0.0018), ANO));
  // hood: two full-thickness frames joined by a relieved centre section
  const win = RIFLE.window;
  const frame = (g) => fillet([[-0.0204 + g, 0.0885, 0.0008], [0.0204 - g, 0.0885, 0.0008], [0.0204 - g, 0.1219 - g, 0.0085], [-0.0204 + g, 0.1219 - g, 0.0085]], 0, 5);
  out.push(finish(bar(frame(0), 0.05, 0.061, 0.0007, { holes: [win] }), ANO), finish(bar(frame(0), 0.093, 0.104, 0.0007, { holes: [win] }), ANO), finish(bar(frame(0.0012), 0.0605, 0.0935, 0, { holes: [win] }), ANO));
  // brightness buttons, battery cap, clamp lever and nut, zero adjusters
  for (const x of [-0.0078, 0.0078]) out.push(finish(rbox(0.0074, 0.005, 0.0022, 0.001).translate(x, 0.0786, -0.0297), RUBBER));
  out.push(finish(pin(0.0082, 0.0172, 0.0228, 0.08, 0.092, 12, 0.0008), ANO));
  out.push(finish(slab(rect(0.04, 0.0645, 0.085, 0.0725, 0.002), 0.003, 0.0008, { x: -0.0165 }), STEEL), finish(pin(0.0035, -0.0196, -0.015, 0.0685, 0.08, 10), STEEL));
  out.push(finish(pin(0.0046, 0.015, 0.0186, 0.0685, 0.058, 6), STEEL));
  for (const y of [0.097, 0.108]) out.push(finish(pin(0.003, 0.0185, 0.0212, y, 0.0655, 10), STEEL));
}

function sights(out) {
  const clamp = [[-0.0125, 0.061], [0.0125, 0.061], [0.0135, 0.064], [0.0135, 0.069], [-0.0135, 0.069], [-0.0135, 0.064]];
  out.push(finish(bar(clamp, -0.016, -0.004, 0.0006), POLYB), finish(slab(fillet([[-0.044, 0.0672], [-0.008, 0.0672], [-0.008, 0.075], [-0.038, 0.075], [-0.044, 0.072]], 0.0015), 0.017, 0.001), POLYB));
  out.push(finish(bar(clamp, 0.452, 0.464, 0.0006), POLYB), finish(slab(fillet([[0.42, 0.0672], [0.456, 0.0672], [0.456, 0.075], [0.426, 0.075], [0.42, 0.072]], 0.0015), 0.017, 0.001), POLYB));
}

function light(out) {
  const knurl = []; for (let i = 0; i < 6; i++) { const s = 0.377 + i * 0.008; knurl.push([0.0127, s], [0.0119, s + 0.001], [0.0119, s + 0.004], [0.0127, s + 0.005]); }
  const fins = []; for (let i = 0; i < 3; i++) { const s = 0.441 + i * 0.0065; fins.push([0.0165, s], [0.0153, s + 0.0008], [0.0153, s + 0.003], [0.0165, s + 0.0038]); }
  out.push(finish(lathe([[0, 0.353], [0.0138, 0.353], [0.0138, 0.37], [0.0127, 0.371], ...knurl, [0.0127, 0.428], [0.014, 0.43], [0.014, 0.434], [0.0165, 0.438], ...fins, [0.0165, 0.464], [0.0158, 0.466], [0.014, 0.466], [0.014, 0.463], [0, 0.463]], 22, LX, LY), ANO));
  out.push(finish(lathe([[0, 0.347], [0.004, 0.3475], [0.0062, 0.35], [0.0062, 0.3535], [0, 0.3535]], 14, LX, LY), RUBBER));
  out.push(finish(rbox(0.013, 0.009, 0.03, 0.002).rotateZ(Math.PI / 4).translate(-0.0172, YB + 0.0172, -0.396), ANO));
}

// Static parts of the rifle, merged into one geometry.
export function buildRifle() {
  const out = [];
  upper(out); lower(out); stock(out); handguard(out); barrel(out); optic(out); sights(out); light(out);
  return merge(out);
}

// Bolt carrier group, built at its in-battery position; slides back along +z when cycling.
export function buildBolt() {
  const grooves = []; for (let i = 0; i < 5; i++) { const s = 0.02 + i * 0.006; grooves.push([0.0122, s], [0.0112, s + 0.0008], [0.0112, s + 0.003], [0.0122, s + 0.0038]); }
  return merge([
    finish(lathe([[0, -0.04], [0.0122, -0.04], ...grooves, [0.0122, 0.062], [0.0114, 0.063], [0.0114, 0.079], [0.0122, 0.08], [0.0122, 0.0835], [0, 0.0835]], 18, 0, YB), BRIGHT),
    finish(rod(0.0095, 0.0835, 0.092, 0, YB, 12), STEEL),
  ]);
}

// 30-round polymer magazine with the top cartridge showing between the feed lips.
export function buildMagazine() {
  const R = 0.52, top = 0.006, bend = -0.045, ax = 0.094;
  const at = (d, off) => {
    const straight = top - bend;
    if (d <= straight) return [ax + off, top - d];
    const p = (d - straight) / R;
    return [ax + R * (1 - Math.cos(p)) + Math.cos(p) * off, bend - R * Math.sin(p) + Math.sin(p) * off];
  };
  const band = (d0, d1, half, n) => { const f = [], r = []; for (let i = 0; i <= n; i++) { const d = d0 + (d1 - d0) * i / n; f.push(at(d, half)); r.push(at(d, -half)); } return [...f, ...r.reverse()]; };
  const out = [finish(slab(band(0, 0.178, 0.0305, 16), 0.0224, 0.0014), POLY)];
  for (let i = 0; i < 5; i++) out.push(finish(slab(band(0.072 + i * 0.019, 0.084 + i * 0.019, 0.0311, 3), 0.0234, 0.0008, { seg: 1 }), POLY));
  out.push(finish(slab(band(0.173, 0.184, 0.0335, 2), 0.0262, 0.0016), POLYB));
  out.push(finish(lathe([[0, 0.066], [0.0044, 0.066], [0.0048, 0.0668], [0.0048, 0.0675], [0.0042, 0.068], [0.0042, 0.0688], [0.0048, 0.0695], [0.0048, 0.104], [0.0032, 0.1085], [0.0032, 0.1125], [0, 0.1125]], 12, 0.002, 0.0105), BRASS));
  out.push(finish(lathe([[0, 0.112], [0.0029, 0.112], [0.0029, 0.115], [0.0022, 0.12], [0.001, 0.1235], [0, 0.1242]], 12, 0.002, 0.0105), COPPER));
  return merge(out);
}
