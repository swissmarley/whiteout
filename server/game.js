// Authoritative match simulation: waves, enemy AI, damage, and lag-compensated hit registration.

import { SOLIDS, ENEMY_SPAWNS, PLAYER_SPAWNS } from '../shared/map.js';
import {
  TICK_HZ, SNAP_HZ, HISTORY_MS, PLAYER, AR, KNIFE, PART_MULT, ENEMY, TYPE_NAMES, PF, lerpEnemy, r3, r4,
} from '../shared/constants.js';
import { raycastWorld, clearLine, rayCapsule } from '../shared/collide.js';
import { computeRig, makeRig, rayRig, SEG_GROUP, SEG_COUNT } from '../shared/rig.js';
import { Nav } from './nav.js';

const PHASES = ['idle', 'inter', 'wave', 'over'];
const DEG = Math.PI / 180;
const SNAP_EVERY = Math.round(TICK_HZ / SNAP_HZ);
const FAVOR_PAD = 0.06;     // metres of slack given to a client-claimed hit the rewind narrowly misses

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function turnToward(a, b, max) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  if (d > max) d = max; else if (d < -max) d = -max;
  let r = a + d;
  if (r > Math.PI) r -= Math.PI * 2; else if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

export class Game {
  constructor(opts = {}) {
    this.debug = !!opts.debug;
    this.autoStart = opts.autoStart !== false;
    this.passive = false;
    this.nav = new Nav();
    this.players = new Map();
    this.enemies = new Map();
    this.history = [];
    this.nextId = 1;
    this.tickN = 0;
    this.phase = 'idle';
    this.wave = 0;
    this.phaseEnd = 0;
    this.queue = [];
    this.spawnT = 0;
    this.tickets = 0;
    this.rig = makeRig();
    this.tmp = {};
    this.tr = { o: [0, 0, 0], end: [0, 0, 0], d: [0, 0, 0], enemy: null, seg: -1 };
    this.now = performance.now();
    this.last = this.now;
    this.lastRoster = 0;
    this.stats = { shots: 0, hits: 0, favored: 0 };
  }

