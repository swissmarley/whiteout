// Transient effects: snowfall, particles, tracers, decals, brass, steam, fire.

import * as THREE from 'three';
import * as T from './textures.js';
import { SOLIDS, STEAM, FIRE } from '../shared/map.js';
import { raycastWorld, supportY } from '../shared/collide.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _c = new THREE.Color();
const Z = new THREE.Vector3(0, 0, 1), ONE = new THREE.Vector3(1, 1, 1);

// CPU-simulated soft point sprites.
class Puffs {
  constructor(scene, max, additive, fog) {
    this.max = max; this.n = 0;
    this.d = new Float32Array(max * 17);    // x y z vx vy vz life maxLife s0 s1 r g b a drag grav fadeIn
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 }, uFog: { value: new THREE.Color(fog) }, uFogD: { value: 0.017 }, uAdd: { value: additive ? 1 : 0 } },
      vertexShader: `
        attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC; varying float vZ;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; vC = aColor;
          gl_PointSize = min(700.0, aSize * uScale / max(0.05, -mv.z)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform vec3 uFog; uniform float uFogD, uAdd; varying vec4 vC; varying float vZ;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a;
          float f = 1.0 - exp(-uFogD * uFogD * vZ * vZ); float near = smoothstep(0.08, 0.5, vZ);
          vec3 c = mix(vC.rgb, uFog, f * (1.0 - uAdd)); gl_FragColor = vec4(c, vC.a * a * near * (1.0 - f * uAdd)); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = additive ? 8 : 7;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag = 1, grav = 0, fadeIn = 0.12) {
    let i = this.n;
    if (i >= this.max) i = (Math.random() * this.max) | 0; else this.n++;
    const d = this.d, k = i * 17;
    d[k] = x; d[k + 1] = y; d[k + 2] = z; d[k + 3] = vx; d[k + 4] = vy; d[k + 5] = vz; d[k + 6] = life; d[k + 7] = life;
    d[k + 8] = s0; d[k + 9] = s1; d[k + 10] = r; d[k + 11] = g; d[k + 12] = b; d[k + 13] = a; d[k + 14] = drag; d[k + 15] = grav; d[k + 16] = fadeIn;
  }

  update(dt) {
    const d = this.d;
    for (let i = 0; i < this.n; i++) {
      let k = i * 17;
      d[k + 6] -= dt;
      if (d[k + 6] <= 0) {                          // swap-remove
        const last = (--this.n) * 17;
        if (last !== k) for (let j = 0; j < 17; j++) d[k + j] = d[last + j];
        i--; continue;
      }
      const dr = Math.exp(-d[k + 14] * dt);
      d[k + 3] *= dr; d[k + 4] = d[k + 4] * dr - d[k + 15] * dt; d[k + 5] *= dr;
      d[k] += d[k + 3] * dt; d[k + 1] += d[k + 4] * dt; d[k + 2] += d[k + 5] * dt;
      if (d[k + 15] > 0 && d[k + 1] < 0.02) { d[k + 1] = 0.02; d[k + 3] = d[k + 5] = 0; d[k + 4] = 0; }
      const t = 1 - d[k + 6] / d[k + 7];
      this.pos[i * 3] = d[k]; this.pos[i * 3 + 1] = d[k + 1]; this.pos[i * 3 + 2] = d[k + 2];
      this.size[i] = d[k + 8] + (d[k + 9] - d[k + 8]) * t;
      const fade = Math.min(1, t / d[k + 16]) * (1 - t) * (1 - t * 0.3);
      this.col[i * 4] = d[k + 10]; this.col[i * 4 + 1] = d[k + 11]; this.col[i * 4 + 2] = d[k + 12]; this.col[i * 4 + 3] = d[k + 13] * fade;
    }
    const g = this.geo;
    g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = g.attributes.aColor.needsUpdate = g.attributes.aSize.needsUpdate = true;
  }
}

class Decals {
  constructor(scene, map, max, opts = {}) {
    this.max = max; this.i = 0;
    const mat = new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, ...opts });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  add(p, n, sx, sy = sx, roll = Math.random() * 6.283) {
    _q.setFromUnitVectors(Z, n); _q2.setFromAxisAngle(Z, roll); _q.multiply(_q2);
    _m.compose(_v.copy(p).addScaledVector(n, 0.006 + (this.i % 7) * 0.0006), _q, _v2.set(sx, sy, 1));
    this.mesh.setMatrixAt(this.i % this.max, _m);
    this.i++; this.mesh.count = Math.min(this.i, this.max);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class FX {
  constructor(scene, world, camera) {
    this.scene = scene; this.world = world; this.camera = camera;
    const fog = scene.fog.color.getHex();
    this.smoke = new Puffs(scene, 1400, false, fog);
    this.glow = new Puffs(scene, 900, true, fog);
    this.holes = new Decals(scene, T.holeTex(), 220);
    this.snowHoles = new Decals(scene, T.snowHoleTex(), 160);
    this.bloodA = new Decals(scene, T.bloodTex(71), 70, { color: 0xffffff });
    this.bloodB = new Decals(scene, T.bloodTex(133), 70);
    this.prints = new Decals(scene, T.footprintTex(), 120);
    this.buildSnow(); this.buildTracers(); this.buildCasings(); this.buildFlashes();
    this.steamAcc = STEAM.map(() => 0); this.fireAcc = 0; this.emberAcc = 0;
    this.onCasingBounce = null;
    this.tmpColor = new THREE.Color();
  }

  setViewport(heightPx, fovDeg) {
    const s = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.smoke.mat.uniforms.uScale.value = s; this.glow.mat.uniforms.uScale.value = s; this.snow.material.uniforms.uScale.value = s;
  }

  lit(x, y, z, k = 1) { const c = this.world.sampleLight(_v.set(x, y, z), this.tmpColor); c.multiplyScalar(k); return c; }

  // ---------------------------------------------------------------- snowfall
  buildSnow() {
    const N = 11000, seeds = new Float32Array(N * 3), pos = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) seeds[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    const lamps = this.world.lamps;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(38, 24, 38) }, uScale: { value: 600 },
        uLampPos: { value: lamps.map((l) => l.pos) }, uLampK: { value: lamps.map(() => 1) },
        uFire: { value: new THREE.Vector3(FIRE.x, FIRE.y + 0.5, FIRE.z) }, uFlash: { value: new THREE.Vector4(0, 0, 0, 0) },
        uTorchPos: { value: new THREE.Vector3() }, uTorchDir: { value: new THREE.Vector3(0, 0, -1) }, uTorch: { value: 0 },
      },
      vertexShader: `
        #define NL ${lamps.length}
        attribute vec3 aSeed; uniform float uTime, uScale, uTorch; uniform vec3 uCam, uBox, uFire, uTorchPos, uTorchDir; uniform vec4 uFlash;
        uniform vec3 uLampPos[NL]; uniform float uLampK[NL];
        varying vec3 vCol; varying float vA;
        void main(){
          vec3 p = aSeed * uBox;
          float sp = 1.15 + aSeed.z * 1.0;
          p.y -= uTime * sp;
          p.x += uTime * 0.55 + sin(uTime * 0.7 + aSeed.y * 40.0) * 0.3;
          p.z += uTime * 0.22 + cos(uTime * 0.55 + aSeed.x * 40.0) * 0.3;
          vec3 wp = uCam + mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 light = vec3(0.34, 0.38, 0.50);
          for (int i = 0; i < NL; i++) {
            vec3 L = wp - uLampPos[i]; float d2 = dot(L, L);
            float cone = smoothstep(0.42, 0.78, -L.y / sqrt(d2 + 0.0001));
            light += vec3(1.0, 0.64, 0.32) * cone * uLampK[i] * 26.0 / (d2 + 2.5);
          }
          vec3 F = wp - uFire; light += vec3(1.0, 0.42, 0.12) * 3.0 / (dot(F, F) + 1.0);
          vec3 M = wp - uFlash.xyz; light += vec3(1.0, 0.8, 0.5) * uFlash.w * 9.0 / (dot(M, M) + 1.0);
          vec3 Tv = wp - uTorchPos; float td = length(Tv);
          light += vec3(0.85, 0.92, 1.0) * uTorch * smoothstep(0.94, 0.99, dot(Tv / td, uTorchDir)) * smoothstep(1.0, 4.0, td) * 22.0 / (td * td + 30.0);
          vCol = light;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          float dist = -mv.z;
          vA = smoothstep(0.5, 2.4, dist) * (1.0 - smoothstep(14.0, 19.0, length(wp - uCam))) * (0.55 + aSeed.x * 0.45);
          gl_PointSize = clamp((0.022 + aSeed.y * 0.024) * uScale / max(0.1, dist), 1.0, 13.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vCol; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.25, d);
          gl_FragColor = vec4(vCol, a * vA); }`,
    });
    this.snow = new THREE.Points(g, mat);
    this.snow.frustumCulled = false; this.snow.renderOrder = 6;
    this.scene.add(this.snow);
  }

  // ---------------------------------------------------------------- tracers
  buildTracers() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(7, 4.2, 1.6) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying vec2 vUv; void main(){ float w = 1.0 - abs(vUv.y - 0.5) * 2.0; float a = w * w * smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.96, vUv.x); gl_FragColor = vec4(uColor * a, 1.0); }',
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    this.tracers = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; m.visible = false; m.frustumCulled = false; m.renderOrder = 9;
      this.scene.add(m);
      this.tracers.push({ mesh: m, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 0, t: 0, active: false });
    }
    this.tracerI = 0;
  }

  tracer(from, to, speed = 420) {
    const tr = this.tracers[this.tracerI++ % this.tracers.length];
    tr.from.copy(from); tr.dir.copy(to).sub(from); tr.len = tr.dir.length();
    if (tr.len < 1.5) return;
    tr.dir.divideScalar(tr.len); tr.t = 0.6; tr.speed = speed; tr.active = true;
  }

  // ---------------------------------------------------------------- brass
  buildCasings() {
    const N = 56;
    const geo = new THREE.CylinderGeometry(0.0085, 0.0085, 0.062, 8); geo.rotateX(Math.PI / 2);
    this.casingMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xe0a83e, metalness: 1, roughness: 0.26, envMapIntensity: 2.4 }), N);
    this.casingMesh.frustumCulled = false; this.casingMesh.castShadow = true;
    this.scene.add(this.casingMesh);
    this.casings = [];
    for (let i = 0; i < N; i++) {
      this.casings.push({ p: new THREE.Vector3(0, -50, 0), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), life: 0, rest: true, bounces: 0 });
      this.casingMesh.setMatrixAt(i, _m.makeTranslation(0, -50, 0));
    }
    this.casingI = 0;
  }

  casing(pos, vel) {
    const c = this.casings[this.casingI++ % this.casings.length];
    c.p.copy(pos); c.v.copy(vel); c.life = 9; c.rest = false; c.bounces = 0;
    c.q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random()).normalize();
    c.w.set(rnd(-28, 28), rnd(-28, 28), rnd(-28, 28));
  }

  surfaceAt(x, z, y) {
    if (y > 0.05) return 'hard';
    return Math.abs(x) < 1.25 || Math.abs(z) < 1.25 ? 'hard' : 'snow';
  }

  // ---------------------------------------------------------------- muzzle flashes of other shooters
  buildFlashes() {
    const tex = T.flashTex();
    this.flashes = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(5, 3.6, 2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false; s.renderOrder = 9; this.scene.add(s);
      this.flashes.push({ s, t: 0 });
    }
    this.flashLights = [];
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xffb870, 0, 13, 2); this.scene.add(l); this.flashLights.push({ l, t: 0 }); }
    this.flashI = 0;
    this.muzzleLight = new THREE.PointLight(0xffc27a, 0, 17, 2);
    this.scene.add(this.muzzleLight);
    this.muzzleT = 0;
  }

  remoteFlash(pos, size = 0.55) {
    const f = this.flashes[this.flashI % this.flashes.length];
    f.s.position.copy(pos); f.s.scale.setScalar(size * rnd(0.8, 1.25)); f.s.material.rotation = Math.random() * 6.28; f.s.visible = true; f.t = 0.05;
    const fl = this.flashLights[this.flashI % this.flashLights.length];
    fl.l.position.copy(pos); fl.l.intensity = 34; fl.t = 0.06;
    this.flashI++;
  }

  localFlash(pos) {
    this.muzzleLight.position.copy(pos); this.muzzleLight.intensity = 70; this.muzzleT = 0.055;
    this.snow.material.uniforms.uFlash.value.set(pos.x, pos.y, pos.z, 1);
  }

  // ---------------------------------------------------------------- impacts
  // `size` scales the mark left behind (a knife point chips where a bullet craters)
  impact(p, n, mat, dir, size = 1) {
    const S = this.smoke, G = this.glow;
    if (mat === 'snow') {
      const c = this.lit(p.x, p.y + 0.2, p.z, 0.9);
      for (let i = 0; i < 11; i++) S.spawn(p.x, p.y, p.z, n.x * rnd(0.6, 2.8) + rnd(-0.9, 0.9), n.y * rnd(0.8, 3.2) + rnd(0, 0.9), n.z * rnd(0.6, 2.8) + rnd(-0.9, 0.9), rnd(0.35, 0.8), 0.06, rnd(0.25, 0.55), c.r, c.g, c.b, 0.5, 2.6, 3.5, 0.05);
      this.snowHoles.add(p, n, rnd(0.11, 0.17) * size);
      return;
    }
    if (mat === 'flesh') return;
    const metal = mat === 'metal' || mat === 'glass';
    if (metal) {
      for (let i = 0; i < 9; i++) G.spawn(p.x, p.y, p.z, n.x * rnd(2, 7) + rnd(-3, 3), n.y * rnd(2, 7) + rnd(-1, 4), n.z * rnd(2, 7) + rnd(-3, 3), rnd(0.12, 0.35), 0.035, 0.012, 6, 3.6, 1.2, 1, 1.5, 12, 0.02);
      G.spawn(p.x + n.x * 0.03, p.y + n.y * 0.03, p.z + n.z * 0.03, 0, 0, 0, 0.06, 0.4, 0.15, 5, 3.5, 2, 0.9, 0, 0, 0.02);
    }
    const tint = mat === 'brick' ? [0.62, 0.42, 0.34] : mat === 'wood' ? [0.6, 0.48, 0.34] : [0.56, 0.56, 0.58];
    const c = this.lit(p.x + n.x * 0.2, p.y + n.y * 0.2, p.z + n.z * 0.2, 0.8);
    for (let i = 0; i < (metal ? 3 : 8); i++) S.spawn(p.x, p.y, p.z, n.x * rnd(0.4, 2.2) + rnd(-0.5, 0.5), n.y * rnd(0.4, 2.2) + rnd(-0.2, 0.7), n.z * rnd(0.4, 2.2) + rnd(-0.5, 0.5), rnd(0.4, 1.0), 0.05, rnd(0.3, 0.7), c.r * tint[0], c.g * tint[1], c.b * tint[2], 0.42, 3.2, -0.25, 0.05);
    if (!metal) for (let i = 0; i < 6; i++) S.spawn(p.x, p.y, p.z, n.x * rnd(1, 4) + rnd(-1.5, 1.5), n.y * rnd(1, 4) + rnd(-0.5, 2.5), n.z * rnd(1, 4) + rnd(-1.5, 1.5), rnd(0.4, 0.8), 0.028, 0.02, c.r * tint[0] * 0.6, c.g * tint[1] * 0.6, c.b * tint[2] * 0.6, 1, 0.6, 12, 0.02);
    this.holes.add(p, n, (mat === 'metal' ? rnd(0.05, 0.07) : rnd(0.09, 0.14)) * size);
  }

  blood(p, dir) {
    const S = this.smoke, c = this.lit(p.x, p.y, p.z, 1);
    const lr = Math.min(1.4, 0.35 + c.r * 0.6);
    for (let i = 0; i < 12; i++) S.spawn(p.x, p.y, p.z, dir.x * rnd(0.3, 3.2) + rnd(-0.9, 0.9), dir.y * rnd(0.3, 3) + rnd(-0.4, 1.1), dir.z * rnd(0.3, 3.2) + rnd(-0.9, 0.9), rnd(0.22, 0.5), 0.05, rnd(0.2, 0.42), 0.42 * lr, 0.012 * lr, 0.012 * lr, 0.7, 4, 2.5, 0.04);
    for (let i = 0; i < 9; i++) S.spawn(p.x, p.y, p.z, dir.x * rnd(1.5, 6) + rnd(-1.5, 1.5), dir.y * rnd(1, 5) + rnd(0, 2.4), dir.z * rnd(1.5, 6) + rnd(-1.5, 1.5), rnd(0.4, 0.9), 0.03, 0.02, 0.36 * lr, 0.008, 0.008, 1, 0.5, 13, 0.02);
    // exit spray onto whatever is behind the target, plus a spatter on the ground
    const h = raycastWorld(SOLIDS, p.x, p.y, p.z, dir.x, dir.y, dir.z, 3.4, false);
    if (h.t > 0.25) {
      _v2.set(h.nx, h.ny, h.nz);
      (Math.random() < 0.5 ? this.bloodA : this.bloodB).add(_v.set(p.x + dir.x * h.t, p.y + dir.y * h.t, p.z + dir.z * h.t).clone(), _v2.clone(), rnd(0.45, 1.0));
    }
    if (Math.random() < 0.7) {
      const gx = p.x + dir.x * rnd(0.3, 1.2) + rnd(-0.3, 0.3), gz = p.z + dir.z * rnd(0.3, 1.2) + rnd(-0.3, 0.3);
      const gy = supportY(SOLIDS, gx, gz, 0.05, p.y);
      (Math.random() < 0.5 ? this.bloodA : this.bloodB).add(new THREE.Vector3(gx, gy, gz), new THREE.Vector3(0, 1, 0), rnd(0.35, 0.8));
    }
  }

  bloodPool(x, y, z) {
    for (let i = 0; i < 3; i++) (i % 2 ? this.bloodA : this.bloodB).add(new THREE.Vector3(x + rnd(-0.25, 0.25), y, z + rnd(-0.25, 0.25)), new THREE.Vector3(0, 1, 0), rnd(0.7, 1.25));
  }

  footprint(x, y, z, yaw, left) {
    const s = left ? -0.11 : 0.11;
    _v.set(x + Math.cos(yaw) * s, y, z - Math.sin(yaw) * s);
    this.prints.add(_v.clone(), new THREE.Vector3(0, 1, 0), 0.13, 0.3, yaw);
  }

  snowPuff(x, y, z, n = 5, power = 1) {
    const c = this.lit(x, y + 0.2, z, 0.85);
    for (let i = 0; i < n; i++) this.smoke.spawn(x + rnd(-0.1, 0.1), y + 0.03, z + rnd(-0.1, 0.1), rnd(-0.7, 0.7) * power, rnd(0.3, 1.3) * power, rnd(-0.7, 0.7) * power, rnd(0.3, 0.6), 0.05, rnd(0.2, 0.42), c.r, c.g, c.b, 0.34, 3, 3, 0.05);
  }

  breath(p, d) {
    const c = this.lit(p.x, p.y, p.z, 0.9);
    for (let i = 0; i < 5; i++) this.smoke.spawn(p.x + d.x * 0.22, p.y - 0.1, p.z + d.z * 0.22, d.x * rnd(0.3, 0.8) + rnd(-0.1, 0.1), rnd(0.02, 0.2), d.z * rnd(0.3, 0.8) + rnd(-0.1, 0.1), rnd(0.8, 1.5), 0.05, rnd(0.3, 0.6), c.r, c.g, c.b, 0.085, 1.6, -0.1, 0.2);
  }

  gunSmoke(p, d) {
    const c = this.lit(p.x, p.y, p.z, 0.9);
    this.smoke.spawn(p.x, p.y, p.z, d.x * rnd(0.3, 1.2) + rnd(-0.15, 0.15), rnd(0.15, 0.5), d.z * rnd(0.3, 1.2) + rnd(-0.15, 0.15), rnd(0.5, 1.1), 0.03, rnd(0.22, 0.45), c.r, c.g, c.b, 0.13, 2.4, -0.3, 0.1);
  }

  // ---------------------------------------------------------------- per-frame
  update(dt, t, cam) {
    const cp = cam.position;
    // snow
    const su = this.snow.material.uniforms;
    su.uTime.value = t; su.uCam.value.copy(cp);
    const lamps = this.world.lamps; for (let i = 0; i < lamps.length; i++) su.uLampK.value[i] = lamps[i].k;
    su.uFlash.value.w = Math.max(0, su.uFlash.value.w - dt * 16);

    // steam
    for (let i = 0; i < STEAM.length; i++) {
      const s = STEAM[i];
      if (Math.abs(s.x - cp.x) + Math.abs(s.z - cp.z) > 55) continue;
      this.steamAcc[i] += s.rate * dt;
      while (this.steamAcc[i] >= 1) {
        this.steamAcc[i] -= 1;
        const c = this.lit(s.x, s.y + 1.2, s.z, 0.75);
        this.smoke.spawn(s.x + rnd(-0.2, 0.2), s.y, s.z + rnd(-0.2, 0.2), (s.vx || 0) + rnd(-0.12, 0.3), s.rise * rnd(0.7, 1.2), (s.vz || 0) + rnd(-0.12, 0.2), rnd(2.4, 4), 0.25 * s.size, 2.4 * s.size, c.r, c.g, c.b, 0.1, 0.35, -0.05, 0.25);
      }
    }
    // barrel fire
    this.fireAcc += dt * 46;
    while (this.fireAcc >= 1) { this.fireAcc -= 1; this.glow.spawn(FIRE.x + rnd(-0.14, 0.14), FIRE.y - 0.05, FIRE.z + rnd(-0.14, 0.14), rnd(-0.15, 0.15), rnd(0.9, 2.2), rnd(-0.15, 0.15), rnd(0.28, 0.6), rnd(0.28, 0.42), 0.05, 3.2, rnd(0.9, 1.5), 0.25, 0.5, 0.6, -0.6, 0.15); }
    this.emberAcc += dt * 7;
    while (this.emberAcc >= 1) {
      this.emberAcc -= 1;
      this.glow.spawn(FIRE.x + rnd(-0.1, 0.1), FIRE.y + 0.2, FIRE.z + rnd(-0.1, 0.1), rnd(-0.5, 0.9), rnd(1.2, 3), rnd(-0.5, 0.6), rnd(0.8, 2), 0.03, 0.012, 6, 2.4, 0.5, 1, 0.5, -0.4, 0.05);
      this.smoke.spawn(FIRE.x, FIRE.y + 0.5, FIRE.z, rnd(0.1, 0.5), rnd(0.9, 1.5), rnd(-0.1, 0.25), rnd(2, 3.4), 0.3, 1.5, 0.09, 0.08, 0.08, 0.16, 0.3, -0.05, 0.2);
    }
    this.smoke.update(dt); this.glow.update(dt);

    // tracers
    for (const tr of this.tracers) {
      if (!tr.active) continue;
      tr.t += tr.speed * dt;
      const head = Math.min(tr.t, tr.len), tail = Math.max(0, tr.t - Math.min(9, tr.len * 0.45));
      if (tail >= tr.len) { tr.active = false; tr.mesh.visible = false; continue; }
      const L = head - tail, mid = (head + tail) / 2;
      _v.copy(tr.from).addScaledVector(tr.dir, mid);
      const dist = _v.distanceTo(cp), w = 0.018 + dist * 0.0022;
      _v2.copy(cp).sub(_v).cross(tr.dir).normalize();
      const up = _v2, dir = tr.dir, nx = dir.y * up.z - dir.z * up.y, ny = dir.z * up.x - dir.x * up.z, nz = dir.x * up.y - dir.y * up.x;
      tr.mesh.matrix.set(dir.x * L, up.x * w, nx, _v.x, dir.y * L, up.y * w, ny, _v.y, dir.z * L, up.z * w, nz, _v.z, 0, 0, 0, 1);
      tr.mesh.visible = true;
    }

    // flashes
    for (const f of this.flashes) if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.s.visible = false; }
    for (const f of this.flashLights) if (f.t > 0) { f.t -= dt; f.l.intensity = f.t > 0 ? 34 * (f.t / 0.06) : 0; }
    if (this.muzzleT > 0) { this.muzzleT -= dt; this.muzzleLight.intensity = this.muzzleT > 0 ? 70 * (this.muzzleT / 0.055) : 0; }

    // brass
    let dirty = false;
    for (let i = 0; i < this.casings.length; i++) {
      const c = this.casings[i];
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) { this.casingMesh.setMatrixAt(i, _m.makeTranslation(0, -50, 0)); dirty = true; continue; }
      if (c.rest) continue;
      dirty = true;
      c.v.y -= 15 * dt;
      const py = c.p.y;
      c.p.addScaledVector(c.v, dt);
      const ang = c.w.length() * dt;
      if (ang > 1e-5) { _q.setFromAxisAngle(_v.copy(c.w).normalize(), ang); c.q.premultiply(_q); }
      const gy = supportY(SOLIDS, c.p.x, c.p.z, 0.01, py + 0.03) + 0.011;
      if (c.p.y < gy && c.v.y < 0) {
        c.p.y = gy;
        const surf = this.surfaceAt(c.p.x, c.p.z, gy), impact = -c.v.y;
        if (surf === 'snow') { c.v.set(c.v.x * 0.2, 0, c.v.z * 0.2); c.w.multiplyScalar(0.15); if (c.bounces === 0) this.snowPuff(c.p.x, gy, c.p.z, 2, 0.4); c.rest = true; }
        else { c.v.y = impact * 0.36; c.v.x *= 0.62; c.v.z *= 0.62; c.w.multiplyScalar(0.6).add(_v.set(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6))); if (impact < 0.7) { c.rest = true; c.v.set(0, 0, 0); } }
        if (this.onCasingBounce && impact > 0.6) this.onCasingBounce(c.p, surf, Math.min(1, impact / 4), c.bounces);
        c.bounces++;
        if (c.rest) { _q.setFromAxisAngle(_v.set(0, 1, 0), Math.random() * 6.28); c.q.copy(_q); }   // lie flat
      }
      this.casingMesh.setMatrixAt(i, _m.compose(c.p, c.q, ONE));
    }
    if (dirty) this.casingMesh.instanceMatrix.needsUpdate = true;
  }
}
