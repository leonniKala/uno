'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../server/game.js');
const R = require('../public/js/uno-rules.js');

function rng(seed = 1) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const PLAYERS = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'Παίκτης ' + (i + 1), color: G.PLAYER_COLORS[i] }));
const total = (s) => s.deck.length + s.discard.length + s.players.reduce((n, p) => n + p.hand.length, 0);
const cur = (s) => s.players[s.current];
const card = (color, value, id) => ({ id, color, value });

/** A game with a plain number card on top and no pending effects, for hand-made scenarios. */
function setup(n = 3, seed = 1) {
  const r = rng(seed);
  const s = G.newGame(PLAYERS(n), { target: 500 }, r);
  s.discard = [card('red', '5', 900)];
  s.color = 'red';
  s.pending = null;
  s.direction = 1;
  s.current = 0;
  s.turn = { drawn: null };
  return { s, r };
}
const give = (p, cards) => { p.hand = cards; };

test('deck and deal', () => {
  const deck = R.buildDeck();
  assert.equal(deck.length, 108);
  assert.equal(deck.filter((c) => c.value === 'wild4').length, 4);
  assert.equal(deck.filter((c) => c.color === 'red').length, 25);
  assert.equal(deck.reduce((n, c) => n + R.points(c), 0), 4 * (45 * 2 + 6 * 20) + 8 * 50);
  const s = G.newGame(PLAYERS(4), {}, rng(3));
  assert.equal(total(s), 108);
  for (const p of s.players) assert.ok(p.hand.length >= 7);
  assert.notEqual(s.discard[0].value, 'wild4');
});

test('matching: colour, value/symbol, wilds', () => {
  const top = card('red', '5');
  assert.ok(R.canPlay(card('red', '9'), top, 'red'));
  assert.ok(R.canPlay(card('blue', '5'), top, 'red'));
  assert.ok(!R.canPlay(card('blue', '7'), top, 'red'));
  assert.ok(R.canPlay(card('wild', 'wild4'), top, 'red'));
  assert.ok(R.canPlay(card('green', 'skip'), card('red', 'skip'), 'red'));
  // after a wild only the chosen colour counts
  assert.ok(R.canPlay(card('green', '3'), card('wild', 'wild'), 'green'));
  assert.ok(!R.canPlay(card('blue', '3'), card('wild', 'wild'), 'green'));
});

test('playing cards, skip, reverse, draw two', () => {
  const { s, r } = setup(4);
  const [a, b, c, d] = s.players;
  give(a, [card('red', 'skip', 1), card('red', '1', 2), card('red', '9', 10)]);
  give(b, [card('blue', '2', 3), card('blue', '3', 4)]);
  give(c, [card('red', 'reverse', 5), card('green', '4', 6)]);
  give(d, [card('red', 'draw2', 7), card('yellow', '8', 8), card('yellow', '9', 9)]);
  assert.throws(() => G.applyAction(s, 'p2', { type: 'play', cardId: 3 }, r), /σειρά σου/);
  assert.throws(() => G.applyAction(s, 'p1', { type: 'play', cardId: 99 }, r), /Δεν έχεις/);
  G.applyAction(s, 'p1', { type: 'play', cardId: 1 }, r); // skip: b loses turn
  assert.equal(cur(s).id, 'p3');
  G.applyAction(s, 'p3', { type: 'play', cardId: 5 }, r); // reverse: back to b
  assert.equal(s.direction, -1);
  assert.equal(cur(s).id, 'p2');
  assert.throws(() => G.applyAction(s, 'p2', { type: 'play', cardId: 3 }, r), /δεν ταιριάζει/);
  G.applyAction(s, 'p2', { type: 'draw' }, r);
  const drewPlayable = s.turn.drawn !== null;
  if (drewPlayable) G.applyAction(s, 'p2', { type: 'pass' }, r);
  assert.equal(cur(s).id, 'p1');
  G.applyAction(s, 'p1', { type: 'uno' }, r);
  G.applyAction(s, 'p1', { type: 'play', cardId: 2 }, r); // p1 has one card left, said UNO
  assert.equal(s.unoWindow, null);
  assert.equal(cur(s).id, 'p4');
  const before = s.players[2].hand.length;
  G.applyAction(s, 'p4', { type: 'play', cardId: 7 }, r); // +2 to p3, who is skipped
  assert.equal(s.players[2].hand.length, before + 2);
  assert.equal(cur(s).id, 'p2');
});

test('two players: reverse and skip let you play again', () => {
  const { s, r } = setup(2);
  give(s.players[0], [card('red', 'reverse', 1), card('red', 'skip', 2), card('red', '7', 3)]);
  give(s.players[1], [card('blue', '1', 4)]);
  G.applyAction(s, 'p1', { type: 'play', cardId: 1 }, r);
  assert.equal(cur(s).id, 'p1');
  G.applyAction(s, 'p1', { type: 'play', cardId: 2 }, r);
  assert.equal(cur(s).id, 'p1');
});

