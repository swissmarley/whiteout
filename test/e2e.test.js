// End-to-end hit registration over a real WebSocket: a headless client aims with the same
// shared rig code the browser uses, and the server must agree - including under latency,
// against a target sprinting sideways.

import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { computeRig, makeRig, rayRig, SEG, SEG_GROUP } from '../shared/rig.js';
import { ENEMY, TYPE_NAMES, INTERP_MS, PLAYER, AR, KNIFE, PART_MULT, lerpEnemy } from '../shared/constants.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Bot {
  constructor(port, name) {
    this.snaps = []; this.msgs = []; this.waiters = []; this.id = 0; this.q = 0; this.n = 0;
    this.pos = { x: 0, y: 0, z: 0 };
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ready = new Promise((res, rej) => {
      this.ws.onerror = rej;
      this.ws.onopen = () => { this.send({ t: 'hi', name }); };
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === 's') { this.snaps.push(m); if (this.snaps.length > 60) this.snaps.shift(); return; }
        if (m.t === 'w') { this.id = m.id; res(); }
        if (m.t === 'sp') { this.q = m.q; this.pos = { x: m.x, y: m.y, z: m.z }; }
        this.msgs.push(m);
        this.waiters = this.waiters.filter((w) => !(w.fn(m) && (w.res(m), true)));
      };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(fn, ms = 3000) {
    const hit = this.msgs.find(fn);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const w = { fn, res }; this.waiters.push(w);
      setTimeout(() => rej(new Error('timed out waiting for message')), ms);
    });
  }
  async place(x, y, z) {
    this.send({ t: 'dbg', cmd: 'alive' });
    await this.wait((m) => m.t === 'sp');
    this.pos = { x, y, z };
    this.report();
  }
  report() { this.send({ t: 'u', q: this.q, x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: 0, pitch: 0, ph: 0, mv: 0, cr: 0, f: 0 }); }
  eye() { return [this.pos.x, this.pos.y + PLAYER.eye, this.pos.z]; }

  // Exactly what the browser does each frame: pick the two snapshots around (latest - 100ms).
  view() {
    const s = this.snaps; if (s.length < 2) return null;
    const rt = s[s.length - 1].T - INTERP_MS;
    let i = s.length - 2;
    while (i > 0 && s[i].T > rt) i--;
    const s0 = s[i], s1 = s[i + 1];
    const a = Math.min(1, Math.max(0, (rt - s0.T) / (s1.T - s0.T)));
    return { s0, s1, a };
  }
  rigOf(view, id) {
    const r0 = view.s0.e.find((r) => r[0] === id); if (!r0) return null;
    const r1 = view.s1.e.find((r) => r[0] === id);
    const st = lerpEnemy(r0, r1, view.a, {});
    return { st, rig: computeRig(st, ENEMY[TYPE_NAMES[st.type]], makeRig()) };
  }
  // kind 'x' fires the rifle, 'm' cuts with the knife; both get an 'h' back
  async shoot(view, target, { delay = 0, claim = 0, seg = -1, kind = 'x', ms = 3000 } = {}) {
    const o = this.eye();
    let d = [target[0] - o[0], target[1] - o[1], target[2] - o[2]];
    const l = Math.hypot(...d); d = d.map((v) => v / l);
    const n = ++this.n;
    const msg = { t: kind, n, t0: view.s0.T, t1: view.s1.T, a: view.a, o, d, h: claim, s: seg };
    if (delay) await sleep(delay);
    this.send(msg);
    return this.wait((m) => m.t === 'h' && m.n === n, ms);
  }
  knife(view, target, opts = {}) { return this.shoot(view, target, { ...opts, kind: 'm' }); }
  close() { this.ws.close(); }
}

async function setup(t) {
  const srv = await startServer({ port: 0, host: '127.0.0.1', debug: true, autoStart: false, quiet: true });
  t.after(() => srv.close());
  return srv;
}

