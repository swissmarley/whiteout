// Enemies and other players. One modelled mesh per capsule of the shared rig, posed straight
// from it every frame, and the same per-frame rig is what local shots are ray-tested against.

import * as THREE from 'three';
import { computeRig, makeRig, rayRig, SEG, SEG_COUNT, segRadius } from '../shared/rig.js';
import { ENEMY, TYPE_NAMES, PLAYER_RIG } from '../shared/constants.js';
import { nameTagTex, clothSet, grainSet } from './textures.js';
import { surfaceMaterial } from './mesh.js';
import { buildBody } from './bodies.js';

const Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _m = new THREE.Matrix4();

const PALETTE = {
  grunt: { jacket: 0x414638, pants: 0x25272b, vest: 0x17181a, helmet: 0x353a30, skin: 0x0f0f10, glove: 0x141414, boot: 0x0c0c0d, gear: 0x202225 },
  rusher: { jacket: 0x6b2c25, pants: 0x394150, vest: 0x6b2c25, helmet: 0x571f1a, skin: 0xcfc7b6, glove: 0x1a1a1a, boot: 0x16130f, gear: 0x2a2320 },
  heavy: { jacket: 0x262a31, pants: 0x1c1e22, vest: 0x34383f, helmet: 0x2a2e35, skin: 0x0c0c0d, glove: 0x101010, boot: 0x0a0a0b, gear: 0x3d424a },
  player: { jacket: 0x2a4c78, pants: 0x25272b, vest: 0x1d2530, helmet: 0x2a4c78, skin: 0x161616, glove: 0x4a4e54, boot: 0x0c0c0d, gear: 0x7fb6ee },
};

const RIGS = { grunt: ENEMY.grunt, rusher: ENEMY.rusher, heavy: ENEMY.heavy, player: PLAYER_RIG };
const cache = new Map();

// Geometry for one character type: 16 body parts (indexed by SEG) and the weapon. Built once.
function buildParts(kind) {
  if (!cache.has(kind)) cache.set(kind, buildBody(kind, RIGS[kind], PALETTE[kind]));
  return cache.get(kind);
}

let bodyMat = null, gunMat = null;
const visorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.25, 0.12) });
function materials() {
  if (bodyMat) return;
  const cloth = clothSet(), grain = grainSet();
  cloth.roughnessMap.repeat.setScalar(0.1); grain.roughnessMap.repeat.setScalar(0.12);
  bodyMat = surfaceMaterial({ ...cloth, normalScale: 0.9 });
  gunMat = surfaceMaterial({ ...grain, normalScale: 0.5 });
}

function setFromSeg(mesh, rig, i, ox, oy, oz) {
  const k = i * 3, a = rig.a, b = rig.b;
  _a.set(a[k] - ox, a[k + 1] - oy, a[k + 2] - oz); _b.set(b[k] - ox, b[k + 1] - oy, b[k + 2] - oz);
  mesh.position.copy(_a).add(_b).multiplyScalar(0.5);
  _d.copy(_b).sub(_a);
  const len = _d.length();
  if (len > 1e-4) mesh.quaternion.setFromUnitVectors(Y, _d.divideScalar(len));
}

// Roll a limb about its own axis so its -z side looks towards `ref`. setFromSeg only aims the
// bone; without this a knee pad or boot would sit wherever the shortest rotation left it.
function face(mesh, rig, i, ref) {
  const k = i * 3, a = rig.a, b = rig.b;
  _y.set(b[k] - a[k], b[k + 1] - a[k + 1], b[k + 2] - a[k + 2]);
  if (_y.lengthSq() < 1e-8) return;
  _y.normalize();
  _z.copy(ref).addScaledVector(_y, -ref.dot(_y));
  if (_z.lengthSq() < 1e-8) return;
  _z.normalize().negate();
  mesh.quaternion.setFromRotationMatrix(_m.makeBasis(_x.crossVectors(_y, _z), _y, _z));
}
const ARMS = [[SEG.UARM_L, SEG.LARM_L, SEG.HAND_L], [SEG.UARM_R, SEG.LARM_R, SEG.HAND_R]];
const LEGS = [[SEG.ULEG_L, SEG.LLEG_L, SEG.FOOT_L], [SEG.ULEG_R, SEG.LLEG_R, SEG.FOOT_R]];

