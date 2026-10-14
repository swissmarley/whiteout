// WHITEOUT client entry point: owns the frame loop and wires the systems together.

import * as THREE from 'three';
import { World } from './world.js';
import { FX } from './fx.js';
import { Weapon } from './weapon.js';
import { Actors } from './actors.js';
import { Post } from './post.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { Sound } from './audio.js';
import { HUD, esc } from './hud.js';
import { Player } from './player.js';
import { SOLIDS, AMMO_POINTS, typeMat } from '../shared/map.js';
import { raycastWorld } from '../shared/collide.js';
import { AR, KNIFE, ENEMY, TYPE_NAMES, PLAYER } from '../shared/constants.js';
import { SEG_GROUP } from '../shared/rig.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const AUTO = params.has('auto');

const linkText = () => (net.solo ? 'Solo: no game server here, so the alley is yours alone' : 'Server link established');
function fatal(msg) { const f = $('fatal'); f.textContent = msg; f.classList.remove('hidden'); }
addEventListener('error', (e) => { console.error(e.error || e.message); });

// ------------------------------------------------------------------ settings
const store = { get(k, d) { try { const v = localStorage.getItem('whiteout.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('whiteout.' + k, JSON.stringify(v)); } catch {} } };
const settings = { sens: store.get('sens', 1), fov: store.get('fov', 74), vol: store.get('vol', 0.8), quality: params.get('q') || store.get('quality', 'high') };

// ------------------------------------------------------------------ systems
const canvas = $('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
} catch (err) { fatal('WHITEOUT needs WebGL2.\n\n' + err.message); throw err; }
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6)); renderer.setSize(innerWidth, innerHeight, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.06, 600);
camera.rotation.order = 'YXZ'; scene.add(camera);
const world = new World(scene, renderer, settings.quality);
const fx = new FX(scene, world, camera);
const weapon = new Weapon(scene.environment);
const actors = new Actors(scene, fx);
const post = new Post(renderer, scene, camera, weapon.scene, weapon.camera, settings.quality);
const input = new Input(canvas), net = new Net(), sound = new Sound(), hud = new HUD(), player = new Player();
input.forced = AUTO;

// weapon-mounted light
const torch = new THREE.SpotLight(0xdfe9ff, 0, 60, 0.4, 0.7, 1.3);
torch.position.set(0.1, -0.09, -0.1); camera.add(torch); camera.add(torch.target); torch.target.position.set(0.02, -0.03, -8);
const TORCH = 8;

// ------------------------------------------------------------------ state
let mode = 'menu', spawned = false, time = 0, last = performance.now(), lastSend = 0, fps = 60, breathT = 2, exertion = 0, respawnAt = 0, deathSub = '';
const names = new Map(); let roster = [];
const shake = { x: 0, y: 0, z: 0, r: 0, k: 0 };
const lightColor = new THREE.Color(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _end = new THREE.Vector3(), _n = new THREE.Vector3(), _muz = new THREE.Vector3(), _port = new THREE.Vector3(), _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const pendingKills = new Map(), _aim = { pitch: 0, yaw: 0 };
const stats = { shots: 0, predicted: 0, confirmed: 0, rejected: 0, late: 0 };

function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  weapon.camera.aspect = camera.aspect; weapon.camera.updateProjectionMatrix();
  post.resize();
  fx.setViewport(renderer.getDrawingBufferSize(new THREE.Vector2()).y, camera.fov);
}
addEventListener('resize', resize); resize();

// ------------------------------------------------------------------ player / weapon callbacks
player.onStep = (left, sprint, crouch) => {
  sound.step(sprint, crouch);
  if (player.pos.y < 0.05) { fx.footprint(player.pos.x, 0.004, player.pos.z, player.yaw, left); if (sprint) fx.snowPuff(player.pos.x, 0, player.pos.z, 3, 0.7); }
};
player.onLand = (impact) => { sound.land(impact); weapon.land.v -= Math.min(0.5, impact * 0.045); if (player.pos.y < 0.05) fx.snowPuff(player.pos.x, 0, player.pos.z, 7, 1); };
player.onJump = () => { sound.jump(); weapon.land.v += 0.18; };
player.onVault = () => { sound.vault(); };

weapon.onSound = (s) => (s === 'dry' ? sound.dry() : s === 'draw' || s === 'swing' ? sound.knife(s) : sound.reload(s));
weapon.onSmoke = () => { weapon.muzzleWorld(camera, _muz); camera.getWorldDirection(_d); fx.gunSmoke(_muz, _d); };
weapon.onCasing = () => {
  weapon.portWorld(camera, _port);
  _r.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1); camera.getWorldDirection(_f);
  _v.set(player.vel.x, player.vel.y, player.vel.z)
    .addScaledVector(_r, 2.1 + Math.random() * 1.2).addScaledVector(_u, 1.5 + Math.random() * 1.1).addScaledVector(_f, -0.5 - Math.random() * 0.7);
  fx.casing(_port, _v);
};
fx.onCasingBounce = (p, surf, power, n) => sound.casing(p, surf, power, n);

// The shot. Traced locally against exactly what is on screen this frame, shown instantly,
// then sent to the server with the interpolation state so it can verify the same picture.
weapon.onFire = (spreadDeg) => {
  camera.updateMatrixWorld();
  _o.setFromMatrixPosition(camera.matrixWorld);
  _r.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1); camera.getWorldDirection(_f);
  const rad = Math.sqrt(Math.random()) * Math.tan(spreadDeg * Math.PI / 180), ang = Math.random() * Math.PI * 2;
  _d.copy(_f).addScaledVector(_r, Math.cos(ang) * rad).addScaledVector(_u, Math.sin(ang) * rad).normalize();

  const wh = raycastWorld(SOLIDS, _o.x, _o.y, _o.z, _d.x, _d.y, _d.z, AR.range, true);
  const wallT = wh.t >= 0 ? wh.t : AR.range, wSolid = wh.solid, wnx = wh.nx, wny = wh.ny, wnz = wh.nz;
  const eh = actors.raycast(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, wallT);
  let hitId = 0, seg = -1;
  stats.shots++;
  if (eh) {
    hitId = eh.id; seg = eh.seg;
    _end.copy(_o).addScaledVector(_d, eh.t);
    const head = SEG_GROUP[seg] === 'head';
    fx.blood(_end, _d); sound.flesh(_end);
    hud.hit(head ? 'head' : 'hit'); sound.hitmarker(head ? 'head' : 'hit');
    stats.predicted++;
  } else if (wSolid) {
    _end.copy(_o).addScaledVector(_d, wallT); _n.set(wnx, wny, wnz);
    const mat = typeMat(wSolid, wny);
    fx.impact(_end, _n, mat, _d); sound.impact(_end, mat);
  } else _end.copy(_o).addScaledVector(_d, 160);

  const n = net.sendShot(_o, _d, hitId, seg);
  if (hitId) pendingKills.set(n, performance.now());
  weapon.muzzleWorld(camera, _muz);
  fx.tracer(_muz, _end); fx.localFlash(_muz);
  sound.shot();
  shake.k = Math.min(1, shake.k + 0.34 * (1 - weapon.adsT * 0.5));
};

