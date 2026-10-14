// The alley. Pure data: the server builds collision + navigation from it, the client builds
// collision + visuals from it. Units are metres. x = east, z = south, y = up.
//
// Layout (top-down, not to scale):
//
//                 N fence
//          +--------||--------+
//          |  NW1   ||  NE1   |
//          |  [N]>  ||  [G]   |        [N],[S],[W],[E],[G] = covered spawn bays
//          |        ||v-------+
//          |        ||  court | NE2
//   NW3    | NW2    ||  yard  |
//      [W] |        || NE3 |p |
//  ==W=====+========++=====+a=+===E==   <- cross alley
//          |  SW1   || SE1   [E] SE2
//          | nook   ||        |
//          |  SW2   ||  SE3   |
//          |        || <[S]   |
//          +--------||--------+
//                 S fence

export const BOUNDS = { x0: -28, z0: -38, x1: 28, z1: 38 };   // navigable region
export const FLOOR_H = 3.3;

// --- Buildings -------------------------------------------------------------------------
// style: 0 red brick, 1 brown brick, 2 dark clinker
const B = (id, x0, z0, x1, z1, h, style, y0 = 0) => ({ id, x0, z0, x1, z1, h, style, y0 });

export const BUILDINGS = [
  // North-west
  B('NW1a', -20, -44, -4, -34, 15, 0),
  B('NW1b', -20, -34, -8, -30, 15, 0),
  B('NW1c', -20, -30, -4, -17, 15, 0),
  B('NW1r', -8, -34, -4, -30, 15, 0, 3.2),     // floors above spawn bay N
  B('NW2', -20, -17, -4, -3, 11, 1),
  B('NW3a', -34, -44, -20, -7, 18, 2),
  B('NW3b', -34, -7, -24, -3, 18, 2),
  B('NW3r', -24, -7, -20, -3, 18, 2, 3.2),     // above spawn bay W
  // South-west
  B('SW1a', -34, 3, -4, 13, 13, 1),
  B('SW1b', -34, 13, -13, 22, 13, 1),
  B('SW2', -34, 22, -4, 44, 17, 0),
  // South-east
  B('SE1', 4, 3, 20, 18, 12, 2),
  B('SE2a', 24, 3, 34, 7, 16, 0),
  B('SE2b', 20, 7, 34, 18, 16, 0),
  B('SE2r', 20, 3, 24, 7, 16, 0, 3.2),         // above spawn bay E
  B('SE3', 4, 18, 34, 30, 19, 1),
  B('SE4a', 8, 30, 34, 34, 19, 1),
  B('SE4b', 4, 34, 34, 44, 19, 1),
  B('SE4r', 4, 30, 8, 34, 19, 1, 3.2),         // above spawn bay S
  // North-east
  B('NE1a', 4, -44, 8, -24, 16, 1),
  B('NE1b', 8, -44, 13, -28, 16, 1),
  B('NE1c', 13, -44, 34, -24, 16, 1),
  B('NE1r', 8, -28, 13, -24, 16, 1, 3.2),      // above garage bay G
  B('NE2a', 20, -24, 34, -3, 13, 0),
  B('NE2b', 17, -10, 20, -3, 13, 0),
  B('NE3', 4, -10, 14, -3, 9, 2),
];

// Covered bays enemies spawn in (interior rectangles, used for lighting + spawn points).
export const BAYS = [
  { id: 'N', x0: -8, z0: -34, x1: -4, z1: -30, open: 'e' },
  { id: 'S', x0: 4, z0: 30, x1: 8, z1: 34, open: 'w' },
  { id: 'W', x0: -24, z0: -7, x1: -20, z1: -3, open: 's' },
  { id: 'E', x0: 20, z0: 3, x1: 24, z1: 7, open: 'n' },
  { id: 'G', x0: 8, z0: -28, x1: 13, z1: -24, open: 's' },
];

export const ENEMY_SPAWNS = [
  { x: -6.6, z: -32.6 }, { x: -6.6, z: -31.2 },
  { x: 6.6, z: 31.2 }, { x: 6.6, z: 32.6 },
  { x: -22.6, z: -5.6 }, { x: -21.2, z: -5.6 },
  { x: 21.2, z: 5.6 }, { x: 22.6, z: 5.6 },
  { x: 9.6, z: -26.6 }, { x: 11.4, z: -26.6 },
];

export const PLAYER_SPAWNS = [
  { x: 0, y: 0, z: 0.5, yaw: 0 },
  { x: -8.5, y: 0, z: 17.5, yaw: -Math.PI / 2 },
  { x: 12, y: 0, z: -13, yaw: Math.PI / 2 },
  { x: 0, y: 0, z: -26, yaw: Math.PI },
  { x: 0, y: 0, z: 22, yaw: 0 },
  { x: -15, y: 0, z: 0, yaw: -Math.PI / 2 },
  { x: 16, y: 0, z: -0.8, yaw: Math.PI / 2 },
  { x: 17, y: 1.2, z: -21.5, yaw: Math.PI / 2 },
];