test('stationary target: the server agrees with the client on every body part, and on misses', async (t) => {
  const srv = await setup(t);
  const bot = new Bot(srv.port, 'aim'); await bot.ready;
  t.after(() => bot.close());
  bot.send({ t: 'dbg', cmd: 'passive', v: true });
  await bot.place(0, 0, 0.5);
  // a heavy soaks enough damage to be shot in six places
  bot.send({ t: 'dbg', cmd: 'spawn', type: 'heavy', x: 0.25, z: -11.75, yaw: Math.PI });
  const { spawned: id } = await bot.wait((m) => m.t === 'dbg' && m.spawned);
  await sleep(400);                                   // let it appear in a few snapshots
  const view = bot.view();
  const { rig } = bot.rigOf(view, id);
  const mid = (i) => [0, 1, 2].map((k) => (rig.a[i * 3 + k] + rig.b[i * 3 + k]) / 2);
  const o = bot.eye();
  const predict = (pt) => { let d = pt.map((v, k) => v - o[k]); const l = Math.hypot(...d); d = d.map((v) => v / l); return rayRig(rig, ...o, ...d, 200).seg; };

  const groups = new Set();
  for (const seg of [SEG.HEAD, SEG.CHEST, SEG.STOMACH, SEG.ULEG_L, SEG.LLEG_R, SEG.UARM_L]) {
    const pt = seg === SEG.HEAD ? [...rig.head] : mid(seg);
    const want = predict(pt);
    assert.ok(want >= 0, 'client predicts a hit');
    const res = await bot.shoot(view, pt, { claim: id, seg: want });
    assert.equal(res.id, id);
    assert.equal(res.s, want, `server hit segment ${res.s}, client predicted ${want}`);
    const g = SEG_GROUP[want]; groups.add(g);
    const mult = g === 'head' ? 1 + (PART_MULT.head - 1) * ENEMY.heavy.headMult : PART_MULT[g];
    assert.equal(res.dmg, Math.round(AR.damage * mult));
    await sleep(110);
  }
  assert.ok(groups.has('head') && groups.has('chest') && groups.has('leg'));

  const miss = await bot.shoot(view, [rig.head[0] + 0.7, rig.head[1] + 0.5, rig.head[2]]);
  assert.equal(miss.id, 0, 'well wide is a miss');
  await sleep(110);
  // a lie: claim a hit while firing into the sky. The favour-the-shooter pad must not grant it.
  const lie = await bot.shoot(view, [0, 30, -11], { claim: id, seg: SEG.HEAD });
  assert.equal(lie.id, 0, 'claimed hits are still verified');
  assert.equal(srv.game.stats.favored, 0, 'every hit above was an exact rewind match');
});

test('wall between shooter and target blocks the hit even when the ray lines up', async (t) => {
  const srv = await setup(t);
  const bot = new Bot(srv.port, 'wall'); await bot.ready;
  t.after(() => bot.close());
  bot.send({ t: 'dbg', cmd: 'passive', v: true });
  await bot.place(0, 0, 0.5);
  // courtyard, behind building NE3 from the crossing
  bot.send({ t: 'dbg', cmd: 'spawn', type: 'grunt', x: 12.25, z: -13.25 });
  const { spawned: id } = await bot.wait((m) => m.t === 'dbg' && m.spawned);
  await sleep(300);
  const view = bot.view();
  const { rig } = bot.rigOf(view, id);
  const r = await bot.shoot(view, rig.head, { claim: id, seg: SEG.HEAD });
  assert.equal(r.id, 0);
});