  rand(a, b) { return a + Math.random() * (b - a); }
  randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
  gauss() { return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()); }

  // ------------------------------------------------------------------ networking
  send(p, obj) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); }

  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) if (p !== except && p.joined && p.ws.readyState === 1) p.ws.send(s);
  }

  addConnection(ws) {
    const p = {
      id: this.nextId++, ws, name: 'Player', joined: false,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, ph: 0, mv: 0, cr: 0, flags: 0,
      hp: PLAYER.maxHp, alive: false, spawnSeq: 0, kills: 0, deaths: 0, score: 0, ping: 0,
      lastDmg: 0, respawnAt: 0, speed: 0, lastU: 0, prot: 0, tokens: 4, tokT: this.now, cutAt: 0,
    };
    this.players.set(p.id, p);
    return p;
  }

  removeConnection(p) {
    this.players.delete(p.id);
    for (const e of this.enemies.values()) if (e.target === p) e.target = null;
    this.sendRoster();
  }

  // Back to the menu: out of the match, but the connection stays up and 'hi' deploys again.
  leave(p) {
    if (!p.joined) return;
    p.joined = false; p.alive = false; p.respawnAt = 0;
    for (const e of this.enemies.values()) if (e.target === p) e.target = null;
    this.sendRoster();
  }

  joined() { let n = 0; for (const p of this.players.values()) if (p.joined) n++; return n; }

  onMessage(p, m) {
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'hi': {
        if (p.joined) return;
        p.name = String(m.name || 'Player').replace(/[^\w \-.]/g, '').trim().slice(0, 14) || 'Player';
        p.joined = true;
        this.send(p, { t: 'w', id: p.id, T: r3(performance.now()), tick: TICK_HZ, snap: SNAP_HZ });
        if (this.phase !== 'idle') this.spawnPlayer(p);
        this.sendRoster();
        break;
      }
      case 'p':
        if (num(m.r)) p.ping = clamp(Math.round(m.r), 0, 999);
        this.send(p, { t: 'q', c: m.c, s: r3(performance.now()) });
        break;
      case 'u': this.onUpdate(p, m); break;
      case 'x': this.onShot(p, m); break;
      case 'm': this.onMelee(p, m); break;
      case 'bye': this.leave(p); break;
      case 'dbg': if (this.debug) this.onDebug(p, m); break;
    }
  }

  onDebug(p, m) {
    if (m.cmd === 'spawn') {
      const e = this.spawnEnemy(TYPE_NAMES.includes(m.type) ? m.type : 'grunt', { x: m.x, z: m.z });
      if (num(m.yaw)) e.yaw = m.yaw;
      this.send(p, { t: 'dbg', spawned: e.id });
    } else if (m.cmd === 'alive') this.spawnPlayer(p);
    else if (m.cmd === 'passive') this.passive = !!m.v;
    else if (m.cmd === 'tp' && num(m.x) && num(m.z)) { p.x = m.x; p.z = m.z; p.y = m.y || 0; }
    else if (m.cmd === 'stats') this.send(p, { t: 'dbg', stats: this.stats });
  }

  onUpdate(p, m) {
    if (!p.alive || m.q !== p.spawnSeq) return;
    if (!num(m.x) || !num(m.y) || !num(m.z) || !num(m.yaw) || !num(m.pitch)) return;
    if (Math.abs(m.x) > 40 || Math.abs(m.z) > 50 || m.y < -1 || m.y > 30) return;
    const now = this.now;
    const dt = Math.max(0.008, (now - p.lastU) / 1000);
    const sp = Math.hypot(m.x - p.x, m.z - p.z) / dt;
    p.speed += (Math.min(sp, 12) - p.speed) * 0.35;
    p.lastU = now;
    p.x = m.x; p.y = m.y; p.z = m.z; p.yaw = m.yaw; p.pitch = clamp(m.pitch, -1.6, 1.6);
    p.ph = num(m.ph) ? m.ph : 0; p.mv = num(m.mv) ? clamp(m.mv, 0, 1) : 0; p.cr = num(m.cr) ? clamp(m.cr, 0, 1) : 0;
    p.flags = (m.f | 0) & ~PF.ALIVE;
  }

  sendRoster() {
    this.lastRoster = this.now;
    const l = [];
    for (const p of this.players.values()) if (p.joined) l.push([p.id, p.name, p.kills, p.deaths, p.score, p.ping, p.alive ? 1 : 0]);
    this.broadcast({ t: 'r', l });
  }

  // ------------------------------------------------------------------ match flow
  startMatch(now) {
    this.wave = 0;
    this.enemies.clear();
    this.queue.length = 0;
    this.tickets = 2 + this.joined();
    for (const p of this.players.values()) {
      if (!p.joined) continue;
      p.kills = 0; p.deaths = 0; p.score = 0;
      this.spawnPlayer(p);
    }
    this.phase = 'inter';
    this.phaseEnd = now + 6000;
    this.broadcast({ t: 'ev', k: 'start' });
    this.sendRoster();
  }

  startWave(now) {
    this.wave++;
    const n = this.wave, pc = Math.max(1, this.joined());
    const count = Math.round((4 + n * 2) * (1 + 0.6 * (pc - 1)));
    this.queue.length = 0;
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      let type = 'grunt';
      if (n >= 4 && r < Math.min(0.25, 0.08 + 0.02 * n)) type = 'heavy';
      else if (n >= 2 && r < 0.42) type = 'rusher';
      this.queue.push(type);
    }
    if (n >= 3 && n % 3 === 0) this.queue[this.queue.length - 1] = 'heavy';
    this.phase = 'wave';
    this.spawnT = now + 800;
    for (const p of this.players.values()) if (p.joined && !p.alive) this.spawnPlayer(p);
    this.broadcast({ t: 'ev', k: 'wave', n });
  }

  endWave(now) {
    this.phase = 'inter';
    this.phaseEnd = now + 9000;
    this.tickets = Math.min(this.tickets + 1, 4 + this.joined());
    for (const p of this.players.values()) if (p.alive) p.hp = PLAYER.maxHp;
    this.broadcast({ t: 'ev', k: 'clear', n: this.wave });
  }

  gameOver(now) {
    this.phase = 'over';
    this.phaseEnd = now + 11000;
    let kills = 0;
    for (const p of this.players.values()) kills += p.kills;
    this.broadcast({ t: 'ev', k: 'over', n: this.wave, kills });
  }

  maxAlive() { return Math.min(14, 5 + 2 * this.joined() + Math.floor(this.wave / 2)); }
  dmgScale() { return Math.min(1.6, 1 + 0.04 * (this.wave - 1)); }
  accScale() { return Math.max(0.6, 1 - 0.035 * (this.wave - 1)); }

  updatePhase(now) {
    const n = this.joined();
    if (n === 0) {
      if (this.phase !== 'idle') { this.phase = 'idle'; this.enemies.clear(); this.queue.length = 0; this.wave = 0; }
      return;
    }
    if (!this.autoStart) return;
    switch (this.phase) {
      case 'idle': this.startMatch(now); break;
      case 'inter': if (now >= this.phaseEnd) this.startWave(now); break;
      case 'wave': {
        if (this.queue.length && now >= this.spawnT && this.enemies.size < this.maxAlive()) {
          const sp = this.pickEnemySpawn();
          this.spawnEnemy(this.queue.pop(), sp);
          this.spawnT = now + this.rand(450, 1300);
        }
        if (!this.queue.length && this.enemies.size === 0) { this.endWave(now); break; }
        let alive = 0, pending = 0;
        for (const p of this.players.values()) { if (!p.joined) continue; if (p.alive) alive++; else if (p.respawnAt) pending++; }
        if (alive === 0 && pending === 0) this.gameOver(now);
        break;
      }
      case 'over': if (now >= this.phaseEnd) this.startMatch(now); break;
    }
  }

  // ------------------------------------------------------------------ players
  spawnPlayer(p) {
    // farthest spawn from any enemy
    let best = PLAYER_SPAWNS[0], bd = -1;
    for (const s of PLAYER_SPAWNS) {
      let d = 60;
      for (const e of this.enemies.values()) d = Math.min(d, Math.hypot(e.x - s.x, e.z - s.z));
      for (const q of this.players.values()) if (q !== p && q.alive && Math.hypot(q.x - s.x, q.z - s.z) < 1.5) d -= 40;
      d += Math.random() * 3;
      if (d > bd) { bd = d; best = s; }
    }
    p.x = best.x; p.y = best.y; p.z = best.z; p.yaw = best.yaw; p.pitch = 0;
    p.hp = PLAYER.maxHp; p.alive = true; p.respawnAt = 0; p.spawnSeq++;
    p.prot = this.now + 2500; p.lastDmg = 0; p.speed = 0; p.lastU = this.now;
    this.send(p, { t: 'sp', q: p.spawnSeq, x: p.x, y: p.y, z: p.z, yaw: p.yaw });
  }

  hurt(p, dmg, sx, sy, sz, kind, by) {
    if (!p.alive || this.now < p.prot) return;
    p.hp -= dmg;
    p.lastDmg = this.now;
    this.send(p, { t: 'd', hp: Math.max(0, Math.round(p.hp)), dmg: Math.round(dmg), sx: r3(sx), sz: r3(sz), k: kind });
    if (p.hp <= 0) {
      p.alive = false; p.hp = 0; p.deaths++;
      if (this.tickets > 0) { this.tickets--; p.respawnAt = this.now + PLAYER.respawnDelay * 1000; } else p.respawnAt = 0;
      this.broadcast({ t: 'pd', id: p.id, by: by ? by.ti : -1, wait: p.respawnAt ? PLAYER.respawnDelay : 0 });
      this.sendRoster();
    }
  }

  updatePlayer(p, dt, now) {
    if (!p.joined) return;
    if (p.alive) {
      if (p.hp < PLAYER.maxHp && now - p.lastDmg > PLAYER.regenDelay * 1000) p.hp = Math.min(PLAYER.maxHp, p.hp + PLAYER.regenRate * dt);
    } else if (p.respawnAt && now >= p.respawnAt && this.phase !== 'over') this.spawnPlayer(p);
  }

  // ------------------------------------------------------------------ enemies
  pickEnemySpawn() {
    const ok = [];
    let far = ENEMY_SPAWNS[0], fd = -1;
    for (const s of ENEMY_SPAWNS) {
      let near = 1e9, seen = false;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        if (d < near) near = d;
        if (d < 30 && clearLine(SOLIDS, s.x, 1.5, s.z, p.x, p.y + 1.5, p.z)) seen = true;
      }
      if (near > fd) { fd = near; far = s; }
      if (near > 10 && !seen) ok.push(s);
    }
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : far;
  }

  spawnEnemy(type, sp) {
    const def = ENEMY[type];
    const hpScale = 1 + 0.03 * Math.max(0, this.wave - 1);
    const e = {
      id: this.nextId++, type, ti: TYPE_NAMES.indexOf(type), def,
      x: sp.x + this.rand(-0.2, 0.2), y: this.nav.floorAt(sp.x, sp.z), z: sp.z + this.rand(-0.2, 0.2),
      vx: 0, vz: 0, yaw: this.rand(-3, 3), pitch: 0, ph: this.rand(0, 6), mv: 0, cr: 0, aim: 0, atk: 0,
      hp: def.hp * hpScale,
      target: null, retargetT: 0, los: false, losT: 0, seenT: -1e9, settle: 0,
      mode: 'advance', modeT: 0, crWant: 0, path: null, pi: 0, repathT: 0, gx: 0, gz: 0,
      burst: -1, nextShot: 0, sx: 0, sz: 0, slow: 0, hitDone: false, atkCd: 0,
    };
    this.enemies.set(e.id, e);
    return e;
  }

  pickTarget(e) {
    let best = null, bd = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      let d = Math.hypot(p.x - e.x, p.z - e.z);
      if (p === e.target) d *= 0.75;      // stick with the current target unless someone is clearly closer
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  los(e, p) {
    const ey = e.y + (1.55 - 0.5 * e.cr) * e.def.scale;
    const py = p.y + (p.cr > 0.5 ? 0.85 : 1.35);
    return clearLine(SOLIDS, e.x, ey, e.z, p.x, py, p.z);
  }

  follow(e, gx, gz, now) {
    if (!e.path || now >= e.repathT || Math.hypot(gx - e.gx, gz - e.gz) > 2.5) {
      e.path = this.nav.findPath(e.x, e.z, gx, gz);
      e.pi = 0; e.gx = gx; e.gz = gz;
      e.repathT = now + this.rand(450, 800);
    }
    const path = e.path;
    if (!path || !path.length) { e.sx = gx; e.sz = gz; return; }
    while (e.pi < path.length - 1 && Math.hypot(path[e.pi].x - e.x, path[e.pi].z - e.z) < 0.5) e.pi++;
    for (let j = Math.min(path.length - 1, e.pi + 7); j > e.pi; j--) {
      if (this.nav.lineFree(e.x, e.z, path[j].x, path[j].z)) { e.pi = j; break; }
    }
    e.sx = path[e.pi].x; e.sz = path[e.pi].z;
  }

  pickStrafe(e, tg) {
    // sidestep perpendicular to the line of fire, or back off if the player is right on top of us
    const dx = tg.x - e.x, dz = tg.z - e.z, d = Math.hypot(dx, dz) || 1;
    const px = -dz / d, pz = dx / d;
    for (let i = 0; i < 4; i++) {
      const side = Math.random() < 0.5 ? -1 : 1, dist = this.rand(1.6, 3.6);
      const back = d < e.def.pref * 0.6 ? -this.rand(1, 2.5) : this.rand(-0.5, 1);
      const x = e.x + px * side * dist + (dx / d) * back, z = e.z + pz * side * dist + (dz / d) * back;
      if (this.nav.lineFree(e.x, e.z, x, z)) { e.sx = x; e.sz = z; return true; }
    }
    return false;
  }

  updateEnemy(e, dt, now) {
    const def = e.def;
    if (!e.target || !e.target.alive || now >= e.retargetT) { e.target = this.pickTarget(e); e.retargetT = now + 1200; }
    const tg = this.passive ? null : e.target;
    let speed = 0, faceYaw = null, aimWant = 0, pitchWant = 0;

    if (tg && this.phase !== 'over') {
      const dx = tg.x - e.x, dz = tg.z - e.z, dy = tg.y - e.y;
      const dist = Math.hypot(dx, dz);
      const toTarget = Math.atan2(-dx, -dz);
      if (now >= e.losT) {
        e.los = this.los(e, tg);
        e.losT = now + this.rand(100, 180);
        if (e.los) e.seenT = now;
      }

      if (def.melee) {
        if (e.atk > 0) {
          e.atk += dt / 0.5;
          speed = def.speed * 0.35;
          if (e.atk >= 0.5 && !e.hitDone) {
            e.hitDone = true;
            if (dist < 2.2 && Math.abs(dy) < 1.9) this.hurt(tg, def.damage * this.dmgScale(), e.x, e.y + 1.2, e.z, 'melee', e);
          }
          if (e.atk >= 1) { e.atk = 0; e.atkCd = now + 320; }
        } else if (dist < 1.75 && Math.abs(dy) < 1.9 && now >= e.atkCd && e.los) {
          e.atk = 0.001; e.hitDone = false;
          this.broadcast({ t: 'em', id: e.id });
        }
        if (dist > 1.15) { this.follow(e, tg.x, tg.z, now); if (!speed) speed = def.speed; }
        else speed = 0;
        if (dist < 4 && e.los) faceYaw = toTarget;
      } else {
        const engage = e.los && dist < def.range;
        if (engage) e.settle = Math.min(1, e.settle + dt / def.react);
        else if (now - e.seenT > 900) { e.settle = Math.max(0, e.settle - dt * 1.5); if (e.settle === 0) e.burst = -1; }

        if (!engage && now - e.seenT > 700) e.mode = 'advance';
        else if (engage && e.mode === 'advance') { e.mode = 'hold'; e.modeT = now + this.rand(900, 2200); e.crWant = Math.random() < 0.35 ? 1 : 0; }

        if (e.mode === 'advance') {
          this.follow(e, tg.x, tg.z, now); speed = def.speed;
        } else if (e.mode === 'hold') {
          aimWant = 1; faceYaw = toTarget;
          if (now >= e.modeT) {
            if (dist > def.pref * 1.2) { e.mode = 'push'; e.modeT = now + this.rand(900, 1800); e.crWant = 0; }
            else if (this.pickStrafe(e, tg)) { e.mode = 'shift'; e.modeT = now + this.rand(700, 1300); e.crWant = 0; }
            else e.modeT = now + 600;
          }
        } else if (e.mode === 'push') {
          this.follow(e, tg.x, tg.z, now); speed = def.speed * 0.85;
          aimWant = type2aim(def); faceYaw = dist < 14 ? toTarget : null;
          if (now >= e.modeT || dist < def.pref) { e.mode = 'hold'; e.modeT = now + this.rand(900, 2200); e.crWant = Math.random() < 0.3 ? 1 : 0; }
        } else if (e.mode === 'shift') {
          speed = def.speed * 0.7; aimWant = 1; faceYaw = toTarget;
          if (now >= e.modeT || Math.hypot(e.sx - e.x, e.sz - e.z) < 0.3) { e.mode = 'hold'; e.modeT = now + this.rand(900, 2200); e.crWant = Math.random() < 0.35 ? 1 : 0; }
        }

        if (aimWant > 0) {
          const ty = tg.y + (tg.cr > 0.5 ? 0.8 : 1.25);
          pitchWant = Math.atan2(ty - (e.y + 1.4 * def.scale), Math.max(0.5, dist));
        }
        const mayFire = e.mode === 'hold' || (def.bulk > 1.1 && (e.mode === 'shift' || e.mode === 'push'));
        if (engage && mayFire && e.settle >= 1 && e.aim > 0.85) this.enemyFire(e, tg, dist, now);
      }
    } else {
      e.crWant = 0;
    }

    // --- locomotion
    let dvx = 0, dvz = 0;
    if (speed > 0) {
      const mx = e.sx - e.x, mz = e.sz - e.z, ml = Math.hypot(mx, mz);
      if (ml > 0.08) { dvx = mx / ml * speed; dvz = mz / ml * speed; }
    }
    if (now < e.slow) { dvx *= 0.4; dvz *= 0.4; }
    const k = Math.min(1, 9 * dt);
    e.vx += (dvx - e.vx) * k; e.vz += (dvz - e.vz) * k;
    const nx = e.x + e.vx * dt;
    if (this.nav.walkable(nx, e.z, e.y)) e.x = nx; else e.vx = 0;
    const nz = e.z + e.vz * dt;
    if (this.nav.walkable(e.x, nz, e.y)) e.z = nz; else e.vz = 0;
    e.y += (this.nav.floorAt(e.x, e.z) - e.y) * Math.min(1, 14 * dt);

    const sp = Math.hypot(e.vx, e.vz), frac = Math.min(1, sp / def.speed);
    e.mv += (frac - e.mv) * Math.min(1, 10 * dt);
    if (sp > 0.15) e.ph += def.cadence * dt * (0.35 + 0.65 * frac);
    if (faceYaw === null && sp > 0.4) faceYaw = Math.atan2(-e.vx, -e.vz);
    if (faceYaw !== null) e.yaw = turnToward(e.yaw, faceYaw, 7.5 * dt);
    e.aim += (aimWant - e.aim) * Math.min(1, 8 * dt);
    e.cr += ((sp > 0.5 ? 0 : e.crWant) - e.cr) * Math.min(1, 6 * dt);
    e.pitch += (clamp(pitchWant, -1, 1) - e.pitch) * Math.min(1, 10 * dt);
  }

  separate() {
    const list = [...this.enemies.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        let dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= 0.85 || Math.abs(a.y - b.y) > 1) continue;
        if (d < 1e-4) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; }
        const push = (0.85 - d) * 0.5 / (d || 1) * 0.5;
        const ax = a.x - dx * push, az = a.z - dz * push, bx = b.x + dx * push, bz = b.z + dz * push;
        if (this.nav.walkable(ax, az, a.y)) { a.x = ax; a.z = az; }
        if (this.nav.walkable(bx, bz, b.y)) { b.x = bx; b.z = bz; }
      }
    }
  }

  enemyFire(e, tg, dist, now) {
    if (now < e.nextShot) return;
    const def = e.def;
    if (e.burst === 0) { e.burst = this.randInt(def.burst[0], def.burst[1]); e.nextShot = now + this.rand(def.pause[0], def.pause[1]); return; }
    if (e.burst < 0) e.burst = this.randInt(def.burst[0], def.burst[1]);
    e.burst--;
    e.nextShot = now + 1000 / def.rps;

    const m = computeRig(e, def, this.rig).muzzle;
    const ox = m[0], oy = m[1], oz = m[2];
    const ty = tg.y + (tg.cr > 0.5 ? 0.75 : 1.2);
    const ax = tg.x - ox, ay = ty - oy, az = tg.z - oz, al = Math.hypot(ax, ay, az) || 1;
    const sig = def.spread * (1 + dist / 35) * (1 + Math.min(7, tg.speed) * 0.11) * (e.mode === 'hold' ? 1 : 1.6) * this.accScale() * DEG;
    const yaw = Math.atan2(-ax, -az) + this.gauss() * sig;
    const pit = Math.asin(clamp(ay / al, -1, 1)) + this.gauss() * sig * 0.7;
    const cp = Math.cos(pit), dx = -Math.sin(yaw) * cp, dy = Math.sin(pit), dz = -Math.cos(yaw) * cp;

    const wh = raycastWorld(SOLIDS, ox, oy, oz, dx, dy, dz, 120, true);
    let end = wh.t >= 0 ? wh.t : 120, victim = null;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const top = p.y + (p.cr > 0.5 ? PLAYER.crouchHeight : PLAYER.height) - 0.34;
      const t = rayCapsule(ox, oy, oz, dx, dy, dz, p.x, p.y + 0.34, p.z, p.x, top, p.z, 0.34);
      if (t >= 0 && t < end) { end = t; victim = p; }
    }
    this.broadcast({ t: 'ef', id: e.id, o: [r3(ox), r3(oy), r3(oz)], e: [r3(ox + dx * end), r3(oy + dy * end), r3(oz + dz * end)], v: victim ? victim.id : 0 });
    if (victim) this.hurt(victim, def.damage * this.dmgScale(), e.x, e.y + 1.4, e.z, 'bullet', e);
  }

  damageEnemy(e, dmg, by, d, group) {
    e.hp -= dmg;
    e.slow = this.now + 260;
    e.settle = Math.max(0, e.settle - 0.2);
    if (by.alive && (!e.target || Math.random() < 0.5)) { e.target = by; e.retargetT = this.now + 2500; }
    if (e.hp > 0) return false;
    this.enemies.delete(e.id);
    by.kills++;
    by.score += e.def.score + (group === 'head' ? 50 : 0);
    this.broadcast({ t: 'ed', id: e.id, by: by.id, hs: group === 'head' ? 1 : 0, ml: group === 'melee' ? 1 : 0, dx: r3(d[0]), dz: r3(d[2]), ty: e.ti, sc: e.def.score + (group === 'head' ? 50 : 0) });
    return true;
  }

  // ------------------------------------------------------------------ hit registration
  findSnap(T) {
    if (!num(T)) return null;
    const h = this.history;
    for (let i = h.length - 1; i >= 0; i--) {
      if (Math.abs(h[i].T - T) < 0.006) return h[i];
      if (h[i].T < T) break;
    }
    return null;
  }

  // The shooter tells us which two snapshots it was interpolating between and how far (a).
  // We rebuild every enemy's capsules from exactly those rows with the shared rig code and
  // ray-test them, so the server judges the same picture the player was looking at.
  // `pad` sweeps a sphere of that radius instead of a line; `bullets` lets it through chain-link.
  // Returns null for a malformed message, otherwise the ray and the nearest thing along it.
  trace(p, m, range, pad, bullets) {
    const o = m.o, d = m.d;
    if (!Array.isArray(o) || !Array.isArray(d) || o.length !== 3 || d.length !== 3 || !o.every(num) || !d.every(num)) return null;
    const dl = Math.hypot(d[0], d[1], d[2]);
    if (!(dl > 0.5 && dl < 2)) return null;
    const dx = d[0] / dl, dy = d[1] / dl, dz = d[2] / dl;
    let ox = o[0], oy = o[1], oz = o[2];
    // the muzzle can't be far from where we know the player is
    if (Math.hypot(ox - p.x, oy - (p.y + 1.4), oz - p.z) > 3.5) { ox = p.x; oy = p.y + PLAYER.eye; oz = p.z; }

    let h0 = this.findSnap(m.t0), h1 = this.findSnap(m.t1);
    let a = num(m.a) ? clamp(m.a, 0, 1) : 0;
    if (!h0 || !h1) { h0 = h1 = this.history[this.history.length - 1]; a = 0; }

    const wh = raycastWorld(SOLIDS, ox, oy, oz, dx, dy, dz, range, bullets);
    const wallT = wh.t >= 0 ? wh.t : range;
    let bestT = wallT, bestE = null, bestSeg = -1;
    if (h0) {
      for (const [id, row0] of h0.e) {
        const en = this.enemies.get(id);
        if (!en) continue;                           // died since that snapshot
        lerpEnemy(row0, h1.e.get(id), a, this.tmp);
        computeRig(this.tmp, en.def, this.rig);
        const r = rayRig(this.rig, ox, oy, oz, dx, dy, dz, bestT, pad);
        if (r.seg >= 0) { bestT = r.t; bestE = en; bestSeg = r.seg; }
      }
      // Favour the shooter on a near miss the client saw as a hit.
      if (!bestE && m.h) {
        const en = this.enemies.get(m.h), row0 = h0.e.get(m.h);
        if (en && row0) {
          lerpEnemy(row0, h1.e.get(m.h), a, this.tmp);
          computeRig(this.tmp, en.def, this.rig);
          const r = rayRig(this.rig, ox, oy, oz, dx, dy, dz, wallT, pad + FAVOR_PAD);
          if (r.seg >= 0) {
            bestT = r.t; bestE = en;
            bestSeg = Number.isInteger(m.s) && m.s >= 0 && m.s < SEG_COUNT && SEG_GROUP[m.s] === SEG_GROUP[r.seg] ? m.s : r.seg;
            this.stats.favored++;
          }
        }
      }
    }
    const tr = this.tr;
    tr.o[0] = r3(ox); tr.o[1] = r3(oy); tr.o[2] = r3(oz);
    tr.end[0] = r3(ox + dx * bestT); tr.end[1] = r3(oy + dy * bestT); tr.end[2] = r3(oz + dz * bestT);
    tr.d[0] = dx; tr.d[1] = dy; tr.d[2] = dz; tr.enemy = bestE; tr.seg = bestSeg;
    return tr;
  }

  onShot(p, m) {
    const now = this.now;
    if (!p.alive) return;
    p.tokens = Math.min(4, p.tokens + (now - p.tokT) * AR.rpm / 60000); p.tokT = now;
    if (p.tokens < 1) return;
    p.tokens -= 1;
    const tr = this.trace(p, m, AR.range, 0, true);
    if (!tr) return;
    this.stats.shots++;

    const en = tr.enemy;
    let dmg = 0, killed = false;
    if (en) {
      const group = SEG_GROUP[tr.seg];
      let mult = PART_MULT[group];
      if (group === 'head') mult = 1 + (mult - 1) * en.def.headMult;
      dmg = Math.round(AR.damage * mult);
      this.stats.hits++;
      killed = this.damageEnemy(en, dmg, p, tr.d, group);
    }
    this.send(p, { t: 'h', n: m.n | 0, id: en ? en.id : 0, s: tr.seg, dmg, k: killed ? 1 : 0 });
    this.broadcast({ t: 'f', id: p.id, o: tr.o, e: tr.end, h: en ? en.id : 0 }, p);
  }

  // A knife cut is judged like a shot - same rewind, same capsules - but it is short, swept
  // wide, stopped by chain-link, and does the same to every part of the body.
  onMelee(p, m) {
    const now = this.now;
    if (!p.alive || now < p.cutAt) return;
    const tr = this.trace(p, m, KNIFE.range, KNIFE.radius, false);
    if (!tr) return;
    p.cutAt = now + KNIFE.time * 750;                 // one cut per swing of the arm, with slack for jitter
    const en = tr.enemy;
    const killed = en ? this.damageEnemy(en, KNIFE.damage, p, tr.d, 'melee') : false;
    this.send(p, { t: 'h', n: m.n | 0, id: en ? en.id : 0, s: tr.seg, dmg: en ? KNIFE.damage : 0, k: killed ? 1 : 0 });
    this.broadcast({ t: 'k', id: p.id, o: tr.o, e: tr.end, h: en ? en.id : 0, s: tr.seg }, p);
  }

  // ------------------------------------------------------------------ snapshots
  snapshot(now) {
    const T = Math.round(now * 100) / 100;
    const eRows = [], pRows = [], eMap = new Map(), pMap = new Map();
    for (const e of this.enemies.values()) {
      const row = [e.id, e.ti, r3(e.x), r3(e.y), r3(e.z), r4(e.yaw), r4(e.pitch), r3(e.ph), r3(e.mv), r3(e.cr), r3(e.aim), r3(e.atk)];
      eRows.push(row); eMap.set(e.id, row);
    }
    for (const p of this.players.values()) {
      if (!p.joined) continue;
      const row = [p.id, r3(p.x), r3(p.y), r3(p.z), r4(p.yaw), r4(p.pitch), r3(p.ph), r3(p.mv), r3(p.cr),
        (p.flags & ~PF.ALIVE) | (p.alive ? PF.ALIVE : 0), Math.max(0, Math.round(p.hp))];
      pRows.push(row); pMap.set(p.id, row);
    }
    this.history.push({ T, e: eMap, p: pMap });
    while (this.history.length && this.history[0].T < now - HISTORY_MS) this.history.shift();
    const msg = JSON.stringify({
      t: 's', T,
      w: [this.wave, PHASES.indexOf(this.phase), this.queue.length + this.enemies.size, this.tickets, Math.max(0, Math.round(this.phaseEnd - now))],
      p: pRows, e: eRows,
    });
    for (const p of this.players.values()) if (p.joined && p.ws.readyState === 1) p.ws.send(msg);
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now; this.now = now;
    this.tickN++;
    this.updatePhase(now);
    for (const e of this.enemies.values()) this.updateEnemy(e, dt, now);
    this.separate();
    for (const p of this.players.values()) this.updatePlayer(p, dt, now);
    if (this.tickN % SNAP_EVERY === 0) this.snapshot(now);
    if (now - this.lastRoster > 1000) this.sendRoster();
  }
}

// how much a pushing enemy keeps its weapon shouldered (heavies walk-fire, grunts jog)
function type2aim(def) { return def.bulk > 1.1 ? 1 : 0.35; }