test('drawing: a playable drawn card may be played, nothing else', () => {
  const { s, r } = setup(3);
  give(s.players[0], [card('red', '8', 1)]);
  s.deck.push(card('red', '2', 500));
  G.applyAction(s, 'p1', { type: 'draw' }, r);
  assert.equal(s.turn.drawn, 500);
  assert.throws(() => G.applyAction(s, 'p1', { type: 'play', cardId: 1 }, r), /τράβηξες/);
  assert.throws(() => G.applyAction(s, 'p1', { type: 'draw' }, r), /ήδη τραβήξει/);
  G.applyAction(s, 'p1', { type: 'play', cardId: 500 }, r);
  assert.equal(cur(s).id, 'p2');
  // unplayable drawn card ends the turn at once
  s.deck.push(card('blue', '9', 501));
  give(s.players[1], [card('green', '1', 2)]);
  G.applyAction(s, 'p2', { type: 'draw' }, r);
  assert.equal(cur(s).id, 'p3');
  assert.throws(() => G.applyAction(s, 'p3', { type: 'pass' }, r), /Πρώτα τράβα/);
});

test('wild draw four: accept, fair challenge, successful challenge', () => {
  let { s, r } = setup(3);
  give(s.players[0], [card('wild', 'wild4', 1), card('blue', '1', 2)]);
  give(s.players[1], [card('green', '3', 3)]);
  assert.throws(() => G.applyAction(s, 'p1', { type: 'play', cardId: 1 }, r), /χρώμα/);
  G.applyAction(s, 'p1', { type: 'play', cardId: 1, color: 'green' }, r);
  assert.equal(s.color, 'green');
  assert.equal(s.pending.target, 'p2');
  assert.throws(() => G.applyAction(s, 'p2', { type: 'draw' }, r), /\+4/);
  G.applyAction(s, 'p2', { type: 'accept' }, r);
  assert.equal(s.players[1].hand.length, 5);
  assert.equal(cur(s).id, 'p3');

  // fair +4 (no red card in hand): challenger draws 6 and loses the turn
  ({ s, r } = setup(3));
  give(s.players[0], [card('wild', 'wild4', 1), card('blue', '1', 2)]);
  give(s.players[1], [card('green', '3', 3)]);
  G.applyAction(s, 'p1', { type: 'play', cardId: 1, color: 'blue' }, r);
  G.applyAction(s, 'p2', { type: 'challenge' }, r);
  assert.equal(s.players[1].hand.length, 7);
  assert.equal(cur(s).id, 'p3');

  // unfair +4 (held a red card): the player who played it draws 4, challenger plays on
  ({ s, r } = setup(3));
  give(s.players[0], [card('wild', 'wild4', 1), card('red', '1', 2)]);
  give(s.players[1], [card('green', '3', 3)]);
  G.applyAction(s, 'p1', { type: 'play', cardId: 1, color: 'green' }, r);
  G.applyAction(s, 'p2', { type: 'challenge' }, r);
  assert.equal(s.players[0].hand.length, 5);
  assert.equal(s.players[1].hand.length, 1);
  assert.equal(cur(s).id, 'p2');
  assert.equal(s.color, 'green');
});

test('forgetting UNO: caught before the next player moves', () => {
  const { s, r } = setup(3);
  give(s.players[0], [card('red', '1', 1), card('red', '2', 2)]);
  give(s.players[1], [card('red', '3', 3), card('green', '3', 4)]);
  G.applyAction(s, 'p1', { type: 'play', cardId: 1 }, r);
  assert.deepEqual(s.unoWindow, { pid: 'p1' });
  assert.ok(G.privateView(s, 'p1').canUno);
  G.applyAction(s, 'p3', { type: 'catch', target: 'p1' }, r);
  assert.equal(s.players[0].hand.length, 3);
  assert.throws(() => G.applyAction(s, 'p3', { type: 'catch', target: 'p1' }, r), /Αργά/);

  // once the next player has moved it's too late
  const t = setup(3);
  give(t.s.players[0], [card('red', '1', 1), card('red', '2', 2)]);
  give(t.s.players[1], [card('red', '3', 3), card('green', '3', 4)]);
  G.applyAction(t.s, 'p1', { type: 'play', cardId: 1 }, t.r);
  G.applyAction(t.s, 'p2', { type: 'play', cardId: 3 }, t.r);
  assert.throws(() => G.applyAction(t.s, 'p3', { type: 'catch', target: 'p1' }, t.r), /Αργά/);
  assert.throws(() => G.applyAction(t.s, 'p3', { type: 'uno' }, t.r), /ΟΥΝΟ/);
});

