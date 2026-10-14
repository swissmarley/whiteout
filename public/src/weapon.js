// First-person assault rifle: model, handling, recoil, reload, muzzle flash, brass, and the
// knife the support hand draws for a cut.
// Lives in its own scene/camera so it never clips into walls and keeps a sane FOV.

import * as THREE from 'three';
import { AR, KNIFE } from '../shared/constants.js';
import { flashTex, glowTex, grainSet, clothSet } from './textures.js';
import { surfaceMaterial } from './mesh.js';
import { RIFLE, buildRifle, buildBolt, buildMagazine } from './rifle.js';
import { buildArms, SupportArm } from './hands.js';
import { buildKnife } from './knife.js';

const DEG = Math.PI / 180;
export const VM_FOV = 55;

// View-kick pattern in degrees. First rounds climb hard and straight, then the gun starts to
// walk left/right - learnable, like a real spray pattern, with a little noise on top.
const KICK_V = [1.3, 1.22, 1.28, 1.32, 1.25, 1.15, 1.02, 0.92, 0.84, 0.78, 0.72, 0.7];
const KICK_H = [0, 0.16, -0.2, 0.26, 0.4, 0.3, -0.22, -0.5, -0.56, -0.3, 0.24, 0.52, 0.62, 0.36, -0.2, -0.5, -0.62, -0.4, 0.16, 0.48, 0.56, 0.2, -0.3, -0.5, -0.3, 0.2, 0.45, 0.3, -0.2, -0.4];

// Anchors on the model (gun space). ADS puts the sight line through the middle of the screen.
const SIGHT_Y = RIFLE.sightY;
const HIP = { p: [0.094, -0.158, -0.33], r: [0.02, 0.05, 0.015] };
const ADS = { p: [0, -SIGHT_Y, -0.165], r: [0, 0, 0] };
const MUZZLE = new THREE.Vector3(...RIFLE.muzzle);
const PORT = new THREE.Vector3(...RIFLE.port);
const BOLT_TRAVEL = 0.045;

class Spring {
  constructor(k, c) { this.k = k; this.c = c; this.x = 0; this.v = 0; }
  step(dt) { this.v += (-this.k * this.x - this.c * this.v) * dt; this.x += this.v * dt; }
}

// piecewise-smooth keyframes: [[t, v], ...]
function kf(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) { let u = (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]); u = u * u * (3 - 2 * u); return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * u; }
  }
  return keys[keys.length - 1][1];
}

export class Weapon {
  constructor(env) {
    this.scene = new THREE.Scene();
    this.scene.environment = env; this.scene.environmentIntensity = 1.5;
    this.camera = new THREE.PerspectiveCamera(VM_FOV, 1, 0.01, 6);
    this.hemi = new THREE.HemisphereLight(0xb4c0e6, 0x4a4d5a, 0.9);
    this.rim = new THREE.DirectionalLight(0x8fa6e0, 0.9); this.rim.position.set(-0.8, 0.5, -0.6);
    this.key = new THREE.DirectionalLight(0xffffff, 1.2); this.key.position.set(0.5, 1, 0.35);
    this.scene.add(this.hemi, this.key, this.rim);

    this.mag = AR.mag; this.reserve = AR.reserve; this.auto = true;
    this.fireT = 0; this.reloadT = -1; this.reloadDone = false; this.dryT = 0;
    this.adsT = 0; this.sprintT = 0; this.downT = 0;
    this.recoil = { pitch: 0, yaw: 0, tp: 0, ty: 0 };
    this.kz = new Spring(520, 30); this.krx = new Spring(480, 28); this.kry = new Spring(380, 24); this.krz = new Spring(340, 20);
    this.swayX = 0; this.swayY = 0; this.tilt = 0; this.land = new Spring(180, 16);
    this.burst = 0; this.sinceShot = 9; this.bloom = 0; this.heat = 0; this.flashT = 0; this.time = 0;
    this.spread = 1; this.lightOn = true;
    this.meleeT = -1; this.cutStage = 0; this.bite = 0; this.tip = 0;
    this.view = { pitch: 0, yaw: 0, roll: 0, fov: 0 };      // how the head moves with the cut; for show, never for aim
    this.onFire = null; this.onSound = null; this.onCasing = null; this.onSmoke = null; this.onMelee = null;

    this.build();
  }