test('lag compensation: sprinting target, 100ms interp + 180ms of latency, still a headshot', async (t) => {
  const srv = await setup(t);
  const shooter = new Bot(srv.port, 'shooter'), decoy = new Bot(srv.port, 'decoy');
  await Promise.all([shooter.ready, decoy.ready]);
  t.after(() => { shooter.close(); decoy.close(); });

  await shooter.place(0, 0, 26);       // far down the south alley, looking north at the crossing
  await decoy.place(-11, 0, 0.25);     // bait at the west arm
  // rusher starts in the east arm and sprints west across the shooter's sight line
  shooter.send({ t: 'dbg', cmd: 'spawn', type: 'rusher', x: 13.25, z: -0.25 });
  const { spawned: id } = await shooter.wait((m) => m.t === 'dbg' && m.spawned);

  let shot = null, seen = null;
  for (let i = 0; i < 200 && !shot; i++) {
    await sleep(15);
    shooter.report(); decoy.report();
    const view = shooter.view(); if (!view) continue;
    const r = shooter.rigOf(view, id); if (!r) continue;
    if (r.st.x < 2.5 && r.st.x > -1 && r.st.mv > 0.8) { shot = { view, head: [...r.rig.head], rig: r.rig }; seen = r.st; }
  }
  assert.ok(shot, 'the runner crossed the sight line');

  // sanity: the client-side ray really does hit the head it is aiming at
  const o = shooter.eye();
  let d = [shot.head[0] - o[0], shot.head[1] - o[1], shot.head[2] - o[2]]; const l = Math.hypot(...d); d = d.map((v) => v / l);
  assert.equal(rayRig(shot.rig, ...o, ...d, 200).seg, SEG.HEAD);

  // simulated latency: by the time the server hears about it, the runner is somewhere else
  await sleep(180);
  const moved = Math.abs(srv.game.enemies.get(id).x - seen.x);
  assert.ok(moved > 0.8, `target moved ${moved.toFixed(2)}m between seeing and server processing`);
  const res = await shooter.shoot(shot.view, shot.head);

  assert.equal(res.id, id, 'server registered the hit');
  assert.equal(res.s, SEG.HEAD, 'on the head');
  assert.equal(res.k, 1, 'and it was lethal (65hp rusher, 128 dmg)');
  assert.equal(srv.game.stats.favored, 0, 'by exact rewind, not by tolerance');
  await shooter.wait((m) => m.t === 'ed' && m.id === id && m.hs === 1);
});

test('knife: one cut drops a gunman inside reach, the cut is swept wide, and it is rate limited', async (t) => {
  const srv = await setup(t);
  const bot = new Bot(srv.port, 'blade'); await bot.ready;
  t.after(() => bot.close());
  bot.send({ t: 'dbg', cmd: 'passive', v: true });
  await bot.place(0, 0, 0.5);
  const spawn = async (type, z) => {
    bot.msgs.length = 0;
    bot.send({ t: 'dbg', cmd: 'spawn', type, x: 0, z, yaw: Math.PI });
    const { spawned } = await bot.wait((m) => m.t === 'dbg' && m.spawned);
    await sleep(400);
    return spawned;
  };
  const dir = (o, pt) => { const d = pt.map((v, k) => v - o[k]), l = Math.hypot(...d); return d.map((v) => v / l); };
  const o = bot.eye();

  // out of reach: nothing, however well it is aimed
  const far = await spawn('grunt', -3);
  let view = bot.view(), rig = bot.rigOf(view, far).rig;
  assert.equal((await bot.knife(view, [...rig.chest], { claim: far })).id, 0, 'three and a half metres is not knife range');
  srv.game.enemies.delete(far);
  await sleep(KNIFE.time * 1000);

  // inside reach: dead in one
  const near = await spawn('grunt', -1);
  view = bot.view(); rig = bot.rigOf(view, near).rig;
  const cut = await bot.knife(view, [...rig.chest], { claim: near });
  assert.equal(cut.id, near);
  assert.equal(cut.dmg, KNIFE.damage);
  assert.equal(cut.k, 1, 'a gunman has 100 hp');
  const dead = await bot.wait((m) => m.t === 'ed' && m.id === near);
  assert.equal(dead.ml, 1, 'reported as a knife kill');
  assert.equal(dead.hs, 0);
  await sleep(KNIFE.time * 1000);

  // beside the head: a bullet goes past, the blade's sweep does not
  const big = await spawn('heavy', -1.1);
  view = bot.view(); rig = bot.rigOf(view, big).rig;
  const beside = [rig.head[0] + rig.r[SEG.HEAD] + 0.1, rig.head[1] + 0.05, rig.head[2]];
  assert.equal(rayRig(rig, ...o, ...dir(o, beside), 200).seg, -1, 'the line itself misses');
  assert.ok(rayRig(rig, ...o, ...dir(o, beside), KNIFE.range, KNIFE.radius).seg >= 0, 'the sweep does not');
  assert.equal((await bot.shoot(view, beside)).id, 0, 'a bullet on that line is a miss');
  const hp = srv.game.enemies.get(big).hp;
  const wide = await bot.knife(view, beside);
  assert.equal(wide.id, big);
  assert.equal(wide.k, 0);
  assert.equal(srv.game.enemies.get(big).hp, hp - KNIFE.damage, 'flat damage, whatever part it touches');

  // a second cut straight away is ignored: the arm is still out
  await assert.rejects(bot.knife(view, beside, { ms: 250 }), /timed out/);
  assert.equal(srv.game.enemies.get(big).hp, hp - KNIFE.damage);
  assert.equal(srv.game.stats.favored, 0);
});

