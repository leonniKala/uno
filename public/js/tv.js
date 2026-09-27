/* TV view: the table, the players around it and what just happened. */
(function () {
  'use strict';
  const { h, avatar, store } = UNO;
  const { COLOUR_NAMES, FILL } = UnoCards;
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(location.search);
  let code = params.get('code') || store.get('uno:tv');
  const socket = UNO.connect();
  UNO.keepAlive();
  UNO.keepAwake();
  let view = null, lastSeq = null;

  // ------------------------------------------------------------------ connection
  async function connectTo(c) {
    try {
      const r = await socket.request('hello', { role: 'tv', code: c });
      code = r.code;
      store.set('uno:tv', code);
      history.replaceState(null, '', '/tv?code=' + code);
      $('code-screen').classList.add('hidden');
    } catch (e) {
      showCodeScreen(e.message);
    }
  }
  function showCodeScreen(err) {
    for (const id of ['tv', 'lobby-screen', 'results-screen']) $(id).classList.add('hidden');
    $('code-screen').classList.remove('hidden');
    $('code-err').textContent = err || '';
    $('code-in').focus();
  }
  $('code-screen').addEventListener('submit', (e) => { e.preventDefault(); connectTo($('code-in').value.trim()); });
  socket.on('connect', () => (code ? connectTo(code) : showCodeScreen()));
  socket.on('state', (v) => { view = v; render(); });
  socket.on('closed', () => { view = null; store.del('uno:tv'); code = null; showCodeScreen('Το παιχνίδι έκλεισε. Γράψε νέο κωδικό.'); });
  window.addEventListener('resize', () => { if (view && view.game) renderSeats(); });

  const pname = (id) => { const p = view.game.players.find((x) => x.id === id); return p ? p.name : '?'; };

  // ------------------------------------------------------------------ render
  function render() {
    const { room, game } = view;
    $('code-lbl').textContent = room.code;
    $('tv').classList.remove('hidden');
    $('lobby-screen').classList.toggle('hidden', !!game);
    if (!game) { renderLobby(); $('results-screen').classList.add('hidden'); lastSeq = null; return; }
    document.body.style.setProperty('--tint', game.color ? FILL[game.color] : '#777');
    $('round').replaceChildren('Γύρος ', h('b', null, String(game.round)), ` · ${UNO.targetText(game.target)}`);
    renderBanner();
    renderPiles();
    renderSeats();
    renderLog();
    handleEvents();
    renderResults();
  }

  function renderLobby() {
    const { room } = view;
    $('lobby-screen').replaceChildren(
      h('div', { class: 'join-box' },
        h('span', { class: 'logo-word' }, 'UNO'),
        h('div', { class: 'qr' }, h('img', { src: `/api/qr/${room.code}?g=${room.gameNo}`, alt: 'QR' })),
        h('div', { class: 'url' }, `Σκανάρετε ή ανοίξτε ${location.host}/ και γράψτε τον κωδικό`),
        h('div', { class: 'bigcode' }, room.code)),
      h('div', { class: 'joined' },
        h('h2', null, `Παίκτες (${room.members.length}/10)`),
        h('div', { class: 'tgt' }, UNO.targetText(room.settings.target)),
        h('div', { class: 'list' }, room.members.map((m) => h('div', { class: 'm' + (m.online ? '' : ' off') }, avatar(m), m.name))),
        h('div', { class: 'wait' }, room.members.length >= 2 ? 'Ο admin μπορεί να ξεκινήσει το παιχνίδι.' : 'Χρειάζονται τουλάχιστον 2 παίκτες.')));
  }

  function renderBanner() {
    const g = view.game, b = $('banner');
    b.classList.remove('hidden');
    b.textContent = '';
    if (g.phase !== 'playing') { b.append(g.phase === 'gameOver' ? 'Τέλος παιχνιδιού' : 'Τέλος γύρου'); return; }
    const pend = g.pending;
    const who = g.players.find((p) => p.id === (pend ? pend.target || pend.pid : g.current));
    const what = pend && pend.type === 'wild4' ? 'δέχεται ή αμφισβητεί το +4'
      : pend && pend.type === 'startColor' ? 'διαλέγει χρώμα'
        : g.drew ? 'τράβηξε κάρτα' : 'παίζει';
    b.append(avatar(who), `${who.name} ${what}`);
  }

  const tilt = (id) => ((id * 37) % 29) - 14;

  function renderPiles() {
    const g = view.game;
    $('deck-card').replaceChildren(UnoCards.el(null));
    $('deck-n').textContent = `${g.deckCount} κάρτες`;
    const box = $('discard');
    box.textContent = '';
    for (const c of g.under.concat([g.top])) {
      const el = UnoCards.el(c);
      el.style.transform = `rotate(${tilt(c.id)}deg) translate(${(c.id % 7) - 3}px, ${(c.id % 5) - 2}px)`;
      box.append(el);
    }
    $('ring').classList.toggle('ccw', g.direction < 0);
    $('colorname').replaceChildren(g.color ? h('span', null, h('span', { class: 'cdot ' + g.color }), ' ', COLOUR_NAMES[g.color]) : 'Χρώμα: διαλέγει ο πρώτος παίκτης');
  }

  function seatPositions() {
    const t = $('table').getBoundingClientRect(), n = view.game.players.length;
    return view.game.players.map((p, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return { x: t.width / 2 + Math.cos(a) * t.width * 0.4, y: t.height / 2 + Math.sin(a) * t.height * 0.41 };
    });
  }

  function renderSeats() {
    const g = view.game, box = $('seats');
    const online = Object.fromEntries(view.room.members.map((m) => [m.id, m.online]));
    const pos = seatPositions();
    box.textContent = '';
    g.players.forEach((p, i) => {
      const fan = h('div', { class: 'fan' });
      for (let k = 0; k < Math.min(p.count, 12); k++) fan.append(UnoCards.el(null));
      const forgot = g.unoWindow && g.unoWindow.pid === p.id;
      const seat = h('div', {
        class: 'seat' + (p.id === g.current && g.phase === 'playing' ? ' current' : '') + (p.id === g.dealer ? ' dealer' : ''),
        'data-pid': p.id, style: { left: pos[i].x + 'px', top: pos[i].y + 'px', opacity: online[p.id] ? '1' : '0.55' },
      },
      fan,
      h('div', { class: 'plate' }, avatar(p), h('span', { class: 'nm' }, p.name), h('span', { class: 'cnt' }, String(p.count)), h('span', { class: 'sc' }, `${p.score} π.`)),
      p.count === 1 && (p.uno ? h('span', { class: 'flag' }, 'ΟΥΝΟ!') : forgot ? h('span', { class: 'flag forgot' }, 'ξέχασε το ΟΥΝΟ!') : null));
      box.append(seat);
    });
  }

  function renderLog() {
    $('log').replaceChildren(...view.game.log.slice(-3).map((l) => h('div', null, l.text)));
  }

  // ------------------------------------------------------------------ effects
  function seatXY(pid) {
    const el = document.querySelector(`.seat[data-pid="${pid}"]`), t = $('table').getBoundingClientRect();
    if (!el) return { x: t.width / 2, y: t.height / 2 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - t.left, y: r.top + r.height / 2 - t.top };
  }
  function centerXY(id) {
    const r = $(id).getBoundingClientRect(), t = $('table').getBoundingClientRect();
    return { x: r.left + r.width / 2 - t.left, y: r.top + r.height / 2 - t.top };
  }

  function burst(text, at, cls = '') {
    const b = h('div', { class: 'burst ' + cls, style: { left: at.x + 'px', top: at.y + 'px' } }, text);
    $('fx').append(b);
    setTimeout(() => b.remove(), 1700);
  }

  function fly(card, from, to, done) {
    const el = UnoCards.el(card, { class: 'flycard' });
    const w = $('discard').getBoundingClientRect().width || 100;
    el.style.width = (card ? w : w * 0.6) + 'px';
    el.style.left = to.x - (card ? w : w * 0.6) / 2 + 'px';
    el.style.top = to.y - (card ? w : w * 0.6) * 0.75 + 'px';
    $('fx').append(el);
    const anim = el.animate([
      { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(0.35) rotate(-40deg)`, opacity: 0.6 },
      { transform: `translate(0, 0) scale(1) rotate(${card ? tilt(card.id) : 0}deg)`, opacity: 1 },
    ], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
    anim.onfinish = () => { el.remove(); if (done) done(); };
  }

  function handleEvents() {
    const g = view.game;
    if (lastSeq === null || g.seq < lastSeq) { lastSeq = g.seq; return; }
    for (const ev of g.events) {
      if (ev.seq <= lastSeq) continue;
      const at = ev.pid ? seatXY(ev.pid) : centerXY('discard');
      if (ev.type === 'play') {
        const top = $('discard').lastElementChild;
        if (top) top.style.visibility = 'hidden';
        fly(ev.card, at, centerXY('discard'), () => { if (top) top.style.visibility = ''; });
        if (ev.card.value === 'wild' || ev.card.value === 'wild4') setTimeout(() => burst(COLOUR_NAMES[ev.color] + '!', centerXY('discard'), 'small'), 450);
      } else if (ev.type === 'draw') {
        for (let k = 0; k < Math.min(ev.count, 4); k++) setTimeout(() => fly(null, centerXY('deck'), at), k * 120);
        if (ev.count > 1) burst('+' + ev.count, at, 'red');
      } else if (ev.type === 'skip') {
        burst('⊘ Στοπ', at, 'small');
      } else if (ev.type === 'reverse') {
        const ring = $('ring');
        ring.classList.add('fast');
        setTimeout(() => ring.classList.remove('fast'), 1200);
        burst('⇄', centerXY('discard'));
      } else if (ev.type === 'uno') {
        burst('ΟΥΝΟ!', at);
      } else if (ev.type === 'caught') {
        burst(`Πιάστηκε! +2`, at, 'red');
      } else if (ev.type === 'challenge') {
        burst(ev.won ? 'Σωστή αμφισβήτηση!' : 'Λάθος αμφισβήτηση!', centerXY('discard'), 'small');
      } else if (ev.type === 'color') {
        burst(COLOUR_NAMES[ev.color] + '!', centerXY('discard'), 'small');
      }
    }
    lastSeq = g.seq;
  }

  function renderResults() {
    const g = view.game, box = $('results-screen');
    if (g.phase === 'playing' || !g.roundResult) { box.classList.add('hidden'); return; }
    const res = g.roundResult, over = g.phase === 'gameOver';
    const left = Object.fromEntries(res.hands.map((x) => [x.id, x]));
    const players = g.players.slice().sort((a, b) => b.score - a.score);
    const show = () => {
      if (!view.game || view.game.phase === 'playing') return;
      box.classList.remove('hidden');
      box.replaceChildren(h('div', { class: 'res' },
        h('h1', null, over ? `🏆 ${pname(g.winner)} κέρδισε!` : `${pname(res.winner)} κέρδισε τον γύρο!`),
        h('div', { class: 'sub' }, `+${res.points} πόντοι · ${UNO.targetText(g.target)}`),
        h('table', null,
          h('tr', null, ['#', 'Παίκτης', 'Έμειναν στο χέρι', 'Γύρος', 'Σύνολο'].map((t) => h('th', null, t))),
          players.map((p, i) => h('tr', { class: i === 0 ? 'first' : '' },
            h('td', null, String(i + 1)),
            h('td', null, h('span', { class: 'who' }, avatar(p), p.name)),
            h('td', null, h('div', { class: 'left' }, (left[p.id] ? left[p.id].cards : []).slice(0, 14).map((c) => UnoCards.el(c)))),
            h('td', null, p.id === res.winner ? '+' + res.points : left[p.id] ? `(${left[p.id].points})` : ''),
            h('td', null, h('b', null, String(p.score)))))),
        h('div', { class: 'hint' }, over ? 'Για νέο παιχνίδι: Restart από το admin.' : 'Επόμενος γύρος: πατήστε «Επόμενος γύρος» σε ένα κινητό.')));
    };
    // Let the last card land before covering the table.
    if (box.classList.contains('hidden')) setTimeout(show, 1400); else show();
  }
})();
