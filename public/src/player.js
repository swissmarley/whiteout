// Local player: movement, collision against the shared boxes, vaulting / mantling, camera.

import { PLAYER, PF } from '../shared/constants.js';
import { SOLIDS } from '../shared/map.js';
import { overlapBox, supportY } from '../shared/collide.js';

const HW = PLAYER.halfWidth;
const ease = (u) => u * u * (3 - 2 * u);
const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);
const mix = (a, b, t) => a + (b - a) * t;

export class Player {
  constructor() {
    this.pos = { x: 0, y: 0, z: 0 }; this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0;
    this.onGround = true; this.crouching = false; this.cr = 0; this.sprinting = false; this.strafe = 0;
    this.bobPh = 0; this.mv = 0; this.stepOff = 0; this.dip = 0; this.dipV = 0; this.roll = 0;
    this.vault = null; this.vaultCd = 0; this.vaultHint = false;
    this.hp = PLAYER.maxHp; this.alive = false; this.deadT = 0; this.fellFrom = 0;
    this.onStep = null; this.onLand = null; this.onJump = null; this.onVault = null;
  }

  spawn(x, y, z, yaw) {
    this.pos.x = x; this.pos.y = y; this.pos.z = z; this.vel.x = this.vel.y = this.vel.z = 0;
    this.yaw = yaw; this.pitch = 0; this.onGround = true; this.crouching = false; this.cr = 0; this.vault = null;
    this.hp = PLAYER.maxHp; this.alive = true; this.deadT = 0; this.stepOff = 0; this.dip = 0; this.roll = 0;
  }

  height() { return this.crouching ? PLAYER.crouchHeight : PLAYER.height; }

  flags(weapon) {
    return (this.sprinting ? PF.SPRINT : 0) | (weapon.ads ? PF.ADS : 0) | (this.vault ? PF.VAULT : 0) | (weapon.reloading ? PF.RELOAD : 0) | (this.onGround ? 0 : PF.AIR);
  }

  // ctl: { f, s, jump, jumpHeld, crouch, sprint, ads, lookX, lookY }  (look already scaled to radians)
  update(dt, ctl) {
    this.yaw -= ctl.lookX; this.pitch -= ctl.lookY;
    if (this.pitch > 1.5) this.pitch = 1.5; else if (this.pitch < -1.5) this.pitch = -1.5;
    this.vaultCd -= dt;
    this.stepOff *= Math.exp(-dt * 14);
    this.dipV += (-170 * this.dip - 17 * this.dipV) * dt; this.dip += this.dipV * dt;
    if (this.vault) { this.updateVault(dt); return; }

    const p = this.pos, v = this.vel;
    // crouch (only stand back up if there is headroom)
    if (ctl.crouch) this.crouching = true;
    else if (this.crouching && !overlapBox(SOLIDS, p.x, p.y, p.z, HW - 0.01, PLAYER.height)) this.crouching = false;
    this.cr += ((this.crouching ? 1 : 0) - this.cr) * Math.min(1, 13 * dt);
    const h = this.height();

    let f = ctl.f, s = ctl.s; const il = Math.hypot(f, s);
    if (il > 1) { f /= il; s /= il; }
    this.strafe = s;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = -sin * f + cos * s, wz = -cos * f - sin * s;
    this.sprinting = ctl.sprint && f > 0.5 && !this.crouching && !ctl.ads;
    let speed = this.crouching ? PLAYER.crouch : this.sprinting ? PLAYER.sprint : ctl.ads ? PLAYER.ads : PLAYER.walk;
    if (f < -0.1) speed *= 0.85;

    if (this.onGround) {
      const k = Math.min(1, 13 * dt);
      v.x += (wx * speed - v.x) * k; v.z += (wz * speed - v.z) * k;
    } else {
      v.x += wx * 9 * dt; v.z += wz * 9 * dt;
      const sp = Math.hypot(v.x, v.z), cap = Math.max(speed, this.airCap || 0);
      if (sp > cap) { v.x *= cap / sp; v.z *= cap / sp; }
    }

    // space: vault / mantle if there is something to climb, otherwise jump
    this.vaultHint = this.onGround && f > 0.2 && this.probeVault(false);
    if ((ctl.jump || (ctl.jumpHeld && !this.onGround && f > 0.2)) && this.probeVault(true)) return;
    if (ctl.jump && this.onGround) {
      v.y = PLAYER.jumpV * (this.crouching ? 0.85 : 1); this.onGround = false; this.airCap = Math.hypot(v.x, v.z);
      this.onJump && this.onJump();
    }

    v.y -= PLAYER.gravity * dt;
    this.moveAxis(0, v.x * dt, h);
    this.moveAxis(2, v.z * dt, h);

    // vertical
    const wasGround = this.onGround;
    let ny = p.y + v.y * dt, landed = false;
    const sup = supportY(SOLIDS, p.x, p.z, HW, p.y + 1e-3);
    if (v.y <= 0 && ny <= sup) { ny = sup; landed = true; }
    else if (v.y > 0) { const c = overlapBox(SOLIDS, p.x, ny, p.z, HW, h); if (c) { ny = Math.max(p.y, c.y0 - h - 1e-3); v.y = 0; } }
    // walking down a step or kerb: stay glued instead of going airborne for a frame
    if (!landed && wasGround && v.y <= 0 && ny - sup <= PLAYER.step) { this.stepOff += ny - sup; ny = sup; landed = true; }
    if (landed) {
      if (!wasGround) { const impact = -v.y; if (impact > 2.5) { this.dipV -= Math.min(2.6, impact * 0.22); this.onLand && this.onLand(impact); } }
      v.y = 0;
    }
    if (wasGround && !landed) this.airCap = Math.max(speed, Math.hypot(v.x, v.z));
    this.onGround = landed;
    p.y = ny;

    // gait
    const sp = Math.hypot(v.x, v.z);
    this.mv += ((this.onGround ? Math.min(1, sp / PLAYER.sprint) : 0.2) - this.mv) * Math.min(1, 10 * dt);
    if (this.onGround && sp > 0.9) {
      const prev = this.bobPh;
      this.bobPh += dt * (5.4 + sp * 1.02);
      const a = Math.floor(this.bobPh / Math.PI);
      if (a !== Math.floor(prev / Math.PI)) this.onStep && this.onStep(a % 2 === 0, this.sprinting, this.crouching);
    }
    this.roll += (-s * 0.014 * Math.min(1, sp / 4) - this.roll) * Math.min(1, 8 * dt);
  }

