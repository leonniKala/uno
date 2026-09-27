#!/usr/bin/env node
'use strict';
/*
 * Robot players, for trying the game (and the TV screen) without people.
 *
 *   node tools/bot.js --code 1234 --join 3            3 new robots join game 1234
 *   node tools/bot.js --code 1234 --token <token>     a robot takes over an existing player
 *   options: --url http://localhost:3001  --delay 1200 (ms between moves)
 *
 * After the robots have joined, start the game from /admin as usual.
 */
const { io } = require('socket.io-client');
const R = require('../public/js/uno-rules.js');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const URL = args.url || 'http://localhost:3001';
const CODE = args.code;
const DELAY = Number(args.delay || 1200);
if (!CODE || (!args.join && !args.token)) {
  console.log('Usage: node tools/bot.js --code 1234 (--join 3 | --token <token>) [--url ...] [--delay 1200]');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function favouriteColour(hand) {
  const n = Object.fromEntries(R.COLORS.map((c) => [c, 0]));
  for (const c of hand) if (c.color !== 'wild') n[c.color]++;
  return R.COLORS.slice().sort((a, b) => n[b] - n[a])[0];
}

function decide(v) {
  const g = v.game, me = v.me, id = v.myId;
  if (g.phase === 'roundOver') return { type: 'nextRound', slow: true };
  if (g.phase !== 'playing') return null;
  const pend = g.pending;
  if (pend && pend.type === 'startColor' && pend.pid === id) return { type: 'chooseColor', color: favouriteColour(me.hand) };
  if (pend && pend.type === 'wild4' && pend.target === id) return { type: Math.random() < 0.25 ? 'challenge' : 'accept' };
  if (g.unoWindow && g.unoWindow.pid !== id && Math.random() < 0.6) return { type: 'catch', target: g.unoWindow.pid };
  if (g.current !== id || pend) return null;
  if (me.canUno && Math.random() < 0.85) return { type: 'uno' };
  const playable = me.hand.filter((c) => me.playable.includes(c.id));
  if (playable.length) {
    // Keep wild cards for later when possible.
    const card = playable.find((c) => c.color !== 'wild') || playable[0];
    return { type: 'play', cardId: card.id, color: favouriteColour(me.hand.filter((c) => c.id !== card.id)) };
  }
  return me.drawn !== null ? { type: 'pass' } : { type: 'draw' };
}

function runBot(label, token) {
  const s = io(URL, { transports: ['websocket'] });
  let view = null, busy = false;
  const req = (ev, payload) => new Promise((resolve, reject) =>
    s.emit(ev, payload, (r) => (r && r.ok ? resolve(r) : reject(new Error(r ? r.error : 'no answer')))));

  async function think() {
    if (busy || !view || !view.game) return;
    const action = decide(view);
    if (!action) return;
    busy = true;
    await sleep(action.slow ? DELAY * 4 : DELAY);
    try {
      const again = decide(view);
      if (again && again.type === action.type) await req('action', again);
    } catch (e) {
      if (!/Αργά|γύρος δεν/.test(e.message)) console.log(`[${label}] ${e.message}`);
    }
    busy = false;
    think();
  }

  s.on('connect', async () => {
    try {
      await req('hello', { role: 'player', code: CODE, token });
      console.log(`[${label}] connected`);
    } catch (e) {
      console.log(`[${label}] ${e.message}`);
      process.exit(1);
    }
  });
  s.on('state', (v) => {
    view = v;
    if (v.game && v.game.phase === 'gameOver' && !s.reported) {
      s.reported = true;
      const me = v.game.players.find((p) => p.id === v.myId);
      console.log(`[${label}] game over: ${me.score} points${v.game.winner === v.myId ? ' (winner)' : ''}`);
    }
    if (v.game && v.game.phase !== 'gameOver') s.reported = false;
    think();
  });
  s.on('closed', () => { console.log(`[${label}] game closed`); process.exit(0); });
}

(async function main() {
  if (args.token) return runBot('bot', args.token);
  const count = Math.min(R.MAX_PLAYERS, Number(args.join));
  const s = io(URL, { transports: ['websocket'] });
  await new Promise((r) => s.on('connect', r));
  for (let i = 1; i <= count; i++) {
    const name = `Ρομπότ ${i}`;
    const r = await new Promise((resolve) => s.emit('join', { code: CODE, name, pin: '0000' }, resolve));
    if (!r.ok) { console.log(`${name}: ${r.error}`); continue; }
    runBot(name, r.token);
  }
  s.close();
})();