// The knife. Judged like the shot - against what is on screen this frame, and again by the
// server from the same snapshots - but as a short, fat sweep straight down the aim line.
// Returns what the blade met: 0 nothing, 1 a body, 2 the world.
weapon.onMelee = () => {
  camera.updateMatrixWorld();
  _o.setFromMatrixPosition(camera.matrixWorld); camera.getWorldDirection(_d);
  const wh = raycastWorld(SOLIDS, _o.x, _o.y, _o.z, _d.x, _d.y, _d.z, KNIFE.range, false);
  const wallT = wh.t >= 0 ? wh.t : KNIFE.range, wSolid = wh.solid, wnx = wh.nx, wny = wh.ny, wnz = wh.nz;
  const eh = actors.raycast(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, wallT, KNIFE.radius);
  let hitId = 0, seg = -1, met = 0;
  if (eh) {
    hitId = eh.id; seg = eh.seg; met = 1;
    actors.touch(hitId, seg, _end.copy(_o).addScaledVector(_d, eh.t));
    fx.blood(_end, _d); sound.knife('hit', _end);
    hud.hit('hit'); sound.hitmarker('hit');
    stats.predicted++;
  } else if (wSolid) {
    met = 2;
    _end.copy(_o).addScaledVector(_d, wallT); _n.set(wnx, wny, wnz);
    const mat = typeMat(wSolid, wny);
    fx.impact(_end, _n, mat, _d, 0.4); sound.knife('clash', _end, mat);
  }
  const n = net.sendShot(_o, _d, hitId, seg, 'm');
  if (hitId) pendingKills.set(n, performance.now());
  shake.k = Math.min(1, shake.k + (met === 1 ? 0.5 : met ? 0.36 : 0.12));
  return met;
};