test('going out: points, last-card draw two, next round, winning', () => {
  const { s, r } = setup(3);
  give(s.players[0], [card('red', 'draw2', 1)]);
  s.players[0].uno = true;
  give(s.players[1], [card('wild', 'wild', 2), card('blue', '7', 3)]);
  give(s.players[2], [card('green', 'skip', 4)]);
  G.applyAction(s, 'p1', { type: 'play', cardId: 1 }, r);
  assert.equal(s.phase, 'roundOver');
  const drawnPts = s.roundResult.hands.find((h) => h.id === 'p2').points;
  assert.ok(drawnPts >= 57); // 50 + 7 + the two drawn cards
  assert.equal(s.players[0].score, s.roundResult.points);
  assert.equal(s.roundResult.points, drawnPts + 20);
  assert.throws(() => G.applyAction(s, 'p2', { type: 'draw' }, r), /γύρος/);
  const dealer = s.dealer;
  G.applyAction(s, 'p2', { type: 'nextRound' }, r);
  assert.equal(s.phase, 'playing');
  assert.equal(s.round, 2);
  assert.equal(s.dealer, (dealer + 1) % 3);
  assert.equal(total(s), 108);

  const w = setup(2);
  w.s.players[0].score = 490;
  give(w.s.players[0], [card('red', '1', 1)]);
  w.s.players[0].uno = true;
  give(w.s.players[1], [card('blue', 'skip', 2)]);
  G.applyAction(w.s, 'p1', { type: 'play', cardId: 1 }, w.r);
  assert.equal(w.s.phase, 'gameOver');
  assert.equal(w.s.winner, 'p1');
  assert.throws(() => G.applyAction(w.s, 'p2', { type: 'nextRound' }, w.r), /τελείωσε/);
});

test('first card effects', () => {
  for (let seed = 1; seed < 400; seed++) {
    const s = G.newGame(PLAYERS(3), {}, rng(seed));
    const t = s.discard[0];
    assert.notEqual(t.value, 'wild4');
    if (t.value === 'wild') assert.equal(s.pending.type, 'startColor');
    if (t.value === 'reverse') assert.equal(s.direction, -1);
  }
});

test('malformed moves are rejected without touching the state', () => {
  const { s, r } = setup(3);
  const before = JSON.stringify(s);
  for (const a of [null, { type: '__proto__' }, { type: 'toString' }, { type: 'play', cardId: '__proto__' },
    { type: 'play', cardId: { id: 1 } }, { type: 'catch', target: '__proto__' }, { type: 'chooseColor', color: 'pink' }]) {
    assert.throws(() => G.applyAction(s, 'p1', a, r), G.GameError);
  }
  assert.equal(JSON.stringify(s), before);
});

test('random games always end and never lose a card', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed);
    const n = 2 + (seed % 9);
    const s = G.newGame(PLAYERS(n), { target: seed % 3 ? 200 : 0 }, r);
    let steps = 0;
    while (s.phase !== 'gameOver' && steps++ < 20000) {
      if (s.phase === 'roundOver') { G.applyAction(s, 'p1', { type: 'nextRound' }, r); continue; }
      const p = cur(s);
      try {
        if (s.pending && s.pending.type === 'startColor') {
          G.applyAction(s, s.pending.pid, { type: 'chooseColor', color: R.COLORS[Math.floor(r() * 4)] }, r);
        } else if (s.pending && s.pending.type === 'wild4') {
          G.applyAction(s, s.pending.target, { type: r() < 0.3 ? 'challenge' : 'accept' }, r);
        } else if (s.unoWindow && r() < 0.5) {
          const other = s.players.find((x) => x.id !== s.unoWindow.pid);
          G.applyAction(s, other.id, { type: 'catch', target: s.unoWindow.pid }, r);
        } else {
          const me = G.privateView(s, p.id);
          if (me.canUno && r() < 0.7) G.applyAction(s, p.id, { type: 'uno' }, r);
          const mine = G.privateView(s, p.id);
          if (mine.playable.length) {
            const cardId = mine.playable[Math.floor(r() * mine.playable.length)];
            G.applyAction(s, p.id, { type: 'play', cardId, color: R.COLORS[Math.floor(r() * 4)] }, r);
          } else if (mine.drawn !== null) {
            G.applyAction(s, p.id, { type: 'pass' }, r);
          } else {
            G.applyAction(s, p.id, { type: 'draw' }, r);
          }
        }
      } catch (e) {
        if (!(e instanceof G.GameError)) throw e;
        throw new Error(`seed ${seed}: illegal bot move: ${e.message}`);
      }
      assert.equal(total(s), 108, `seed ${seed}: card count`);
      const pub = JSON.stringify(G.publicView(s));
      assert.ok(!pub.includes('"hand"') && !pub.includes('illegal'), 'public view leaks private data');
    }
    assert.equal(s.phase, 'gameOver', `seed ${seed} did not finish`);
    const w = s.players.find((p) => p.id === s.winner);
    if (s.target) assert.ok(w.score >= s.target);
  }
});