  build() {
    const grain = grainSet(), cloth = clothSet();
    grain.roughnessMap.repeat.setScalar(0.12); cloth.roughnessMap.repeat.setScalar(0.1);
    this.hardMat = surfaceMaterial({ ...grain, normalScale: 0.55, envMapIntensity: 1.5 });
    this.clothMat = surfaceMaterial({ ...cloth, normalScale: 0.9, envMapIntensity: 0.9 });

    const root = this.root = new THREE.Group(); this.scene.add(root);
    const gun = this.gun = new THREE.Group(); root.add(gun);
    gun.add(new THREE.Mesh(buildRifle(), this.hardMat));

    // bolt carrier, visible through the ejection port; cycles with each shot
    this.bolt = new THREE.Mesh(buildBolt(), this.hardMat); gun.add(this.bolt);

    // magazine
    this.magGroup = new THREE.Group(); gun.add(this.magGroup);
    this.magGroup.add(new THREE.Mesh(buildMagazine(), this.hardMat));

    // optic: two coated panes in the hood + the reticle, which only shows when you look down the tube
    const pane = new THREE.ShapeGeometry(new THREE.Shape(RIFLE.window.map((p) => new THREE.Vector2(p[0], p[1] - SIGHT_Y))));
    this.lens = new THREE.Mesh(pane, new THREE.MeshBasicMaterial({ color: 0x1c5a50, transparent: true, opacity: 0.05, depthWrite: false }));
    this.lens.position.set(0, SIGHT_Y, RIFLE.lensZ[0]); gun.add(this.lens);
    const glint = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, envMapIntensity: 2.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const front = new THREE.Mesh(pane, glint); front.position.z = RIFLE.lensZ[1] - RIFLE.lensZ[0]; front.rotation.x = -0.12; this.lens.add(front);
    this.dot = new THREE.Mesh(new THREE.PlaneGeometry(0.0046, 0.0046), new THREE.MeshBasicMaterial({ map: glowTex(), color: new THREE.Color(9, 0.5, 0.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dot.position.set(0, SIGHT_Y, RIFLE.lensZ[1] + 0.004); this.dot.renderOrder = 5; gun.add(this.dot);
    const L = RIFLE.light;
    this.torchLens = new THREE.Mesh(new THREE.CircleGeometry(L.r, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.7, 1.9), side: THREE.DoubleSide }));
    this.torchLens.position.set(L.x, L.y, L.z); gun.add(this.torchLens);

    // gloved hands + winter-jacket sleeves; the support arm moves on its own so it can work the reload
    const arms = buildArms();
    gun.add(new THREE.Mesh(arms.right, this.clothMat));
    this.support = new SupportArm(arms.left, this.clothMat, new THREE.Mesh(buildKnife(), this.hardMat)); gun.add(this.support.group);

    // muzzle flash: one sprite-like plane facing the eye, two blades along the bore
    const ft = flashTex(), fm = () => new THREE.MeshBasicMaterial({ map: ft, color: new THREE.Color(5.5, 4.2, 2.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.flash = new THREE.Group(); this.flash.position.copy(MUZZLE); this.flash.visible = false; gun.add(this.flash);
    this.flashA = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), fm());
    this.flashB = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.34).rotateX(-Math.PI / 2).translate(0, 0, -0.13), fm());
    this.flashC = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.34).rotateX(-Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0, -0.13), fm());
    this.flash.add(this.flashA, this.flashB, this.flashC);
    this.flashLight = new THREE.PointLight(0xffc27a, 0, 2.2, 2); this.flashLight.position.copy(MUZZLE).add(new THREE.Vector3(0, 0.05, 0.1)); gun.add(this.flashLight);
  }

  reset() {
    this.mag = AR.mag; this.reserve = AR.reserve; this.reloadT = -1; this.meleeT = -1; this.tip = 0; this.fireT = 0; this.bloom = 0; this.burst = 0;
    this.recoil.pitch = this.recoil.yaw = this.recoil.tp = this.recoil.ty = 0;
    this.magGroup.position.set(0, 0, 0); this.magGroup.visible = true;
  }

  get reloading() { return this.reloadT >= 0; }
  get meleeing() { return this.meleeT >= 0; }
  resupply() { if (this.reserve >= AR.reserve) return false; this.reserve = AR.reserve; return true; }

  startReload() {
    if (this.reloading || this.meleeing || this.mag >= AR.mag || this.reserve <= 0) return;
    this.reloadT = 0; this.reloadDone = false; this.rs = 0;
  }

  // The knife comes out whatever the support hand was doing. A reload is abandoned: rounds
  // count only if the fresh magazine was already seated.
  startMelee() {
    if (this.meleeing) return;
    this.reloadT = -1;
    this.meleeT = 0; this.cutStage = 0; this.bite = 0;
    this.support.begin();
    this.onSound && this.onSound('draw');
  }

  // ctl: { fire, firePressed, ads, reload, melee, mx, my, canFire }   player: Player
  update(dt, ctl, player, lightColor) {
    this.time += dt;
    const moving = Math.hypot(player.vel.x, player.vel.z), speedK = Math.min(1, moving / 6.7), vault = !!player.vault;

    // --- knife: draw, cut at KNIFE.hitAt, and back onto the rifle
    if (ctl.melee && ctl.canFire && !vault && player.alive) this.startMelee();
    if (this.meleeing) {
      // when the blade meets something it bites: time all but stops for a few frames
      this.bite -= dt;
      this.meleeT += dt * (this.bite > 0 ? 0.1 : 1);
      if (this.cutStage === 0 && this.meleeT >= KNIFE.hitAt - 0.07) { this.cutStage = 1; this.onSound && this.onSound('swing'); }
      if (this.cutStage === 1 && this.meleeT >= KNIFE.hitAt) {
        this.cutStage = 2;
        if (this.onMelee && this.onMelee()) { this.bite = 0.055; this.kz.v += 0.5; this.krz.v -= 1.6; }
      }
      if (this.meleeT >= KNIFE.time || !player.alive) this.meleeT = -1;
    }
    const sprint = player.sprinting && !this.reloading && !this.meleeing;

    // --- state blends
    const wantAds = ctl.ads && !sprint && !vault && !this.reloading && !this.meleeing && player.alive;
    this.adsT += ((wantAds ? 1 : 0) - this.adsT) * (1 - Math.exp(-dt * 17));
    this.sprintT += ((sprint ? 1 : 0) - this.sprintT) * (1 - Math.exp(-dt * 11));
    this.downT += ((vault || !player.alive ? 1 : 0) - this.downT) * (1 - Math.exp(-dt * 12));
    this.ads = this.adsT > 0.55;

    // --- reload
    if (ctl.reload) this.startReload();
    if (this.reloading) {
      this.reloadT += dt;
      const u = this.reloadT / AR.reloadTime;
      if (this.rs === 0 && u > 0.14) { this.rs = 1; this.onSound && this.onSound('magout'); }
      if (this.rs === 1 && u > 0.56) { this.rs = 2; this.onSound && this.onSound('magin'); const n = Math.min(AR.mag - this.mag, this.reserve); this.mag += n; this.reserve -= n; this.kz.v += 0.25; }
      if (this.rs === 2 && u > 0.76) { this.rs = 3; this.onSound && this.onSound('bolt'); this.krx.v -= 0.9; }
      if (u >= 1) this.reloadT = -1;
    }

    // --- trigger
    this.fireT = Math.max(this.fireT - dt, -dt);
    this.sinceShot += dt;
    const ready = ctl.canFire && !this.reloading && !this.meleeing && !vault && this.sprintT < 0.35 && player.alive;
    const pull = this.auto ? ctl.fire : ctl.firePressed;
    if (pull && ready) {
      if (this.mag > 0) {
        let guard = 0;
        while (this.fireT <= 0 && this.mag > 0 && guard++ < 3) { this.fire(player, ctl); this.fireT += 60 / AR.rpm; if (!this.auto) break; }
      } else if (ctl.firePressed || this.dryT <= 0) {
        if (ctl.firePressed) { this.onSound && this.onSound('dry'); this.krx.v += 0.15; }
        if (this.reserve > 0) this.startReload();
        this.dryT = 0.3;
      }
    }
    this.dryT -= dt;
    if (this.sinceShot > 0.13) this.burst = 0;

    // --- view recoil: snap towards the accumulated kick, then settle back once the trigger is released
    const R = this.recoil;
    if (this.sinceShot > 0.1) { const d = Math.exp(-dt * 7.5); R.tp *= d; R.ty *= d; }
    const k = 1 - Math.exp(-dt * 42);
    R.pitch += (R.tp - R.pitch) * k; R.yaw += (R.ty - R.yaw) * k;

    // --- spread
    this.bloom = Math.max(0, this.bloom - dt * (this.sinceShot > 0.12 ? 7 : 1.2));
    const a = this.adsT, cr = player.crouching ? 0.75 : 1;
    this.spread = ((1.15 * (1 - a) + 0.05 * a) + speedK * (1.5 * (1 - a) + 0.45 * a) + (player.onGround ? 0 : 3.2) + this.bloom * (1 - a * 0.78)) * cr;

    // --- weapon springs
    const sub = Math.max(1, Math.ceil(dt / 0.006)), h = dt / sub;
    for (let i = 0; i < sub; i++) { this.kz.step(h); this.krx.step(h); this.kry.step(h); this.krz.step(h); this.land.step(h); }

    // --- pose
    const g = this.gun, e = 1 - a, bobK = (0.25 + 0.75 * e) * (player.onGround ? Math.min(1, moving / 4.4) : 0), ph = player.bobPh;
    this.swayX += (THREE.MathUtils.clamp(-ctl.mx * 0.00055, -0.03, 0.03) - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (THREE.MathUtils.clamp(ctl.my * 0.00055, -0.03, 0.03) - this.swayY) * Math.min(1, dt * 9);
    this.tilt += (-player.strafe * 0.035 - this.tilt) * Math.min(1, dt * 8);
    const sp = this.sprintT, dn = this.downT, br = Math.sin(this.time * 1.5);
    let px = HIP.p[0] * e + ADS.p[0] * a, py = HIP.p[1] * e + ADS.p[1] * a, pz = HIP.p[2] * e + ADS.p[2] * a;
    let rx = HIP.r[0] * e, ry = HIP.r[1] * e, rz = HIP.r[2] * e;
    // walk / sprint bob (figure-eight), breathing, landing
    px += Math.cos(ph) * 0.0055 * bobK * (1 + sp * 1.6); py += -Math.abs(Math.sin(ph)) * 0.0075 * bobK * (1 + sp * 1.4) + br * 0.0011 * (0.4 + e) + this.land.x;
    rz += Math.cos(ph) * 0.012 * bobK * (1 + sp); rx += br * 0.0025 * (0.3 + e) + this.land.x * 1.2;
    // sprint carry: muzzle up and across the body
    px -= 0.075 * sp; py -= 0.02 * sp; pz += 0.05 * sp; ry += 0.72 * sp; rx += 0.2 * sp; rz += 0.22 * sp;
    // lowered (vaulting / dead)
    py -= 0.24 * dn; rx -= 0.75 * dn; rz += 0.3 * dn;
    // knife: the rifle is dropped aside in the firing hand, and swings with the body as it
    // winds up against the cut and then turns through it; the head goes the same way
    const view = this.view;
    view.pitch = view.yaw = view.roll = view.fov = 0;
    if (this.meleeing) {
      const t = this.meleeT, H = KNIFE.hitAt;
      const away = kf(t, [[0, 0], [0.17, 1], [0.54, 1], [KNIFE.time, 0]]), turn = kf(t, [[0.1, 0], [H - 0.06, -0.55], [H + 0.09, 1], [0.6, 0.45], [KNIFE.time, 0]]);
      px += 0.085 * away + 0.035 * turn; py -= 0.105 * away; pz += 0.065 * away - 0.02 * turn;
      rx -= 0.26 * away; ry -= 0.3 * away + 0.12 * turn; rz -= 0.36 * away + 0.08 * turn;
      view.yaw = -0.05 * turn; view.pitch = -0.024 * kf(t, [[H - 0.07, 0], [H + 0.08, 1], [0.58, 0.3], [KNIFE.time, 0]]) + 0.008 * away;
      view.roll = -0.04 * turn; view.fov = 2.2 * kf(t, [[H - 0.08, 0], [H + 0.02, 1], [0.56, 0]]);
    }
    // mouse sway + strafe tilt
    px += this.swayX * 0.5 * (0.35 + e * 0.65); py += this.swayY * 0.5 * (0.35 + e * 0.65); ry += this.swayX * 1.3; rx += this.swayY * 1.1; rz += this.tilt + this.swayX * 1.5;
    // recoil
    pz += this.kz.x; py += this.krx.x * 0.012; rx += this.krx.x; ry += this.kry.x; rz += this.krz.x;

    // reload choreography
    let magY = 0, magVis = true, tip = this.tip * Math.exp(-dt * 16);     // an abandoned reload rolls back out, it does not snap
    if (this.reloading) {
      const u = this.reloadT / AR.reloadTime;
      tip = kf(u, [[0, 0], [0.12, 1], [0.62, 1], [0.74, 0.55], [0.86, 0.3], [1, 0]]);
      py -= 0.012 * Math.sin(Math.min(1, Math.max(0, (u - 0.54) / 0.06)) * Math.PI);
      magY = kf(u, [[0, 0], [0.14, 0], [0.27, -0.34], [0.36, -0.34], [0.54, -0.02], [0.57, 0], [1, 0]]);
      magVis = !(u > 0.26 && u < 0.37);
      // left hand: off the handguard to the magazine, down and back up with it, thumb to the bolt release, home
      if (u < 0.6) this.support.set('grip', 'mag', Math.min(1, u / 0.12), magY);
      else if (u < 0.8) this.support.set('mag', 'press', Math.min(1, (u - 0.6) / 0.12), 0, 0.007 * kf(u, [[0.73, 0], [0.76, 1], [0.8, 0]]));
      else this.support.set('press', 'grip', Math.min(1, (u - 0.8) / 0.13));
    } else if (!this.meleeing) this.support.set('grip', 'grip', 0);
    // roll the magazine well up towards the eye so the change is seen, not just heard
    this.tip = tip;
    rz -= 0.52 * tip; rx += 0.34 * tip; ry += 0.1 * tip; px -= 0.05 * tip; py += 0.062 * tip;
    this.magGroup.position.y = magY; this.magGroup.visible = magVis;

    g.position.set(px, py, pz); g.rotation.set(rx, ry, rz, 'YXZ');
    if (this.meleeing) this.support.cut(this.meleeT, g);
    this.bolt.position.z = Math.max(0, BOLT_TRAVEL - this.sinceShot * 1.2) * (this.sinceShot < 0.04 ? 1 : 0.6);

    // --- flash + lighting
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 70);
    const lum = Math.max(0.12, lightColor.r * 0.4 + lightColor.g * 0.45 + lightColor.b * 0.15);
    this.key.color.copy(lightColor).multiplyScalar(1 / Math.max(lightColor.r, lightColor.g, lightColor.b, 0.001));
    this.key.intensity = Math.min(3.4, 0.5 + lum * 2.4); this.hemi.intensity = 0.7 + Math.min(1, lum) * 0.6;
    this.dot.material.opacity = 0.35 + 0.65 * a;
    this.torchLens.visible = this.lightOn;

    // lingering smoke off a hot barrel
    this.heat = Math.max(0, this.heat - dt * 0.9);
    if (this.heat > 0.5 && this.sinceShot > 0.12 && this.sinceShot < 1.6 && Math.random() < dt * 26 * Math.min(1, this.heat / 3)) this.onSmoke && this.onSmoke();
  }

  fire(player, ctl) {
    const a = this.adsT, i = this.burst++;
    this.mag--; this.sinceShot = 0;
    this.onFire && this.onFire(this.spread);

    // view kick
    const ck = (1 - 0.3 * a) * (player.crouching ? 0.85 : 1);
    const R = this.recoil;
    R.tp = Math.min(R.tp + KICK_V[Math.min(i, KICK_V.length - 1)] * DEG * ck, 13.5 * DEG);
    R.ty += (KICK_H[i % KICK_H.length] + (Math.random() - 0.5) * 0.24) * DEG * ck * (i < KICK_H.length ? 1 : 0.8);
    this.bloom = Math.min(2.2, this.bloom + 0.24);

    // weapon kick
    const wk = 1 - 0.55 * a;
    this.kz.v += 1.25 * wk + 0.25; this.krx.v += (1.5 * wk + 0.25) * (0.85 + Math.random() * 0.3);
    this.kry.v += (Math.random() - 0.5) * 0.9 * wk; this.krz.v += (Math.random() - 0.5) * 1.5 * wk;

    // flash
    const s = (0.75 + Math.random() * 0.6) * (1 - 0.45 * a);
    this.flash.visible = true; this.flashT = 0.034;
    this.flashA.rotation.z = Math.random() * 6.28; this.flashA.scale.setScalar(s);
    this.flashB.scale.set(s, s, 0.7 + Math.random() * 0.7); this.flashC.scale.set(s, s, 0.7 + Math.random() * 0.7);
    this.flash.rotation.z = Math.random() * 6.28;
    this.flashLight.intensity = 3.2;
    this.heat = Math.min(6, this.heat + 0.5);
    this.onCasing && this.onCasing();
  }

  // Viewmodel-space point -> world space, corrected for the two cameras' different FOVs.
  toWorld(local, worldCam, out) {
    out.copy(local); this.gun.updateMatrixWorld(true); this.gun.localToWorld(out);
    const k = Math.tan(worldCam.fov * DEG / 2) / Math.tan(VM_FOV * DEG / 2);
    out.x *= k; out.y *= k;
    return worldCam.localToWorld(out);
  }
  muzzleWorld(cam, out) { return this.toWorld(MUZZLE, cam, out); }
  portWorld(cam, out) { return this.toWorld(PORT, cam, out); }
}