  moveAxis(axis, delta, h) {
    if (!delta) return;
    const p = this.pos, old = axis === 0 ? p.x : p.z;
    if (axis === 0) p.x += delta; else p.z += delta;
    const s = overlapBox(SOLIDS, p.x, p.y, p.z, HW, h);
    if (!s) return;
    const rise = s.y1 - p.y;
    if (this.onGround && rise > 0 && rise <= PLAYER.step && !overlapBox(SOLIDS, p.x, s.y1, p.z, HW, h)) { p.y = s.y1; this.stepOff -= rise; return; }
    if (axis === 0) { p.x = delta > 0 ? s.x0 - HW - 1e-4 : s.x1 + HW + 1e-4; if (overlapBox(SOLIDS, p.x, p.y, p.z, HW, h)) p.x = old; this.vel.x = 0; }
    else { p.z = delta > 0 ? s.z0 - HW - 1e-4 : s.z1 + HW + 1e-4; if (overlapBox(SOLIDS, p.x, p.y, p.z, HW, h)) p.z = old; this.vel.z = 0; }
  }

  // Looks for a ledge in front of the player using the real collision boxes.
  //  - low + thin, with somewhere to land beyond  -> vault over
  //  - anything else up to chest/head height      -> mantle on top
  probeVault(commit) {
    if (this.vaultCd > 0) return false;
    const p = this.pos, fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    let s = null, d = 0.1;
    for (; d <= 0.76; d += 0.11) { s = overlapBox(SOLIDS, p.x + fx * d, p.y + 0.36, p.z + fz * d, HW * 0.7, 1.3); if (s) break; }
    if (!s || s.noVault) return false;
    let top = s.y1;
    const ex = p.x + fx * (d + 0.34), ez = p.z + fz * (d + 0.34);
    for (let i = 0; i < 3; i++) {                           // stacked crates: climb to the true top
      const s2 = overlapBox(SOLIDS, ex, top + 0.02, ez, HW * 0.7, 0.85);
      if (!s2) break;
      if (s2.noVault) return false;
      top = s2.y1;
    }
    const rel = top - p.y;
    if (rel < 0.38 || rel > 1.62) return false;
    if (overlapBox(SOLIDS, ex, top + 0.02, ez, HW, PLAYER.crouchHeight - 0.2)) return false;       // no room on top
    if (overlapBox(SOLIDS, p.x, p.y + 0.05, p.z, HW - 0.02, rel + 0.95)) return false;              // overhang above us

    let land = null;
    if (rel <= 1.32) {
      for (let dd = d + 0.7; dd <= d + 2.5; dd += 0.15) {
        const lx = p.x + fx * dd, lz = p.z + fz * dd;
        if (overlapBox(SOLIDS, lx, top + 0.02, lz, HW, 0.9)) break;
        const sup = supportY(SOLIDS, lx, lz, HW, top + 0.02);
        if (sup <= top - 0.3 && !overlapBox(SOLIDS, lx, sup + 0.01, lz, HW, PLAYER.height)) { land = { x: lx, y: sup, z: lz }; break; }
      }
    }
    if (!commit) return true;

    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (land) {
      this.vault = { over: true, t: 0, dur: 0.46 + rel * 0.16 - Math.min(0.1, speed * 0.012), x0: p.x, y0: p.y, z0: p.z, x1: land.x, y1: land.y, z1: land.z, top, fx, fz, side: Math.random() < 0.5 ? -1 : 1, exit: Math.max(3.4, speed * 0.8) };
    } else {
      const stand = !overlapBox(SOLIDS, ex, top + 0.01, ez, HW, PLAYER.height);
      this.vault = { over: false, t: 0, dur: 0.42 + rel * 0.36, x0: p.x, y0: p.y, z0: p.z, x1: ex, y1: top, z1: ez, top, fx, fz, side: Math.random() < 0.5 ? -1 : 1, exit: 1.4, crouchEnd: !stand };
    }
    this.vel.x = this.vel.y = this.vel.z = 0; this.sprinting = false;
    this.onVault && this.onVault(this.vault);
    return true;
  }