// ------------------------------------------------------------------ network events
function toMenu() {
  mode = 'menu'; spawned = false; respawnAt = 0;
  $('menu').classList.remove('hidden'); $('pause').classList.add('hidden');
  hud.show(false); hud.death(false); post.clearBlood(); actors.clearCorpses(); pendingKills.clear();
  input.unlock();
}

net.onStatus = (s) => {
  const st = $('menu-status');
  if (s === 'open') { st.textContent = linkText(); st.classList.remove('err'); $('deploy').disabled = false; if (AUTO) join(params.get('name') || 'Tester'); }
  else { st.textContent = 'Connection lost. Is the server running?  Reload to retry.'; st.classList.add('err'); $('deploy').disabled = true; if (mode !== 'menu') toMenu(); }
};

net.on('sp', (m) => {
  const first = !spawned;
  player.spawn(m.x, m.y, m.z, m.yaw); spawned = true; respawnAt = 0;
  weapon.reset(); post.clearBlood(); hud.death(false);
  if (first) hud.banner('HOLD THE ALLEY', 'THEY ARE COMING');
});

net.on('r', (m) => { roster = m.l; names.clear(); for (const r of m.l) names.set(r[0], r[1]); if (mode === 'menu') $('menu-status').textContent = net.solo ? linkText() : `${linkText()} · ${m.l.length} operator${m.l.length === 1 ? '' : 's'} deployed`; });

net.on('h', (m) => {
  const sent = pendingKills.get(m.n); pendingKills.delete(m.n);
  if (m.id) {
    stats.confirmed++;
    if (!sent) { stats.late++; hud.hit(SEG_GROUP[m.s] === 'head' ? 'head' : 'hit'); }
    if (m.k) { hud.hit('kill'); sound.hitmarker('kill'); }
  } else if (sent) stats.rejected++;
});

net.on('f', (m) => {             // another player fired
  const a = actors.players.get(m.id);
  _o.set(m.o[0], m.o[1], m.o[2]); _end.set(m.e[0], m.e[1], m.e[2]);
  if (a) _muz.set(a.rig.muzzle[0], a.rig.muzzle[1], a.rig.muzzle[2]); else _muz.copy(_o);
  fx.tracer(_muz, _end); fx.remoteFlash(_muz, 0.5); sound.shotFar(_muz);
  _d.copy(_end).sub(_o); const len = _d.length(); _d.divideScalar(len || 1);
  if (m.h) fx.blood(_end, _d); else worldImpact(_o, _d, len);
});

// size < 1: a knife point rather than a bullet
function worldImpact(o, d, len, size = 1) {
  const wh = raycastWorld(SOLIDS, o.x, o.y, o.z, d.x, d.y, d.z, len + 0.4, size === 1);
  if (wh.t < 0 || Math.abs(wh.t - len) > 0.5) return;
  const mat = typeMat(wh.solid, wh.ny);
  _n.set(wh.nx, wh.ny, wh.nz); _v.copy(o).addScaledVector(d, wh.t);
  fx.impact(_v, _n, mat, d, size);
  if (_v.distanceToSquared(camera.position) > 900) return;
  if (size === 1) sound.impact(_v, mat); else sound.knife('clash', _v, mat);
}

net.on('ef', (m) => {            // an enemy fired
  _o.set(m.o[0], m.o[1], m.o[2]); _end.set(m.e[0], m.e[1], m.e[2]);
  const a = actors.enemies.get(m.id);
  fx.tracer(_o, _end, 360); fx.remoteFlash(_o, a && a.kind === 'heavy' ? 0.8 : 0.55); sound.shotFar(_o, a && a.kind === 'heavy');
  _d.copy(_end).sub(_o); const len = _d.length(); _d.divideScalar(len || 1);
  if (m.v === net.id) return;
  if (m.v) { fx.blood(_end, _d); return; }
  worldImpact(_o, _d, len);
  // near miss: supersonic crack next to your ear
  const t = _v.copy(camera.position).sub(_o).dot(_d);
  if (t > 1 && t < len) { _v.copy(_o).addScaledVector(_d, t); if (_v.distanceToSquared(camera.position) < 2.6) { sound.whiz(_v); shake.k = Math.min(1, shake.k + 0.12); } }
});