// --- Props -----------------------------------------------------------------------------
// Every prop is one (or for vehicles, two) axis-aligned boxes so the server and client
// collide against exactly the same shapes the player sees.
const props = [];
const prop = (t, x0, z0, x1, z1, h, o = {}) => { props.push({ t, x0, z0, x1, z1, h, y0: 0, ...o }); };

// alley end caps (chain-link: bullets pass, bodies don't)
prop('fence', -4, -36.06, 4, -35.94, 3.0, { pass: true, noVault: true, axis: 'x' });
prop('fence', -4, 35.94, 4, 36.06, 3.0, { pass: true, noVault: true, axis: 'x' });
prop('fence', -26.06, -3, -25.94, 3, 3.0, { pass: true, noVault: true, axis: 'z' });
prop('fence', 25.94, -3, 26.06, 3, 3.0, { pass: true, noVault: true, axis: 'z' });

// main alley, north half
prop('pallets', 2.7, -34.6, 3.9, -33.4, 0.75);
prop('crate', 2.6, -29.1, 3.7, -28.0, 1.1);
prop('crate', 1.5, -28.9, 2.5, -27.9, 1.0);
prop('crate', 2.75, -28.95, 3.55, -28.15, 0.8, { y0: 1.1 });
prop('barrier', -1.6, -21.3, 1.6, -20.7, 0.85, { axis: 'x' });
prop('dumpster', -3.95, -13.2, -2.8, -11.0, 1.35, { axis: 'z', color: 0 });
prop('firebarrel', -3.55, -5.05, -2.95, -4.45, 0.9);
prop('lowwall', 3.8, -24, 4.2, -19.5, 1.1, { axis: 'z' });
prop('lowwall', 3.8, -14.5, 4.2, -10, 1.1, { axis: 'z' });

// main alley, south half
prop('car', 1.7, 7.6, 3.6, 12.2, 1.45, { axis: 'z', color: 0 });
prop('crate', 2.8, 19.5, 3.9, 20.6, 1.1);
prop('crate', 2.0, 20.7, 2.9, 21.6, 0.9);
prop('dumpster', -3.95, 24.2, -2.8, 26.4, 1.35, { axis: 'z', color: 1 });
prop('barrier', 0.4, 27.7, 3.4, 28.3, 0.85, { axis: 'x' });
prop('van', -3.7, 30.2, -1.5, 35.4, 2.3, { axis: 'z' });

// cross alley, west arm
prop('dumpster', -12.6, -2.95, -10.4, -1.8, 1.35, { axis: 'x', color: 1 });
prop('crate', -17.0, 1.85, -15.9, 2.95, 1.1);
prop('crate', -18.1, 1.95, -17.1, 2.95, 1.0);
prop('barrier', -8.3, -0.2, -7.7, 3.0, 0.85, { axis: 'z' });
prop('barrel', -19.3, -2.9, -18.7, -2.3, 0.9);
prop('barrel', -18.6, -2.9, -18.0, -2.3, 0.9);

// cross alley, east arm
prop('car', 7.6, 0.9, 12.2, 2.8, 1.45, { axis: 'x', color: 1 });
prop('dumpster', 18.0, -2.95, 20.2, -1.8, 1.35, { axis: 'x', color: 0 });
prop('barrier', 20.5, 0.6, 23.5, 1.2, 0.85, { axis: 'x' });

// courtyard: loading dock with stairs, parked car, clutter
prop('dock', 14, -24, 20, -19.5, 1.2, { walk: true });
prop('step', 18.5, -18.0, 20, -17.5, 0.3, { walk: true });
prop('step', 18.5, -18.5, 20, -18.0, 0.6, { walk: true });
prop('step', 18.5, -19.0, 20, -18.5, 0.9, { walk: true });
prop('step', 18.5, -19.5, 20, -19.0, 1.2, { walk: true });
prop('ammo', 14.3, -23.75, 15.4, -23.05, 0.5, { y0: 1.2 });
prop('dumpster', 5.0, -11.15, 7.2, -10.0, 1.35, { axis: 'x', color: 0 });
prop('crate', 9.0, -17.2, 10.1, -16.1, 1.1);
prop('crate', 10.2, -17.0, 11.2, -16.0, 1.0);
prop('crate', 9.2, -16.0, 10.2, -15.0, 1.0);
prop('barrel', 18.9, -12.0, 19.5, -11.4, 0.9);
prop('barrel', 18.2, -11.3, 18.8, -10.7, 0.9);
prop('car', 5.6, -22.6, 7.5, -18.0, 1.45, { axis: 'z', color: 2 });