  updateVault(dt) {
    const v = this.vault, p = this.pos;
    v.t += dt / v.dur;
    const u = clamp01(v.t);
    if (v.over) {
      const peak = v.top + 0.08, hz = ease(u);
      p.x = mix(v.x0, v.x1, hz); p.z = mix(v.z0, v.z1, hz);
      p.y = u < 0.42 ? mix(v.y0, peak, ease(u / 0.42)) : mix(peak, v.y1, Math.pow((u - 0.42) / 0.58, 1.8));
      this.cr = Math.sin(u * Math.PI) * 0.9;                 // tuck the legs
    } else {
      const up = ease(clamp01(u / 0.64)), fw = ease(clamp01((u - 0.36) / 0.64));
      p.y = mix(v.y0, v.y1, up); p.x = mix(v.x0, v.x1, fw); p.z = mix(v.z0, v.z1, fw);
      this.cr = Math.sin(u * Math.PI) * 0.6;
    }
    this.roll = Math.sin(u * Math.PI) * 0.1 * v.side;
    this.mv = 0.3; this.bobPh += dt * 6;
    if (u >= 1) {
      p.x = v.x1; p.y = v.y1; p.z = v.z1;
      this.vel.x = v.fx * v.exit; this.vel.z = v.fz * v.exit; this.vel.y = 0;
      this.onGround = true; this.crouching = !!v.crouchEnd; this.vault = null; this.vaultCd = 0.22;
      if (v.over) this.dipV -= 1.3;
    }
  }

  // extra: { pitch, yaw } recoil offsets, shake: small random offsets
  applyCamera(cam, dt, recoil, shake) {
    const eye = mix(PLAYER.eye, PLAYER.crouchEye, this.cr);
    const bobK = this.onGround && !this.vault ? Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 4.4) : 0;
    let y = this.pos.y + eye + this.stepOff + this.dip + Math.sin(this.bobPh * 2) * 0.026 * bobK * (this.sprinting ? 1.5 : 1);
    let x = this.pos.x, z = this.pos.z, roll = this.roll, pitch = this.pitch + recoil.pitch, yaw = this.yaw + recoil.yaw;
    const side = Math.cos(this.bobPh) * 0.018 * bobK;
    x += Math.cos(this.yaw) * side; z -= Math.sin(this.yaw) * side;
    if (this.vault) pitch -= Math.sin(clamp01(this.vault.t) * Math.PI) * (this.vault.over ? 0.2 : 0.14);
    if (!this.alive) {                                        // slump to the ground
      this.deadT += dt;
      const k = ease(clamp01(this.deadT / 0.9));
      y = this.pos.y + mix(eye, 0.24, k); roll += k * 1.25; pitch = mix(pitch, 0.25, k);
    }
    cam.position.set(x + shake.x, y + shake.y, z + shake.z);
    cam.rotation.set(pitch, yaw, roll + shake.r, 'YXZ');
  }
}
