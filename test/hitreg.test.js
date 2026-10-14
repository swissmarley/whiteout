// Unit tests for the shared geometry + rig that both sides use for hit registration.
// Run with explicit paths (npm test) - never a bare `node --test`, which would also try to
// execute the exFAT "._*.test.js" sidecar files.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rayBox, rayCapsule, raycastWorld, clearLine } from '../shared/collide.js';
import { computeRig, makeRig, rayRig, SEG, SEG_GROUP } from '../shared/rig.js';
import { ENEMY, PLAYER, lerpEnemy } from '../shared/constants.js';
import { SOLIDS, ENEMY_SPAWNS, PLAYER_SPAWNS } from '../shared/map.js';
import { Nav } from '../server/nav.js';

const still = (o = {}) => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, ph: 0, mv: 0, cr: 0, aim: 1, atk: 0, ...o });

test('rayBox reports entry distance and face normal', () => {
  const box = { x0: -1, y0: 0, z0: -1, x1: 1, y1: 2, z1: 1 };
  const n = [0, 0, 0];
  assert.equal(rayBox(0, 1, 5, 0, 0, -1, box, 100, n), 4);
  assert.deepEqual(n, [0, 0, 1]);
  assert.equal(rayBox(-5, 1, 0, 1, 0, 0, box, 100, n), 4);
  assert.deepEqual(n, [-1, 0, 0]);
  assert.equal(rayBox(0, 5, 0, 0, -1, 0, box, 100, n), 3);
  assert.deepEqual(n, [0, 1, 0]);
  assert.equal(rayBox(0, 1, 5, 0, 0, 1, box, 100, n), -1, 'pointing away');
  assert.equal(rayBox(3, 1, 5, 0, 0, -1, box, 100, n), -1, 'passes beside');
  assert.equal(rayBox(0, 1, 5, 0, 0, -1, box, 3, n), -1, 'beyond max range');
});

test('rayCapsule hits body, caps, and misses by a hair', () => {
  // vertical capsule from y=0 to y=1, radius 0.1, at the origin
  const cap = [0, 0, 0, 0, 1, 0, 0.1];
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(rayCapsule(0, 0.5, 5, 0, 0, -1, ...cap), 4.9), 'body');
  assert.ok(near(rayCapsule(0, 1.05, 5, 0, 0, -1, ...cap), 5 - Math.sqrt(0.01 - 0.0025)), 'top cap');
  assert.equal(rayCapsule(0, 1.11, 5, 0, 0, -1, ...cap), -1, 'just over the top');
  assert.equal(rayCapsule(0.1001, 0.5, 5, 0, 0, -1, ...cap), -1, 'just outside the radius');
  assert.ok(rayCapsule(0.0999, 0.5, 5, 0, 0, -1, ...cap) > 0, 'just inside the radius');
  assert.ok(near(rayCapsule(0, 5, 0, 0, -1, 0, ...cap), 3.9), 'straight down the axis');
  assert.equal(rayCapsule(0, 0.5, 5, 0, 0, 1, ...cap), -1, 'behind the ray');
  // degenerate capsule = sphere
  assert.ok(near(rayCapsule(0, 0, 5, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0.5), 4.5), 'sphere');
});

test('rig stands about player height and the eye line passes through the head', () => {
  const rig = computeRig(still(), ENEMY.grunt, makeRig());
  assert.ok(Math.abs(rig.head[1] - PLAYER.eye) < 0.06, `head centre ${rig.head[1]} ~ eye ${PLAYER.eye}`);
  const r = rayRig(rig, 0, rig.head[1], -10, 0, 0, 1, 100);
  assert.equal(r.seg, SEG.HEAD);
  assert.equal(SEG_GROUP[r.seg], 'head');
  // crouching lowers the head substantially
  const low = computeRig(still({ cr: 1 }), ENEMY.grunt, makeRig());
  assert.ok(low.head[1] < rig.head[1] - 0.4);
});

test('every body group is reachable and limbs follow the walk cycle', () => {
  const rig = computeRig(still({ mv: 1, ph: 1.2, aim: 0 }), ENEMY.grunt, makeRig());
  const seen = new Set();
  for (let i = 0; i < 16; i++) {
    const mx = (rig.a[i * 3] + rig.b[i * 3]) / 2, my = (rig.a[i * 3 + 1] + rig.b[i * 3 + 1]) / 2, mz = (rig.a[i * 3 + 2] + rig.b[i * 3 + 2]) / 2;
    // fire at each capsule's midpoint from several directions; at least one must land on that capsule
    let ok = false;
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const r = rayRig(rig, mx - dx * 5, my, mz - dz * 5, dx, 0, dz, 100);
      assert.ok(r.seg >= 0, 'ray through a capsule midpoint must hit something');
      if (r.seg === i) ok = true;
    }
    // the neck sits inside the overlap of chest and head, so it never takes a level shot first
    if (i !== SEG.NECK) assert.ok(ok, `segment ${i} can be hit`);
    seen.add(SEG_GROUP[i]);
  }
  assert.deepEqual([...seen].sort(), ['arm', 'chest', 'head', 'leg', 'stomach']);
  // legs are in different places at opposite phases -> hitboxes really are animated
  const a = computeRig(still({ mv: 1, ph: Math.PI / 2 }), ENEMY.grunt, makeRig());
  const b = computeRig(still({ mv: 1, ph: -Math.PI / 2 }), ENEMY.grunt, makeRig());
  assert.ok(Math.abs(a.b[SEG.LLEG_L * 3 + 2] - b.b[SEG.LLEG_L * 3 + 2]) > 0.5);
});

