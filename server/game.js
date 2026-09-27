'use strict';
/*
 * UNO rules engine. The whole game is one JSON-serialisable state object;
 * every move goes through applyAction(), which throws GameError for anything illegal.
 */
const R = require('../public/js/uno-rules.js');

const GR = { red: 'κόκκινο', yellow: 'κίτρινο', green: 'πράσινο', blue: 'μπλε' };
const VALUE_NAMES = { skip: 'Στοπ', reverse: 'Αλλαγή φοράς', draw2: '+2', wild: 'Μπαλαντέρ', wild4: 'Μπαλαντέρ +4' };
const PLAYER_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#d81b60', '#6d4c41', '#78909c'];

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const cardName = (c) => (c.color === 'wild' ? VALUE_NAMES[c.value] : `${VALUE_NAMES[c.value] || c.value} ${GR[c.color]}`);

// ------------------------------------------------------------------ setup

/**
 * players: [{ id, name, color }] in seating order.
 * target: points needed to win the game (0 = a single round).
 */
function newGame(players, { target = 500 } = {}, rng = Math.random) {
  if (players.length < R.MIN_PLAYERS || players.length > R.MAX_PLAYERS) {
    fail(`Χρειάζονται ${R.MIN_PLAYERS}–${R.MAX_PLAYERS} παίκτες`);
  }
  const s = {
    version: 1,
    phase: 'playing',
    seq: 0,
    round: 0,
    target,
    players: players.map((p) => ({ id: p.id, name: p.name, color: p.color, hand: [], score: 0, uno: false })),
    deck: [],
    discard: [],
    color: null,
    direction: 1,
    dealer: Math.floor(rng() * players.length),
    current: 0,
    turn: { drawn: null },
    pending: null,
    unoWindow: null,
    log: [],
    events: [],
    roundResult: null,
    winner: null,
  };
  startRound(s, rng, true);
  return s;
}

function startRound(s, rng, first = false) {
  s.round++;
  s.phase = 'playing';
  if (!first) s.dealer = (s.dealer + 1) % s.players.length;
  s.deck = shuffle(R.buildDeck(), rng);
  s.discard = [];
  s.direction = 1;
  s.turn = { drawn: null };
  s.pending = null;
  s.unoWindow = null;
  s.roundResult = null;
  for (const p of s.players) { p.hand = []; p.uno = false; }
  for (let i = 0; i < R.HAND_SIZE; i++) for (const p of s.players) p.hand.push(s.deck.pop());

  // First card of the discard pile: a Wild Draw Four goes back into the deck.
  let top = s.deck.pop();
  while (top.value === 'wild4') {
    s.deck.push(top);
    s.deck = shuffle(s.deck, rng);
    top = s.deck.pop();
  }
  s.discard.push(top);
  s.color = top.color === 'wild' ? null : top.color;
  s.current = next(s, s.dealer);
  const dealer = s.players[s.dealer];
  addLog(s, null, `Γύρος ${s.round}: μοιράζει ${dealer.name}. Πρώτη κάρτα: ${cardName(top)}.`);
  event(s, { type: 'deal', round: s.round });

  const firstP = s.players[s.current];
  if (top.value === 'wild') {
    s.pending = { type: 'startColor', pid: firstP.id };
  } else if (top.value === 'draw2') {
    drawCards(s, firstP, 2, rng);
    addLog(s, firstP.id, `${firstP.name} τραβάει 2 και χάνει τη σειρά του.`);
    event(s, { type: 'draw', pid: firstP.id, count: 2 });
    s.current = next(s, s.current);
  } else if (top.value === 'reverse') {
    s.direction = -1;
    s.current = s.dealer;
    addLog(s, null, 'Η φορά αλλάζει: ξεκινάει όποιος μοίρασε.');
  } else if (top.value === 'skip') {
    addLog(s, firstP.id, `${firstP.name} χάνει τη σειρά του.`);
    event(s, { type: 'skip', pid: firstP.id });
    s.current = next(s, s.current);
  }
}

// ------------------------------------------------------------------ helpers

function next(s, i, steps = 1) {
  const n = s.players.length;
  return (((i + steps * s.direction) % n) + n) % n;
}

function addLog(s, pid, text) {
  s.log.push({ seq: s.seq, pid, text });
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
}

function event(s, ev) {
  s.events = (s.events || []).filter((e) => e.seq > s.seq - 5);
  s.events.push({ seq: s.seq, ...ev });
}

function drawOne(s, rng) {
  if (!s.deck.length) {
    if (s.discard.length <= 1) return null;
    const top = s.discard.pop();
    s.deck = shuffle(s.discard, rng);
    s.discard = [top];
    addLog(s, null, 'Η τράπουλα τελείωσε: ανακατεύτηκαν οι πεταμένες κάρτες.');
  }
  return s.deck.pop();
}

