// Shared by server and client. Keep this file free of DOM / three.js / node imports.

export const TICK_HZ = 60;        // server simulation rate
export const SNAP_HZ = 30;        // snapshot broadcast rate
export const INTERP_MS = 100;     // how far behind "now" clients render remote entities
export const HISTORY_MS = 1200;   // how much snapshot history the server keeps for lag compensation

export const PLAYER = {
  halfWidth: 0.3,
  height: 1.8,
  crouchHeight: 1.15,
  eye: 1.62,
  crouchEye: 1.05,
  walk: 4.4,
  sprint: 6.7,
  crouch: 2.3,
  ads: 2.9,
  jumpV: 5.6,
  gravity: 19,
  step: 0.34,
  maxHp: 100,
  regenDelay: 5,      // seconds without damage before regen starts
  regenRate: 22,      // hp per second
  respawnDelay: 5,
};

export const AR = {
  name: 'MK4 CARBINE',
  rpm: 720,
  damage: 32,
  mag: 30,
  reserve: 180,
  range: 220,
  reloadTime: 2.25,
};

// The knife, drawn with the support hand while the rifle stays in the other.
export const KNIFE = {
  damage: 150,      // the same wherever it lands
  range: 1.9,       // metres from the eye
  radius: 0.2,      // the cut is swept as a sphere this size: it needs pointing, not a bullet's aim
  time: 0.84,       // draw, cut and back onto the rifle; the hands do nothing else meanwhile
  hitAt: 0.3,       // when the edge crosses the middle of the view
};

// Damage multipliers by hit group.
export const PART_MULT = { head: 4.0, chest: 1.0, stomach: 1.0, arm: 0.75, leg: 0.7 };

export const TYPE_NAMES = ['grunt', 'rusher', 'heavy'];

export const ENEMY = {
  grunt: {
    label: 'GUNMAN', hp: 100, scale: 1.0, bulk: 1.0, melee: false,
    speed: 3.3, stride: 0.42, cadence: 11.5,
    range: 34, pref: 15, react: 0.75, spread: 2.5, damage: 8, rps: 8.5, burst: [3, 5], pause: [900, 1700],
    score: 100, headMult: 1,
  },
  rusher: {
    label: 'RUSHER', hp: 65, scale: 0.97, bulk: 0.9, melee: true,
    speed: 5.7, stride: 0.52, cadence: 13,
    range: 0, pref: 0, react: 0, spread: 0, damage: 24, rps: 0, burst: [0, 0], pause: [0, 0],
    score: 75, headMult: 1,
  },
  heavy: {
    label: 'HEAVY', hp: 340, scale: 1.12, bulk: 1.28, melee: false,
    speed: 2.1, stride: 0.38, cadence: 8.5,
    range: 38, pref: 11, react: 1.0, spread: 3.4, damage: 8, rps: 11, burst: [6, 11], pause: [1400, 2300],
    score: 300, headMult: 0.5,   // armoured helmet halves the headshot bonus
  },
};

// Rig definition for player characters as seen by other players.
export const PLAYER_RIG = { scale: 1.0, bulk: 1.0, stride: 0.44, melee: false };

// Indices into snapshot arrays (kept flat + numeric so they are cheap to send and to rewind).
export const E = { ID: 0, TYPE: 1, X: 2, Y: 3, Z: 4, YAW: 5, PITCH: 6, PH: 7, MV: 8, CR: 9, AIM: 10, ATK: 11 };
export const P = { ID: 0, X: 1, Y: 2, Z: 3, YAW: 4, PITCH: 5, PH: 6, MV: 7, CR: 8, FLAGS: 9, HP: 10 };

export const PF = { ALIVE: 1, SPRINT: 2, ADS: 4, VAULT: 8, RELOAD: 16, AIR: 32 };

export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Interpolates two enemy snapshot rows. MUST stay bit-identical on client and server:
// the client renders (and aims at) exactly this, and the server rewinds to exactly this.
export function lerpEnemy(a, b, t, o) {
  if (!b) { b = a; t = 0; }
  o.id = a[0]; o.type = a[1];
  o.x = a[2] + (b[2] - a[2]) * t;
  o.y = a[3] + (b[3] - a[3]) * t;
  o.z = a[4] + (b[4] - a[4]) * t;
  o.yaw = lerpAngle(a[5], b[5], t);
  o.pitch = a[6] + (b[6] - a[6]) * t;
  o.ph = a[7] + (b[7] - a[7]) * t;
  o.mv = a[8] + (b[8] - a[8]) * t;
  o.cr = a[9] + (b[9] - a[9]) * t;
  o.aim = a[10] + (b[10] - a[10]) * t;
  o.atk = b[11] < a[11] ? a[11] : a[11] + (b[11] - a[11]) * t;
  return o;
}

export function lerpPlayer(a, b, t, o) {
  if (!b) { b = a; t = 0; }
  o.id = a[0];
  // Respawns teleport: don't streak across the map.
  const far = Math.abs(b[1] - a[1]) + Math.abs(b[3] - a[3]) > 6;
  if (far) { t = 1; }
  o.x = a[1] + (b[1] - a[1]) * t;
  o.y = a[2] + (b[2] - a[2]) * t;
  o.z = a[3] + (b[3] - a[3]) * t;
  o.yaw = lerpAngle(a[4], b[4], t);
  o.pitch = a[5] + (b[5] - a[5]) * t;
  o.ph = a[6] + (b[6] - a[6]) * t;
  o.mv = a[7] + (b[7] - a[7]) * t;
  o.cr = a[8] + (b[8] - a[8]) * t;
  o.flags = a[9];
  o.hp = a[10];
  o.aim = (o.flags & PF.SPRINT) || (o.flags & PF.VAULT) ? 0 : 1;
  o.atk = 0;
  return o;
}

export const r3 = (v) => Math.round(v * 1000) / 1000;
export const r4 = (v) => Math.round(v * 10000) / 10000;
