// DOM heads-up display. Everything here is cheap text / transform updates.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class HUD {
  constructor() {
    this.el = { hud: $('hud'), cross: $('crosshair'), hm: $('hitmarker'), dirs: $('dmg-dirs'), waveNum: $('wave-num'), waveLabel: $('wave-label'), waveSub: $('wave-sub'),
      feed: $('feed'), popups: $('popups'), banner: $('banner'), bannerMain: $('banner-main'), bannerSub: $('banner-sub'), prompt: $('prompt'),
      vitals: $('vitals'), hpNum: $('hp-num'), hpFill: $('hp-fill'), lives: $('lives'), ammo: $('ammo'), mag: $('ammo-mag'), res: $('ammo-res'), mode: $('fire-mode'),
      net: $('net-stat'), board: $('scoreboard'), rows: $('score-rows'), death: $('death'), deathSub: $('death-sub'), deathMain: $('death-main') };
    this.cache = {};
  }

  set(key, node, value, prop = 'textContent') { if (this.cache[key] !== value) { this.cache[key] = value; node[prop] = value; } }
  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  ammo(mag, reserve, auto, max) {
    this.set('mag', this.el.mag, mag); this.set('res', this.el.res, '/ ' + reserve); this.set('mode', this.el.mode, auto ? 'AUTO' : 'SEMI');
    this.set('ammoCls', this.el.ammo, mag === 0 ? 'empty' : mag <= max * 0.27 ? 'low' : '', 'className');
  }

  health(hp) {
    this.set('hp', this.el.hpNum, Math.ceil(hp));
    this.set('hpw', this.el.hpFill.style, Math.max(0, hp) + '%', 'width');
    this.set('hpc', this.el.vitals, hp <= 35 ? 'low' : '', 'className');
  }

  wave(n, phase, left, tickets, ms) {
    this.set('wn', this.el.waveNum, phase === 1 ? n + 1 : Math.max(1, n));
    this.set('wl', this.el.waveLabel, phase === 1 ? 'NEXT WAVE' : phase === 3 ? 'OVERRUN' : 'WAVE');
    this.set('ws', this.el.waveSub, phase === 1 ? `INBOUND IN ${Math.ceil(ms / 1000)}` : phase === 2 ? `${left} HOSTILE${left === 1 ? '' : 'S'} REMAINING` : phase === 3 ? `RESTART IN ${Math.ceil(ms / 1000)}` : '');
    this.set('lv', this.el.lives, `REINFORCEMENTS ${'▮'.repeat(Math.max(0, tickets))}${'▯'.repeat(Math.max(0, 5 - tickets))}`);
  }

  crosshair(spreadDeg, fovDeg, hidden) {
    const gap = Math.tan(spreadDeg * Math.PI / 180) / Math.tan(fovDeg * Math.PI / 360) * (innerHeight / 2) + 3;
    this.el.cross.style.setProperty('--gap', gap.toFixed(1) + 'px');
    this.set('ch', this.el.cross.style, hidden ? '0' : '1', 'opacity');
  }

  hit(kind) {
    const h = this.el.hm;
    h.className = '';
    void h.offsetWidth;                         // restart the CSS animation
    h.className = kind === 'kill' ? 'kill' : kind === 'head' ? 'hit head' : 'hit';
  }

  damageFrom(angle) {
    const d = document.createElement('div');
    d.className = 'dmg-arc'; d.style.transform = `rotate(${angle}rad)`;
    this.el.dirs.appendChild(d);
    setTimeout(() => d.remove(), 1700);
  }

  feed(html, bad = false) {
    const d = document.createElement('div');
    d.className = 'feed-row' + (bad ? ' bad' : ''); d.innerHTML = html;
    this.el.feed.appendChild(d);
    while (this.el.feed.children.length > 6) this.el.feed.firstChild.remove();
    setTimeout(() => d.remove(), 5000);
  }

  popup(text, hs = false) {
    const d = document.createElement('div');
    d.className = 'popup' + (hs ? ' hs' : ''); d.textContent = text;
    this.el.popups.appendChild(d);
    while (this.el.popups.children.length > 4) this.el.popups.firstChild.remove();
    setTimeout(() => d.remove(), 1500);
  }

  banner(main, sub = '') {
    const b = this.el.banner;
    this.el.bannerMain.textContent = main; this.el.bannerSub.textContent = sub;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  prompt(html) {
    if (this.cache.prompt === html) return;
    this.cache.prompt = html;
    if (html) this.el.prompt.innerHTML = html;
    this.el.prompt.classList.toggle('show', !!html);
  }

  scoreboard(show, roster, myId) {
    this.el.board.classList.toggle('hidden', !show);
    if (!show) return;
    const key = JSON.stringify(roster);
    if (this.cache.board === key) return;
    this.cache.board = key;
    this.el.rows.innerHTML = [...roster].sort((a, b) => b[4] - a[4]).map((r) =>
      `<tr class="${r[0] === myId ? 'me' : ''}${r[6] ? '' : ' dead'}"><td>${esc(r[1])}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td></tr>`).join('');
  }

  death(show, main = 'K.I.A.', sub = '') {
    this.el.death.classList.toggle('hidden', !show);
    if (show) { this.set('dm', this.el.deathMain, main); this.set('ds', this.el.deathSub, sub); }
  }

  net(text) { this.set('net', this.el.net, text, 'innerHTML'); }
}

export { esc };