function drawCards(s, p, count, rng) {
  let got = 0;
  for (let i = 0; i < count; i++) {
    const c = drawOne(s, rng);
    if (!c) break;
    p.hand.push(c);
    got++;
  }
  if (p.hand.length > 1) {
    p.uno = false;
    if (s.unoWindow && s.unoWindow.pid === p.id) s.unoWindow = null;
  }
  return got;
}

function playerById(s, pid) {
  const p = s.players.find((x) => x.id === pid);
  if (!p) fail('Άγνωστος παίκτης');
  return p;
}

function requireTurn(s, pid) {
  if (s.phase !== 'playing') fail('Ο γύρος δεν είναι σε εξέλιξη');
  const p = s.players[s.current];
  if (p.id !== pid) fail('Δεν είναι η σειρά σου');
  if (s.pending && s.pending.type === 'startColor') fail('Πρώτα διάλεξε χρώμα');
  if (s.pending && s.pending.type === 'wild4') fail('Πρώτα απάντησε στο +4');
  return p;
}

const top = (s) => s.discard[s.discard.length - 1];

function endTurn(s) {
  s.turn = { drawn: null };
}

// ------------------------------------------------------------------ actions

const ACTIONS = {
  play(s, pid, { cardId, color }, rng) {
    const p = requireTurn(s, pid);
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) fail('Δεν έχεις αυτή την κάρτα');
    const card = p.hand[idx];
    if (s.turn.drawn !== null && card.id !== s.turn.drawn) fail('Τώρα μπορείς να παίξεις μόνο την κάρτα που τράβηξες');
    if (!R.canPlay(card, top(s), s.color)) fail('Αυτή η κάρτα δεν ταιριάζει');
    if (card.color === 'wild' && !R.COLORS.includes(color)) fail('Διάλεξε χρώμα');

    // For a possible challenge: did the player hold a card of the colour in play?
    const illegal = card.value === 'wild4' && p.hand.some((c) => c.id !== card.id && c.color === s.color);
    p.hand.splice(idx, 1);
    s.discard.push(card);
    s.color = card.color === 'wild' ? color : card.color;
    addLog(s, pid, `${p.name} έπαιξε ${cardName(card)}` + (card.color === 'wild' ? ` και διάλεξε ${GR[color]}.` : '.'));
    event(s, { type: 'play', pid, card, color: s.color });
    if (p.hand.length === 1 && !p.uno) s.unoWindow = { pid };
    endTurn(s);

    const nextIdx = next(s, s.current);
    const nextP = s.players[nextIdx];
    if (card.value === 'skip') {
      addLog(s, nextP.id, `${nextP.name} χάνει τη σειρά του.`);
      event(s, { type: 'skip', pid: nextP.id });
      s.current = next(s, nextIdx);
    } else if (card.value === 'reverse') {
      s.direction *= -1;
      event(s, { type: 'reverse', direction: s.direction });
      // With two players Reverse works like Skip.
      if (s.players.length === 2) {
        addLog(s, nextP.id, `${nextP.name} χάνει τη σειρά του.`);
        event(s, { type: 'skip', pid: nextP.id });
      } else {
        s.current = next(s, s.current);
      }
    } else if (card.value === 'draw2') {
      const got = drawCards(s, nextP, 2, rng);
      addLog(s, nextP.id, `${nextP.name} τραβάει ${got} και χάνει τη σειρά του.`);
      event(s, { type: 'draw', pid: nextP.id, count: got });
      s.current = next(s, nextIdx);
    } else if (card.value === 'wild4') {
      s.current = nextIdx;
      if (p.hand.length === 0) {
        // Going out with a +4: the next player simply draws.
        const got = drawCards(s, nextP, 4, rng);
        event(s, { type: 'draw', pid: nextP.id, count: got });
      } else {
        s.pending = { type: 'wild4', from: pid, target: nextP.id, illegal };
      }
    } else {
      s.current = nextIdx;
    }

    if (p.hand.length === 0) endRound(s, p);
  },

  draw(s, pid, _args, rng) {
    const p = requireTurn(s, pid);
    if (s.turn.drawn !== null) fail('Έχεις ήδη τραβήξει: παίξε την κάρτα ή πάσο');
    const card = drawOne(s, rng);
    if (!card) {
      addLog(s, pid, `${p.name}: δεν υπάρχουν κάρτες για τράβηγμα, πάσο.`);
      endTurn(s);
      s.current = next(s, s.current);
      return;
    }
    p.hand.push(card);
    p.uno = false;
    if (s.unoWindow && s.unoWindow.pid === pid) s.unoWindow = null;
    event(s, { type: 'draw', pid, count: 1 });
    if (R.canPlay(card, top(s), s.color)) {
      s.turn = { drawn: card.id };
      addLog(s, pid, `${p.name} τράβηξε μια κάρτα.`);
    } else {
      addLog(s, pid, `${p.name} τράβηξε μια κάρτα και πάει πάσο.`);
      endTurn(s);
      s.current = next(s, s.current);
    }
  },

  pass(s, pid) {
    const p = requireTurn(s, pid);
    if (s.turn.drawn === null) fail('Πρώτα τράβα μια κάρτα');
    addLog(s, pid, `${p.name} κράτησε την κάρτα και πάει πάσο.`);
    endTurn(s);
    s.current = next(s, s.current);
  },

  chooseColor(s, pid, { color }) {
    if (s.phase !== 'playing' || !s.pending || s.pending.type !== 'startColor') fail('Δεν χρειάζεται επιλογή χρώματος τώρα');
    if (s.pending.pid !== pid) fail('Το χρώμα το διαλέγει άλλος παίκτης');
    if (!R.COLORS.includes(color)) fail('Άγνωστο χρώμα');
    s.color = color;
    s.pending = null;
    addLog(s, pid, `${playerById(s, pid).name} διάλεξε ${GR[color]}.`);
    event(s, { type: 'color', color });
  },

  accept(s, pid, _args, rng) {
    const pend = s.pending;
    if (s.phase !== 'playing' || !pend || pend.type !== 'wild4' || pend.target !== pid) fail('Δεν υπάρχει +4 για σένα');
    const p = playerById(s, pid);
    const got = drawCards(s, p, 4, rng);
    addLog(s, pid, `${p.name} τραβάει ${got} και χάνει τη σειρά του.`);
    event(s, { type: 'draw', pid, count: got });
    s.pending = null;
    s.current = next(s, s.current);
  },

  challenge(s, pid, _args, rng) {
    const pend = s.pending;
    if (s.phase !== 'playing' || !pend || pend.type !== 'wild4' || pend.target !== pid) fail('Δεν υπάρχει +4 για σένα');
    const p = playerById(s, pid), from = playerById(s, pend.from);
    s.pending = null;
    if (pend.illegal) {
      // The +4 was played while holding the colour in play: the player who played it draws instead.
      const got = drawCards(s, from, 4, rng);
      addLog(s, pid, `${p.name} αμφισβήτησε και είχε δίκιο! ${from.name} είχε κι άλλη κάρτα στο χρώμα και τραβάει ${got}.`);
      event(s, { type: 'challenge', pid, from: from.id, won: true });
      event(s, { type: 'draw', pid: from.id, count: got });
    } else {
      const got = drawCards(s, p, 6, rng);
      addLog(s, pid, `${p.name} αμφισβήτησε άδικα και τραβάει ${got}.`);
      event(s, { type: 'challenge', pid, from: from.id, won: false });
      event(s, { type: 'draw', pid, count: got });
      s.current = next(s, s.current);
    }
  },

  uno(s, pid) {
    if (s.phase !== 'playing') fail('Ο γύρος δεν είναι σε εξέλιξη');
    const p = playerById(s, pid);
    const myTurn = s.players[s.current].id === pid && !s.pending;
    if (p.hand.length === 2 && myTurn) {
      p.uno = true;
    } else if (p.hand.length === 1 && s.unoWindow && s.unoWindow.pid === pid) {
      p.uno = true;
      s.unoWindow = null;
    } else if (p.hand.length === 1 && p.uno) {
      return;
    } else {
      fail('ΟΥΝΟ λες όταν πας να παίξεις την προτελευταία σου κάρτα');
    }
    addLog(s, pid, `${p.name}: ΟΥΝΟ!`);
    event(s, { type: 'uno', pid });
  },

  catch(s, pid, { target }, rng) {
    if (s.phase !== 'playing') fail('Ο γύρος δεν είναι σε εξέλιξη');
    const catcher = playerById(s, pid);
    if (!s.unoWindow || s.unoWindow.pid !== target || target === pid) fail('Αργά! Δεν μπορείς να τον πιάσεις πια');
    const t = playerById(s, target);
    if (t.hand.length !== 1) fail('Αργά! Δεν μπορείς να τον πιάσεις πια');
    s.unoWindow = null;
    const got = drawCards(s, t, 2, rng);
    addLog(s, pid, `${catcher.name} έπιασε ${t.name} χωρίς ΟΥΝΟ: τραβάει ${got}!`);
    event(s, { type: 'caught', pid: target, by: pid });
    event(s, { type: 'draw', pid: target, count: got });
  },

  nextRound(s, pid, _args, rng) {
    if (s.phase !== 'roundOver') fail('Ο γύρος δεν έχει τελειώσει');
    startRound(s, rng);
  },
};

