'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');

process.env.ADMIN_PASSWORD = 'test-pw';
process.env.DATA_FILE = '';
const { server, io } = require('../server.js');

let url;
const sockets = [];
function client() {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  s.latest = null;
  s.on('state', (v) => { s.latest = v; });
  s.req = (ev, payload) => new Promise((resolve, reject) =>
    s.emit(ev, payload, (r) => (r.ok ? resolve(r) : reject(new Error(r.error)))));
  return s;
}
const until = async (fn, ms = 2000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test.before(() => new Promise((resolve) => server.listen(0, () => { url = `http://localhost:${server.address().port}`; resolve(); })));
test.after(() => { for (const s of sockets) s.close(); io.close(); server.close(); });

test('admin creates a game, players join and play, hands stay private', async () => {
  const admin = client();
  await assert.rejects(admin.req('admin:create', {}), /admin/);
  await assert.rejects(admin.req('admin:login', { password: 'nope' }), /Λάθος/);
  await admin.req('admin:login', { password: 'test-pw' });
  const { code } = await admin.req('admin:create', {});
  await admin.req('admin:target', { code, target: 100 });
  await assert.rejects(admin.req('admin:target', { code, target: 7 }), /στόχος/);

  const tv = client();
  await tv.req('hello', { role: 'tv', code });
  const players = [];
  for (const name of ['Άννα', 'Βασίλης', 'Γιώργος']) {
    const p = client();
    const r = await p.req('join', { code, name, pin: '1234' });
    await p.req('hello', { role: 'player', code, token: r.token });
    p.token = r.token;
    players.push(p);
  }
  const intruder = client();
  await assert.rejects(intruder.req('join', { code, name: 'άννα', pin: '9999' }), /άλλο PIN/);
  await assert.rejects(intruder.req('action', { type: 'draw' }));
  await until(() => tv.latest && tv.latest.room.members.length === 3);
  assert.equal(tv.latest.room.settings.target, 100);

  await admin.req('admin:start', { code });
  await until(() => tv.latest.game && players.every((p) => p.latest && p.latest.me));
  const tvJson = JSON.stringify(tv.latest);
  assert.ok(!tvJson.includes('"hand"') && !tvJson.includes('playable'), 'TV must not see hands');
  for (const p of players) assert.ok(p.latest.me.hand.length >= 7);
  assert.ok(!JSON.stringify(players[0].latest).includes(players[1].token));

  // Whoever must act does something legal.
  const g = tv.latest.game;
  if (g.pending && g.pending.type === 'startColor') {
    const who = players.find((p) => p.latest.myId === g.pending.pid);
    await who.req('action', { type: 'chooseColor', color: 'red' });
    await until(() => tv.latest.game.color === 'red');
  }
  const curId = tv.latest.game.current;
  const cur = players.find((p) => p.latest.myId === curId);
  const other = players.find((p) => p !== cur);
  await assert.rejects(other.req('action', { type: 'draw' }), /σειρά σου/);
  await until(() => cur.latest.game.seq === tv.latest.game.seq);
  const before = cur.latest.me.hand.length;
  await cur.req('action', { type: 'draw' });
  await until(() => cur.latest.me.hand.length === before + 1);
  if (cur.latest.me.drawn !== null) await cur.req('action', { type: 'pass' });
  await until(() => tv.latest.game.current !== curId);
  assert.ok(tv.latest.game.events.some((e) => e.type === 'draw' && e.pid === curId));

  await admin.req('admin:skip', { code });
  await admin.req('admin:restart', { code });
  await until(() => tv.latest.room.gameNo === 2 && tv.latest.game.round === 1);
  let closed = false;
  tv.on('closed', () => { closed = true; });
  await admin.req('admin:close', { code });
  await until(() => closed);
});

test('qr code endpoint', async () => {
  const admin = client();
  await admin.req('admin:login', { password: 'test-pw' });
  const { code } = await admin.req('admin:create', {});
  const res = await fetch(`${url}/api/qr/${code}`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<svg/);
  assert.equal((await fetch(`${url}/api/qr/0000`)).status, 404);
});