net.on('k', (m) => {             // another player cut with the knife
  _o.set(m.o[0], m.o[1], m.o[2]); _end.set(m.e[0], m.e[1], m.e[2]);
  sound.knife('swing', _o);
  _d.copy(_end).sub(_o); const len = _d.length(); _d.divideScalar(len || 1);
  if (m.h) { actors.touch(m.h, m.s, _end); fx.blood(_end, _d); sound.knife('hit', _end); }
  else if (len < KNIFE.range - 0.01) worldImpact(_o, _d, len, 0.4);
});

net.on('em', (m) => { const a = actors.enemies.get(m.id); if (a) sound.melee(_v.set(a.state.x, a.state.y + 1.3, a.state.z)); });

net.on('ed', (m) => {
  const pos = actors.kill(m.id, m.dx, m.dz, !!m.hs, performance.now());
  const who = names.get(m.by) || 'Operator', label = ENEMY[TYPE_NAMES[m.ty]].label;
  hud.feed(`<b>${esc(who)}</b><em>${m.ml ? '†' : m.hs ? '⌖' : '▸'}</em>${label}`);
  if (m.by === net.id) hud.popup(m.ml ? `KNIFE · ${label}  +${m.sc}` : m.hs ? `HEADSHOT  +${m.sc}` : `${label}  +${m.sc}`, !!m.hs);
  if (pos) sound.flesh(pos);
});

net.on('d', (m) => {
  player.hp = m.hp;
  const dx = m.sx - player.pos.x, dz = m.sz - player.pos.z;
  const fwd = -Math.sin(player.yaw) * dx - Math.cos(player.yaw) * dz, right = Math.cos(player.yaw) * dx - Math.sin(player.yaw) * dz;
  const ang = Math.atan2(right, fwd);
  post.hit(m.dmg, ang); hud.damageFrom(ang); sound.hurt(m.dmg);
  shake.k = Math.min(1, shake.k + 0.5 + m.dmg * 0.015);
  weapon.krx.v += (Math.random() - 0.3) * 1.2; weapon.krz.v += (Math.random() - 0.5) * 2.4;
  if (m.hp <= 0 && player.alive) { player.alive = false; player.deadT = 0; }
});

net.on('pd', (m) => {
  const who = names.get(m.id) || 'Operator';
  hud.feed(`${m.by >= 0 ? ENEMY[TYPE_NAMES[m.by]].label : 'THE COLD'}<em>▸</em><b>${esc(who)}</b>`, true);
  if (m.id !== net.id) return;
  player.alive = false;
  respawnAt = m.wait ? performance.now() + m.wait * 1000 : 0;
  deathSub = m.wait ? '' : 'NO REINFORCEMENTS LEFT · HOLD FOR THE NEXT WAVE';
});

net.on('ev', (m) => {
  if (m.k === 'start') { actors.clearCorpses(); }
  else if (m.k === 'wave') { hud.banner(`WAVE ${m.n}`, 'CONTACT'); sound.ui('wave'); }
  else if (m.k === 'clear') { hud.banner('WAVE CLEARED', 'REINFORCEMENT GRANTED · +60 ROUNDS'); sound.ui('clear'); weapon.reserve = Math.min(AR.reserve, weapon.reserve + 60); }
  else if (m.k === 'over') { hud.banner('OVERRUN', `HELD UNTIL WAVE ${m.n} · ${m.kills} KILLS`); sound.ui('over'); deathSub = 'THE ALLEY IS LOST'; }
});