test('bones keep their length under IK (no stretchy hitboxes)', () => {
  for (const s of [still(), still({ cr: 1 }), still({ mv: 1, ph: 0.7 }), still({ mv: 1, ph: 4, aim: 0 }), still({ pitch: 0.8 }), still({ pitch: -0.8, cr: 0.5 })]) {
    for (const def of [ENEMY.grunt, ENEMY.rusher, ENEMY.heavy]) {
      const rig = computeRig({ ...s, atk: def.melee ? 0.45 : 0 }, def, makeRig());
      const len = (i) => Math.hypot(rig.b[i * 3] - rig.a[i * 3], rig.b[i * 3 + 1] - rig.a[i * 3 + 1], rig.b[i * 3 + 2] - rig.a[i * 3 + 2]) / def.scale;
      for (const [i, want] of [[SEG.UARM_L, 0.29], [SEG.LARM_L, 0.27], [SEG.UARM_R, 0.29], [SEG.LARM_R, 0.27], [SEG.ULEG_L, 0.44], [SEG.LLEG_L, 0.43], [SEG.ULEG_R, 0.44], [SEG.LLEG_R, 0.43]]) {
        assert.ok(Math.abs(len(i) - want) < 1e-6, `seg ${i} length ${len(i)} != ${want}`);
      }
    }
  }
});

test('interpolation survives a JSON round trip bit-for-bit (client == server)', () => {
  const a = [7, 0, 1.234, 0, -5.678, 3.1, 0.12, 10.5, 0.4, 0, 1, 0];
  const b = [7, 0, 1.334, 0, -5.578, -3.1, 0.10, 10.9, 0.6, 0.2, 1, 0];
  const [a2, b2] = JSON.parse(JSON.stringify([a, b]));
  const s1 = lerpEnemy(a, b, 0.3731, {}), s2 = lerpEnemy(a2, b2, 0.3731, {});
  assert.deepEqual(s1, s2);
  const r1 = computeRig(s1, ENEMY.grunt, makeRig()), r2 = computeRig(s2, ENEMY.grunt, makeRig());
  assert.deepEqual([...r1.a], [...r2.a]);
  assert.deepEqual([...r1.b], [...r2.b]);
  // yaw wraps the short way round (3.1 -> -3.1 is a small turn, not a full spin)
  assert.ok(Math.abs(Math.abs(s1.yaw) - Math.PI) < 0.1);
});

test('world: bullets pass chain-link, walls stop them, the ground catches the rest', () => {
  // north fence is at z = -36; shoot through it from inside the alley
  const through = raycastWorld(SOLIDS, 0, 1.5, -30, 0, 0, -1, 200, true);
  assert.ok(through.t < 0 || through.t > 7, 'bullet is not stopped by the fence');
  const body = raycastWorld(SOLIDS, 0, 1.5, -30, 0, 0, -1, 200, false);
  assert.ok(Math.abs(body.t - 5.94) < 0.01, 'a body is');
  const wall = raycastWorld(SOLIDS, 0, 1.5, 10, 1, 0, 0, 200, true);
  assert.ok(wall.t > 0 && wall.t <= 4 && wall.nx === -1);
  const ground = raycastWorld(SOLIDS, 0, 1.5, 15, 0, -1, 0, 200, true);
  assert.equal(ground.t, 1.5);
  assert.equal(ground.solid.ground, true);
  assert.equal(clearLine(SOLIDS, 0, 1.5, -30, 0, 1.5, 30), true, 'main alley is one long sight line');
  assert.equal(clearLine(SOLIDS, 0, 1.5, 0, 12, 1.5, -13), false, 'courtyard is not visible from the crossing');
});

test('navigation: every enemy spawn can reach every player spawn', () => {
  const nav = new Nav();
  for (const s of ENEMY_SPAWNS) {
    assert.ok(nav.walkable(s.x, s.z, 0), `enemy spawn ${s.x},${s.z} is on the nav grid`);
    for (const p of PLAYER_SPAWNS) {
      const path = nav.findPath(s.x, s.z, p.x, p.z);
      assert.ok(path && path.length > 0, `path ${s.x},${s.z} -> ${p.x},${p.z}`);
      const end = path[path.length - 1];
      assert.ok(Math.hypot(end.x - p.x, end.z - p.z) < 1, 'path ends at the goal');
    }
  }
  // the loading dock is only reachable via its stairs, and it is reachable
  const up = nav.findPath(10, -13, 17, -21.5);
  assert.ok(up && up.length);
  assert.ok(Math.abs(nav.floorAt(17, -21.5) - 1.2) < 1e-6);
});