function endRound(s, winner) {
  let points = 0;
  const hands = [];
  for (const p of s.players) {
    if (p === winner) continue;
    const pts = p.hand.reduce((n, c) => n + R.points(c), 0);
    points += pts;
    hands.push({ id: p.id, cards: R.sortHand(p.hand), points: pts });
  }
  winner.score += points;
  s.pending = null;
  s.unoWindow = null;
  s.roundResult = { winner: winner.id, points, hands };
  if (!s.target || winner.score >= s.target) {
    s.phase = 'gameOver';
    s.winner = winner.id;
    addLog(s, winner.id, `${winner.name} τελείωσε τις κάρτες του (+${points}) και κέρδισε το παιχνίδι με ${winner.score} πόντους!`);
    event(s, { type: 'gameOver', pid: winner.id, points });
  } else {
    s.phase = 'roundOver';
    addLog(s, winner.id, `${winner.name} κέρδισε τον γύρο ${s.round} και παίρνει ${points} πόντους.`);
    event(s, { type: 'roundOver', pid: winner.id, points });
  }
}

/** Admin override: the current player (or the one who must answer a +4 / pick a colour) is skipped. */
function skipTurn(s, rng = Math.random) {
  if (s.phase !== 'playing') fail('Ο γύρος δεν είναι σε εξέλιξη');
  s.seq++;
  if (s.pending && s.pending.type === 'wild4') return ACTIONS.accept(s, s.pending.target, {}, rng);
  if (s.pending && s.pending.type === 'startColor') {
    return ACTIONS.chooseColor(s, s.pending.pid, { color: R.COLORS[Math.floor(rng() * 4)] });
  }
  const p = s.players[s.current];
  addLog(s, p.id, `Παράλειψη σειράς: ${p.name}.`);
  endTurn(s);
  s.current = next(s, s.current);
}