// ------------------------------------------------------------------ menu / pause
function join(name) {
  name = (name || '').trim() || 'Operator';
  store.set('name', name);
  sound.start(); sound.setVolume(settings.vol);
  if (!net.joined) net.join(name);
  mode = 'play';
  $('menu').classList.add('hidden'); hud.show(true);
  if (!AUTO) { input.lock(); setTimeout(() => { if (!input.locked && mode === 'play') input.onLockChange(false); }, 700); }
}
$('name').value = store.get('name', '');
$('deploy').disabled = true;
$('join').addEventListener('submit', (e) => { e.preventDefault(); if (net.open) join($('name').value); });
$('resume').addEventListener('click', () => { sound.ui('click'); input.lock(); });
// back to the title screen: the match goes on for everyone else, and DEPLOY rejoins it
$('quit').addEventListener('click', () => { sound.ui('click'); net.leave(); toMenu(); $('menu-status').textContent = linkText(); });
canvas.addEventListener('click', () => { if (mode === 'pause') input.lock(); });
input.onLockChange = (locked) => {
  if (mode === 'menu') return;
  mode = locked ? 'play' : 'pause';
  $('pause').classList.toggle('hidden', locked);
  $('pause-note').textContent = input.lockFailed ? 'Mouse capture was refused. Wait a second and press RESUME, or open the game in a regular browser tab.' : 'The fight carries on without you.';
};

const bind = (id, out, key, fmt, apply) => {
  const el = $(id), o = out && $(out);
  el.value = settings[key]; if (o) o.textContent = fmt(settings[key]);
  el.addEventListener('input', () => { settings[key] = el.type === 'range' ? Number(el.value) : el.value; store.set(key, settings[key]); if (o) o.textContent = fmt(settings[key]); apply && apply(settings[key]); });
};
bind('s-sens', 'o-sens', 'sens', (v) => v.toFixed(2));
bind('s-fov', 'o-fov', 'fov', (v) => v + '°');
bind('s-vol', 'o-vol', 'vol', (v) => Math.round(v * 100) + '%', (v) => sound.setVolume(v));
bind('s-quality', null, 'quality', String, (q) => { world.setQuality(q); post.build(q); resize(); });

net.connect();