// Place the 16 part meshes on a rig. ox,oy,oz: origin they are expressed relative to.
export function poseParts(M, rig, ox = 0, oy = 0, oz = 0) {
  for (let i = 0; i < SEG_COUNT; i++) setFromSeg(M[i], rig, i, ox, oy, oz);
  const a = rig.a, b = rig.b;
  _f.set(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw));
  for (const [u, l, h] of ARMS) {
    // elbows point away from the shoulder-to-hand line; the hand follows the forearm
    const ku = u * 3, kl = l * 3;
    _r.set(b[ku] - (a[ku] + b[kl]) / 2, b[ku + 1] - (a[ku + 1] + b[kl + 1]) / 2, b[ku + 2] - (a[ku + 2] + b[kl + 2]) / 2);
    if (_r.lengthSq() < 1e-8) _r.copy(_f).negate();
    face(M[u], rig, u, _r); face(M[l], rig, l, _r); M[h].quaternion.copy(M[l].quaternion);
  }
  for (const [u, l, f] of LEGS) { face(M[u], rig, u, _f); face(M[l], rig, l, _f); face(M[f], rig, f, Y); }
  face(M[SEG.NECK], rig, SEG.NECK, _f);
  _e.set(-rig.lean, rig.yaw, 0); M[SEG.CHEST].quaternion.setFromEuler(_e); M[SEG.STOMACH].quaternion.setFromEuler(_e);
  _e.set(rig.pitch * 0.7 - rig.lean * 0.4, rig.yaw, 0); M[SEG.HEAD].quaternion.setFromEuler(_e);
}

class Actor {
  constructor(scene, kind, def, name) {
    this.kind = kind; this.def = def;
    this.rig = makeRig();
    this.state = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, ph: 0, mv: 0, cr: 0, aim: 0, atk: 0 };
    this.group = new THREE.Group();
    const { parts, weapon } = buildParts(kind);
    this.meshes = parts.map((g, i) => {
      const m = new THREE.Mesh(g, bodyMat);
      m.castShadow = i !== SEG.NECK && i !== SEG.HAND_L && i !== SEG.HAND_R; m.receiveShadow = true;
      this.group.add(m); return m;
    });
    this.weapon = new THREE.Mesh(weapon, gunMat); this.weapon.castShadow = true; this.group.add(this.weapon);
    if (kind === 'heavy') {
      const hr = segRadius(SEG.HEAD, def);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(hr * 1.2, hr * 0.12, hr * 0.2), visorMat); visor.position.set(0, hr * 0.12, -hr * 1.05);
      this.meshes[SEG.HEAD].add(visor);
    }
    if (name) {
      this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTagTex(name), transparent: true, depthWrite: false, sizeAttenuation: true }));
      this.tag.scale.set(1.3, 0.325, 1); this.tag.renderOrder = 20; this.group.add(this.tag);
    }
    scene.add(this.group);
    this.seen = true;
  }

  // ox,oy,oz: origin the meshes are expressed relative to (0 for live actors, feet for corpses)
  pose(ox = 0, oy = 0, oz = 0) {
    const rig = this.rig;
    poseParts(this.meshes, rig, ox, oy, oz);
    // weapon: -Z along wdir, up as close to world up as possible
    _z.set(-rig.wdir[0], -rig.wdir[1], -rig.wdir[2]);
    _x.crossVectors(Y, _z); if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0); _x.normalize();
    _y.crossVectors(_z, _x);
    this.weapon.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    this.weapon.position.set(rig.grip[0] - ox, rig.grip[1] - oy, rig.grip[2] - oz);
    if (this.tag) this.tag.position.set(rig.head[0] - ox, rig.head[1] - oy + 0.42, rig.head[2] - oz);
  }

  dispose(scene) { scene.remove(this.group); if (this.tag) { this.tag.material.map.dispose(); this.tag.material.dispose(); } }
}