test('knife: chain-link stops a blade that a bullet passes through', async (t) => {
  const srv = await setup(t);
  const bot = new Bot(srv.port, 'fence'); await bot.ready;
  t.after(() => bot.close());
  bot.send({ t: 'dbg', cmd: 'passive', v: true });
  await bot.place(0, 0, -35.4);                       // against the north fence (z = -36), inside
  bot.send({ t: 'dbg', cmd: 'spawn', type: 'grunt', x: 0, z: -36.7, yaw: Math.PI });
  const { spawned: id } = await bot.wait((m) => m.t === 'dbg' && m.spawned);
  await sleep(400);
  const view = bot.view(), { rig } = bot.rigOf(view, id);
  assert.ok(Math.hypot(...rig.chest.map((v, k) => v - bot.eye()[k])) < KNIFE.range, 'close enough, were it not for the fence');
  assert.equal((await bot.knife(view, [...rig.chest], { claim: id })).id, 0, 'the blade is stopped');
  assert.equal((await bot.shoot(view, [...rig.chest], { claim: id })).id, id, 'the bullet is not');
});

test('leaving for the menu takes the player out of the match; deploying again puts them back', async (t) => {
  const srv = await setup(t);
  const a = new Bot(srv.port, 'stays'), b = new Bot(srv.port, 'leaves');
  await Promise.all([a.ready, b.ready]);
  t.after(() => { a.close(); b.close(); });
  await a.place(0, 0, 0.5); await b.place(2, 0, 0.5);
  a.msgs.length = 0;
  b.send({ t: 'bye' });
  const roster = await a.wait((m) => m.t === 'r' && !m.l.some((r) => r[0] === b.id));
  assert.equal(roster.l.length, 1);
  await sleep(120);
  assert.ok(!a.snaps[a.snaps.length - 1].p.some((r) => r[0] === b.id), 'gone from the snapshots other players get');
  const before = b.snaps.length; await sleep(150);
  assert.equal(b.snaps.length, before, 'and no longer sent any');
  assert.equal(srv.game.players.get(b.id).alive, false);

  // same connection, back in
  b.msgs.length = 0; a.msgs.length = 0;
  b.send({ t: 'hi', name: 'leaves' });
  await b.wait((m) => m.t === 'w');
  await a.wait((m) => m.t === 'r' && m.l.some((r) => r[0] === b.id));
  const got = b.snaps.length; await sleep(150);
  assert.ok(b.snaps.length > got, 'snapshots resume');
});