// side passage
prop('crate', 14.0, -7.2, 14.9, -6.3, 0.9);

// south-west nook
prop('dumpster', -12.95, 14.5, -11.8, 16.7, 1.35, { axis: 'z', color: 1 });
prop('ammo', -9.3, 21.25, -8.2, 21.95, 0.5);
prop('crate', -6.2, 13.1, -5.1, 14.2, 1.1);
prop('pallets', -12.8, 19.5, -11.6, 20.7, 0.75);

export const PROPS = props;

// Ammo resupply points (centre of each ammo crate).
export const AMMO_POINTS = props.filter((p) => p.t === 'ammo')
  .map((p) => ({ x: (p.x0 + p.x1) / 2, y: p.y0 + p.h, z: (p.z0 + p.z1) / 2 }));

const PROP_MAT = {
  fence: 'metal', pallets: 'wood', crate: 'wood', barrier: 'concrete', dumpster: 'metal',
  firebarrel: 'metal', barrel: 'metal', lowwall: 'brick', car: 'metal', van: 'metal',
  dock: 'concrete', step: 'concrete', ammo: 'metal',
};
// props whose top is under a layer of snow
const SNOWY = { pallets: 1, crate: 1, barrier: 1, dumpster: 1, lowwall: 1, car: 1, van: 1, dock: 1, step: 1, barrel: 1 };

function buildSolids() {
  const out = [];
  for (const b of BUILDINGS) {
    out.push({ x0: b.x0, y0: b.y0, z0: b.z0, x1: b.x1, y1: b.h, z1: b.z1, mat: 'brick', building: b.id, noVault: true });
  }
  for (const p of PROPS) {
    const base = { mat: PROP_MAT[p.t] || 'concrete', prop: p.t, pass: !!p.pass, noVault: !!p.noVault, walk: !!p.walk, snowTop: !!SNOWY[p.t] };
    if (p.t === 'car') {
      // body (bonnet/boot height) + cabin, so you can mantle the bonnet and then the roof
      const bodyH = 0.92;
      out.push({ ...base, x0: p.x0, y0: 0, z0: p.z0, x1: p.x1, y1: bodyH, z1: p.z1 });
      const len = p.axis === 'z' ? p.z1 - p.z0 : p.x1 - p.x0;
      const c0 = 0.30 * len, c1 = 0.74 * len;
      if (p.axis === 'z') out.push({ ...base, mat: 'glass', x0: p.x0 + 0.08, y0: bodyH, z0: p.z0 + c0, x1: p.x1 - 0.08, y1: p.h, z1: p.z0 + c1 });
      else out.push({ ...base, mat: 'glass', x0: p.x0 + c0, y0: bodyH, z0: p.z0 + 0.08, x1: p.x0 + c1, y1: p.h, z1: p.z1 - 0.08 });
    } else {
      out.push({ ...base, x0: p.x0, y0: p.y0, z0: p.z0, x1: p.x1, y1: p.y0 + p.h, z1: p.z1 });
    }
  }
  return out;
}

export const SOLIDS = buildSolids();

// --- Lights (positions are shared so the server could reason about them later) ---------
export const LAMPS = [
  { x: -3.2, y: 5.4, z: -24, wall: 'w', shadow: true },
  { x: 3.2, y: 5.4, z: 15.5, wall: 'e', shadow: true },
  { x: -15, y: 5.4, z: -2.2, wall: 'n', shadow: true },
  { x: 14, y: 5.4, z: 2.2, wall: 's', shadow: true },
  { x: 10.5, y: 5.8, z: -23.2, wall: 'n', shadow: true },
  { x: -3.2, y: 5.4, z: 31, wall: 'w', shadow: false, flicker: true },
  { x: 3.2, y: 5.4, z: -31.5, wall: 'e', shadow: false },
];

export const FIRE = { x: -3.25, y: 0.95, z: -4.75 };
export const NEON = { x: 5.6, y: 3.7, z: 2.86 };
export const STEAM = [
  { x: 0.9, y: 0.05, z: 1.3, rate: 14, rise: 1.5, size: 0.9 },      // manhole at the crossing
  { x: 3.85, y: 0.7, z: -8.4, rate: 7, rise: 0.9, size: 0.5, vx: -0.5 },
  { x: -14.2, y: 2.6, z: 2.85, rate: 6, rise: 0.8, size: 0.5, vz: -0.4 },
];

export function typeMat(solid, ny) {
  if (!solid || solid.ground) return 'snow';
  if (ny > 0.5 && solid.snowTop) return 'snow';
  return solid.mat || 'concrete';
}