export class Actors {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    materials();
    for (const kind of Object.keys(RIGS)) buildParts(kind);     // model everything up front, not mid-fight
    this.enemies = new Map(); this.players = new Map();
    this.corpses = [];
    this.dead = new Map();     // id -> time until which stale snapshot rows are ignored
    this.hit = { id: 0, seg: -1, t: -1 };
  }

  sync(net, localId, names, now) {
    for (const a of this.enemies.values()) a.seen = false;
    for (const st of net.enemies.values()) {
      if (this.dead.has(st.id)) continue;
      let a = this.enemies.get(st.id);
      if (!a) { const kind = TYPE_NAMES[st.type]; a = new Actor(this.scene, kind, ENEMY[kind]); a.id = st.id; this.enemies.set(st.id, a); }
      Object.assign(a.state, st);
      computeRig(st, a.def, a.rig);
      a.pose(); a.seen = true;
    }
    for (const [id, a] of this.enemies) if (!a.seen) { a.dispose(this.scene); this.enemies.delete(id); }

    for (const a of this.players.values()) a.seen = false;
    for (const st of net.players.values()) {
      if (st.id === localId) continue;
      let a = this.players.get(st.id);
      if (!a) { a = new Actor(this.scene, 'player', PLAYER_RIG, names.get(st.id) || 'Player'); a.id = st.id; this.players.set(st.id, a); }
      const alive = (st.flags & 1) === 1;
      a.group.visible = alive;
      a.seen = true;
      if (!alive) continue;
      Object.assign(a.state, st);
      computeRig(st, a.def, a.rig);
      a.pose();
    }
    for (const [id, a] of this.players) if (!a.seen) { a.dispose(this.scene); this.players.delete(id); }
    for (const [id, until] of this.dead) if (now > until) this.dead.delete(id);
  }

  // Nearest enemy capsule along a ray, against exactly the pose drawn this frame. `pad` sweeps
  // a sphere of that radius instead of a line (the knife).
  raycast(ox, oy, oz, dx, dy, dz, maxT, pad = 0) {
    const h = this.hit; h.id = 0; h.seg = -1; h.t = -1;
    let best = maxT;
    for (const a of this.enemies.values()) {
      const r = rayRig(a.rig, ox, oy, oz, dx, dy, dz, best, pad);
      if (r.seg >= 0) { best = r.t; h.id = a.id; h.seg = r.seg; h.t = r.t; }
    }
    return h.id ? h : null;
  }

  // Move `p` onto the surface of an enemy's capsule: where a swept hit actually touched it.
  touch(id, seg, p) {
    const a = this.enemies.get(id);
    if (!a || seg < 0) return p;
    const k = seg * 3, A = a.rig.a, B = a.rig.b;
    _a.set(A[k], A[k + 1], A[k + 2]); _d.set(B[k], B[k + 1], B[k + 2]).sub(_a);
    const l2 = _d.lengthSq(), u = l2 > 1e-8 ? Math.min(1, Math.max(0, _b.copy(p).sub(_a).dot(_d) / l2)) : 0;
    _a.addScaledVector(_d, u);
    const dist = _b.copy(p).sub(_a).length();
    return dist > 1e-5 ? p.copy(_a).addScaledVector(_b, a.rig.r[seg] / dist) : p.copy(_a);
  }

  kill(id, dx, dz, headshot, now) {
    this.dead.set(id, now + 600);
    const a = this.enemies.get(id);
    if (!a) return null;
    this.enemies.delete(id);
    const l = Math.hypot(dx, dz) || 1;
    const c = { a, t: 0, fx: dx / l, fz: dz / l, st: { ...a.state }, dur: headshot ? 0.42 : 0.6, pooled: false, twist: (Math.random() - 0.5) * 0.5 };
    c.pos = new THREE.Vector3(c.st.x, c.st.y, c.st.z);
    c.axis = new THREE.Vector3(c.fz, 0, -c.fx);
    c.st.x = c.st.y = c.st.z = 0;
    this.corpses.push(c);
    return c.pos;
  }

  update(dt) {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.t += dt;
      if (c.t < c.dur + 0.3) {
        const k = Math.min(1, c.t / c.dur), e = k * k * (2.2 - 1.2 * k);
        c.st.cr = Math.min(0.55, c.t / 0.25 * 0.55); c.st.aim = Math.max(0, c.st.aim - dt * 6); c.st.mv = 0; c.st.atk = 0;
        c.st.pitch += (0.5 - c.st.pitch) * Math.min(1, dt * 6);
        computeRig(c.st, c.a.def, c.a.rig);
        c.a.pose(0, 0, 0);
        c.a.group.position.set(c.pos.x, c.pos.y + 0.13 * e, c.pos.z);
        c.a.group.quaternion.setFromAxisAngle(c.axis, e * 1.5);
        _e.set(0, c.twist * e, 0); c.a.group.quaternion.multiply(new THREE.Quaternion().setFromEuler(_e));
      }
      if (!c.pooled && c.t > c.dur) { c.pooled = true; this.fx.bloodPool(c.pos.x + c.fx * 0.9, c.pos.y + 0.001, c.pos.z + c.fz * 0.9); this.fx.snowPuff(c.pos.x + c.fx * 0.8, c.pos.y, c.pos.z + c.fz * 0.8, 8, 1.2); }
      if (c.t > 9) c.a.group.position.y -= dt * 0.09;
      if (c.t > 12 || this.corpses.length - i > 14) { c.a.dispose(this.scene); this.corpses.splice(i, 1); }
    }
  }

  clearCorpses() { for (const c of this.corpses) c.a.dispose(this.scene); this.corpses.length = 0; }
}
