// A match hosted in this tab, for when the page is served without its game server (a static
// host such as GitHub Pages). It is the same authoritative Game the Node server runs, ticking
// here and talking to the client through a stand-in for the WebSocket: JSON strings both ways,
// each delivered a turn later, so nothing on either side can tell the difference. Solo only.

import { Game } from '../server/game.js';
import { TICK_HZ } from '../shared/constants.js';

const later = (fn) => setTimeout(fn, 0);

export class LocalSocket {
  constructor() {
    this.readyState = 0;
    this.onopen = this.onclose = this.onerror = this.onmessage = null;
    const game = this.game = new Game();
    // the server's end of the connection
    this.player = game.addConnection({ readyState: 1, send: (s) => later(() => this.onmessage && this.onmessage({ data: s })) });
    setInterval(() => { try { game.tick(); } catch (err) { console.error('[solo] tick error:', err); } }, 1000 / TICK_HZ);
    later(() => { this.readyState = 1; this.onopen && this.onopen(); });
  }

  send(s) {
    const m = JSON.parse(s);
    later(() => { try { this.game.onMessage(this.player, m); } catch (err) { console.error('[solo] message error:', err); } });
  }
}