// Moves after which a forgotten ΟΥΝΟ can no longer be caught.
const CLOSES_UNO_WINDOW = new Set(['play', 'draw', 'pass', 'accept', 'challenge', 'chooseColor']);

function applyAction(s, pid, action, rng = Math.random) {
  const fn = action && typeof action.type === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, action.type) && ACTIONS[action.type];
  if (!fn) fail('Άγνωστη κίνηση');
  if (s.phase === 'gameOver') fail('Το παιχνίδι τελείωσε');
  const draft = JSON.parse(JSON.stringify(s));
  draft.seq++;
  if (CLOSES_UNO_WINDOW.has(action.type) && draft.unoWindow && draft.unoWindow.pid !== pid) draft.unoWindow = null;
  fn(draft, pid, action, rng);
  Object.assign(s, draft);
  return s;
}

// ------------------------------------------------------------------ views

/** Everything everyone may see (TV, all phones). */
function publicView(s) {
  const pend = s.pending && (s.pending.type === 'wild4'
    ? { type: 'wild4', from: s.pending.from, target: s.pending.target }
    : { type: s.pending.type, pid: s.pending.pid });
  return {
    phase: s.phase,
    seq: s.seq,
    round: s.round,
    target: s.target,
    players: s.players.map((p) => ({ id: p.id, name: p.name, color: p.color, count: p.hand.length, score: p.score, uno: p.uno })),
    top: top(s),
    under: s.discard.slice(-4, -1),
    deckCount: s.deck.length,
    color: s.color,
    direction: s.direction,
    dealer: s.players[s.dealer].id,
    current: s.phase === 'playing' ? s.players[s.current].id : null,
    drew: s.turn.drawn !== null,
    pending: pend,
    unoWindow: s.unoWindow,
    log: s.log.slice(-20),
    events: s.events || [],
    roundResult: s.roundResult,
    winner: s.winner,
  };
}

/** A player's own cards and what they can do with them. */
function privateView(s, pid) {
  const p = s.players.find((x) => x.id === pid);
  if (!p) return null;
  const myTurn = s.phase === 'playing' && s.players[s.current].id === pid && !s.pending;
  const playable = myTurn
    ? p.hand.filter((c) => (s.turn.drawn === null || c.id === s.turn.drawn) && R.canPlay(c, top(s), s.color)).map((c) => c.id)
    : [];
  return {
    id: p.id,
    hand: R.sortHand(p.hand),
    playable,
    drawn: myTurn ? s.turn.drawn : null,
    canUno: s.phase === 'playing' && !p.uno && ((p.hand.length === 2 && myTurn) || (p.hand.length === 1 && !!s.unoWindow && s.unoWindow.pid === pid)),
  };
}

module.exports = { GameError, PLAYER_COLORS, newGame, applyAction, skipTurn, publicView, privateView, startRound };