// ------------------------------------------------------------------ frame
const idle = { f: 0, s: 0, jump: false, jumpHeld: false, crouch: false, sprint: false, ads: false, lookX: 0, lookY: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000)); last = now; time += dt;
  fps += (1 / dt - fps) * 0.05;

  net.sample();
  actors.sync(net, net.id, names, now);

  const playing = mode === 'play' && spawned, control = playing && input.active && player.alive;

  // --- player
  if (spawned) {
    const look = 0.0022 * settings.sens * (camera.fov / settings.fov);
    const ctl = control ? {
      f: (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0),
      s: (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0),
      jump: input.hit('Space'), jumpHeld: input.down('Space'), crouch: input.down('KeyC') || input.down('ControlLeft'),
      sprint: input.down('ShiftLeft') || input.down('ShiftRight'), ads: input.held(2), lookX: input.mx * look, lookY: input.my * look,
    } : idle;
    if (player.alive) player.update(dt, ctl);
    if (net.me && player.alive) player.hp = net.me[10];

    // aim with last frame's recoil, fire, then re-apply with the fresh kick for display
    shake.k = Math.max(0, shake.k - dt * 5.5);
    const sk = shake.k * shake.k;
    shake.x = (Math.random() - 0.5) * 0.012 * sk; shake.y = (Math.random() - 0.5) * 0.012 * sk; shake.z = 0; shake.r = (Math.random() - 0.5) * 0.02 * sk;
    player.applyCamera(camera, 0, weapon.recoil, shake);
    camera.updateMatrixWorld();

    if (control) {
      if (input.hit('KeyB')) { weapon.auto = !weapon.auto; sound.ui('click'); }
      if (input.hit('KeyT')) { weapon.lightOn = !weapon.lightOn; sound.ui('click'); }
    }
    world.sampleLight(camera.position, lightColor);
    weapon.update(dt, {
      fire: control && input.held(0), firePressed: control && input.click(0), ads: control && input.held(2), reload: control && input.hit('KeyR'),
      melee: control && (input.click(1) || input.hit('KeyV')), mx: control ? input.mx : 0, my: control ? input.my : 0, canFire: control,
    }, player, lightColor);
    _aim.pitch = weapon.recoil.pitch + weapon.view.pitch; _aim.yaw = weapon.recoil.yaw + weapon.view.yaw; shake.r += weapon.view.roll;
    player.applyCamera(camera, dt, _aim, shake);

    // interactions
    let prompt = null;
    if (control) {
      for (const a of AMMO_POINTS) {
        if (Math.hypot(a.x - player.pos.x, a.z - player.pos.z) < 1.9 && Math.abs(a.y - player.pos.y) < 1.4 && weapon.reserve < AR.reserve) {
          prompt = '<kbd>F</kbd>RESUPPLY';
          if (input.hit('KeyF') && weapon.resupply()) { sound.ui('ammo'); hud.popup('AMMUNITION RESTOCKED'); }
        }
      }
      if (!prompt && player.vaultHint && !player.vault) prompt = '<kbd>SPACE</kbd>VAULT';
    }
    hud.prompt(prompt);

    // breath in the cold: heavier after sprinting
    exertion = Math.max(0, Math.min(1, exertion + (player.sprinting ? dt * 0.25 : -dt * 0.12)));
    breathT -= dt;
    if (breathT <= 0 && player.alive) { breathT = 3.6 - exertion * 2.2; camera.getWorldDirection(_d); fx.breath(camera.position, _d); }

    if (playing && player.alive && now - lastSend >= 32) { lastSend = now; net.sendState(player, player.flags(weapon)); }
  } else {
    // attract mode: slow drift down the alley behind the menu
    camera.position.set(Math.sin(time * 0.05) * 2.2, 2.1 + Math.sin(time * 0.11) * 0.35, 15 + Math.cos(time * 0.07) * 4.5);
    camera.lookAt(0.6 + Math.sin(time * 0.04) * 1.5, 1.9, -8);
    world.sampleLight(camera.position, lightColor);
  }

  // --- camera fov (ADS zoom, sprint push)
  const fovT = settings.fov * (1 - 0.3 * weapon.adsT) + weapon.sprintT * 3.5 + weapon.view.fov;
  if (Math.abs(camera.fov - fovT) > 0.01) { camera.fov = fovT; camera.updateProjectionMatrix(); fx.setViewport(renderer.getDrawingBufferSize(_tmp2).y, camera.fov); }
  camera.updateMatrixWorld();

  // --- torch
  const torchOn = spawned && weapon.lightOn && player.alive;
  torch.intensity += ((torchOn ? TORCH : 0) - torch.intensity) * Math.min(1, dt * 18);
  const su = fx.snow.material.uniforms;
  su.uTorch.value = torch.intensity / TORCH; su.uTorchPos.value.copy(camera.position); camera.getWorldDirection(su.uTorchDir.value);

  actors.update(dt);
  world.update(dt, time);
  fx.update(dt, time, camera);
  sound.listener(camera);
  const hpK = spawned && player.alive ? 1 - Math.max(0, Math.min(1, (player.hp - 10) / 50)) : 0;
  sound.setDanger(spawned && !player.alive ? 0.85 : hpK, dt);

  // --- HUD
  if (mode !== 'menu') {
    hud.ammo(weapon.mag, weapon.reserve, weapon.auto, AR.mag);
    hud.health(player.alive ? player.hp : 0);
    hud.wave(net.wave[0], net.wave[1], net.wave[2], net.wave[3], net.wave[4]);
    hud.crosshair(weapon.spread, camera.fov, weapon.adsT > 0.5 || weapon.sprintT > 0.6 || !player.alive || !!player.vault);
    hud.scoreboard(input.down('Tab') || net.wave[1] === 3, roster, net.id);
    if (spawned && !player.alive) hud.death(true, net.wave[1] === 3 ? 'OVERRUN' : 'K.I.A.', respawnAt ? `REINFORCING IN ${Math.max(0, Math.ceil((respawnAt - now) / 1000))}` : deathSub);
    hud.net(`${Math.round(fps)} FPS &nbsp; ${Math.round(net.rtt)} MS<br>${actors.enemies.size} TRACKED &nbsp; HITREG ${stats.confirmed}/${stats.predicted}`);
    for (const [n, t] of pendingKills) if (now - t > 3000) pendingKills.delete(n);
  }

  post.showWeapon = spawned && mode !== 'menu';
  post.render(dt, { time, health: spawned && player.alive ? player.hp / PLAYER.maxHp : 1, dead: spawned && !player.alive ? Math.min(1, player.deadT / 1.2) : 0, ads: weapon.adsT });
  input.endFrame();
}
const _tmp2 = new THREE.Vector2();

// debugging / automated-test handle
window.__game = { THREE, renderer, scene, camera, world, fx, weapon, actors, post, input, net, sound, hud, player, settings, stats, get mode() { return mode; } };

requestAnimationFrame(frame);
