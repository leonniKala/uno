/* Phone view: a player's hand and moves. */
(function () {
  'use strict';
  const { h, toast, avatar } = UNO;
  const { COLOUR_NAMES, FILL } = UnoCards;
  const $ = (id) => document.getElementById(id);

  const code = new URLSearchParams(location.search).get('code');
  const session = UNO.playerSession.get();
  if (!code || !session || session.code !== code || !session.token) {
    location.replace('/?code=' + (code || ''));
    return;
  }

  const socket = UNO.connect();
  UNO.keepAlive();
  UNO.keepAwake();
  let view = null;
  const ui = { selected: null, sheet: null, wildCard: null, prevIds: null, lastSeq: null, wasMyTurn: false, resultsFor: null, renderedKey: null };

  socket.on('connect', async () => {
    try {
      await socket.request('hello', { role: 'player', code, token: session.token });
    } catch (e) {
      toast(e.message, 'error');
      if (/έληξε|Δεν υπάρχει/.test(e.message)) { UNO.playerSession.del(); setTimeout(() => location.replace('/?code=' + code), 1800); }
    }
  });
  socket.on('state', (v) => { view = v; render(); });
  socket.on('closed', () => {
    toast('Ο admin έκλεισε αυτό το παιχνίδι');
    UNO.playerSession.del();
    setTimeout(() => location.replace('/'), 2000);
  });

  async function act(payload) {
    try {
      await socket.request('action', payload);
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  }

  const game = () => view && view.game;
  const me = () => view && view.me;
  const myId = () => view && view.myId;
  const pname = (id) => { const p = game().players.find((x) => x.id === id); return p ? p.name : '?'; };
  const isMyTurn = () => game() && game().phase === 'playing' && game().current === myId() && !game().pending;
  const vibrate = (p) => { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(p); };

  // ------------------------------------------------------------------ render
  function render() {
    if (!view) return;
    const { room } = view;
    const member = room.members.find((m) => m.id === myId());
    if (!member) {
      toast('Ο admin σε αφαίρεσε από το παιχνίδι', 'error');
      UNO.playerSession.del();
      socket.close();
      setTimeout(() => location.replace('/?code=' + code), 2000);
      return;
    }
    $('me-av').replaceChildren(avatar(member));
    $('me-name').textContent = member.name;
    const g = game();
    const pub = g && g.players.find((p) => p.id === myId());
    $('me-score').textContent = pub ? pub.score : 0;
    $('round-lbl').textContent = g ? `Γύρος ${g.round}` : '';

    const inLobby = !g;
    $('lobby').classList.toggle('hidden', !inLobby);
    $('game').classList.toggle('hidden', inLobby);
    if (inLobby) { closeSheet(); renderLobby(); return; }
    document.body.style.setProperty('--tint', g.color ? FILL[g.color] : '#555');
    renderStatus();
    renderTable();
    renderOthers();
    renderActions();
    renderHand();
    feedback();
    renderSheet();
  }

  function renderLobby() {
    const { room } = view;
    $('status').className = '';
    $('status').textContent = `Παιχνίδι ${room.code} · περιμένουμε να ξεκινήσει`;
    $('lobby').replaceChildren(
      h('h1', null, 'Είσαι μέσα!'),
      h('div', { class: 'muted' }, `Ο admin θα ξεκινήσει όταν μπουν όλοι (${UNO.targetText(room.settings.target)}). Κράτα αυτή τη σελίδα ανοιχτή.`),
      h('div', { class: 'members' }, room.members.map((m) => h('div', { class: 'member' },
        avatar(m), m.name + (m.id === myId() ? ' (εσύ)' : ''),
        h('span', { class: 'on' + (m.online ? ' yes' : '') }, m.online ? 'συνδεδεμένος' : 'εκτός')))),
      h('button', { class: 'btn ghost small', onclick: () => { UNO.playerSession.del(); location.href = '/'; } }, 'Έξοδος από αυτό το κινητό'));
  }

  function renderStatus() {
    const g = game(), st = $('status');
    st.className = '';
    if (g.phase === 'roundOver') { st.textContent = `Τέλος γύρου · κέρδισε ${pname(g.roundResult.winner)}`; return; }
    if (g.phase === 'gameOver') { st.textContent = `Τέλος παιχνιδιού · νικητής ${pname(g.winner)}`; return; }
    const pend = g.pending;
    if (pend && pend.type === 'wild4' && pend.target === myId()) { st.className = 'alert'; st.textContent = '+4 για σένα! Δέξου ή αμφισβήτησε'; return; }
    if (pend && pend.type === 'startColor' && pend.pid === myId()) { st.className = 'myturn'; st.textContent = 'Διάλεξε χρώμα για να ξεκινήσει ο γύρος'; return; }
    if (isMyTurn()) {
      st.className = 'myturn';
      st.textContent = g.drew ? 'Παίξε την κάρτα που τράβηξες ή πάσο' : me().playable.length ? 'Σειρά σου! Παίξε μια κάρτα' : 'Σειρά σου! Δεν έχεις κάρτα που ταιριάζει: τράβα';
      return;
    }
    const cur = g.players.find((p) => p.id === (pend ? pend.target || pend.pid : g.current));
    st.textContent = pend && pend.type === 'wild4' ? `${cur.name}: +4, αποφασίζει…` : `Παίζει: ${cur.name}`;
  }

  function renderTable() {
    const g = game();
    $('topcard-card').replaceChildren(UnoCards.el(g.top));
    $('pile-card').replaceChildren(UnoCards.el(null));
    const canDraw = isMyTurn() && !g.drew;
    $('pile').classList.toggle('active', canDraw && !me().playable.length);
    $('pile-lbl').textContent = `Τράβα (${g.deckCount})`;
    $('dir').classList.toggle('ccw', g.direction < 0);
    $('color-lbl').replaceChildren(g.color ? h('span', null, h('span', { class: 'cdot ' + g.color }), ' ', COLOUR_NAMES[g.color]) : 'χρώμα;');
  }

  function renderOthers() {
    const g = game(), box = $('others');
    box.textContent = '';
    for (const p of g.players) {
      if (p.id === myId()) continue;
      const forgot = g.unoWindow && g.unoWindow.pid === p.id;
      box.append(h('div', { class: 'opp' + (g.current === p.id ? ' current' : '') },
        avatar(p), p.name, h('span', { class: 'cnt' }, String(p.count)),
        p.count === 1 && (p.uno ? h('span', { class: 'uno' }, 'ΟΥΝΟ') : forgot ? h('span', { class: 'uno forgot' }, 'ξέχασε!') : null)));
    }
  }

  function renderActions() {
    const g = game(), m = me(), box = $('actions');
    box.textContent = '';
    if (g.phase !== 'playing') return;
    const w = g.unoWindow;
    if (w && w.pid !== myId()) {
      box.append(h('button', { class: 'btn yellow', onclick: () => act({ type: 'catch', target: w.pid }) }, `Πιάσε ${pname(w.pid)}! (+2)`));
    }
    const sel = selectedCard();
    if (isMyTurn() && sel) box.append(h('button', { class: 'btn primary', onclick: () => playCard(sel) }, 'Παίξε ▶'));
    if (isMyTurn() && g.drew) box.append(h('button', { class: 'btn', onclick: () => act({ type: 'pass' }) }, 'Πάσο'));
    box.append(h('button', { id: 'uno-btn', class: 'btn primary' + (m.canUno ? ' hot' : ''), disabled: !m.canUno, onclick: () => act({ type: 'uno' }) }, 'ΟΥΝΟ!'));
  }

  const selectedCard = () => me().hand.find((c) => c.id === ui.selected && me().playable.includes(c.id)) || null;

  function renderHand() {
    const m = me(), box = $('hand');
    const hand = m.hand, ids = hand.map((c) => c.id);
    const fresh = ui.prevIds ? ids.filter((id) => !ui.prevIds.includes(id)) : [];
    ui.prevIds = ids;
    if (ui.selected !== null && !m.playable.includes(ui.selected)) ui.selected = null;
    if (m.drawn !== null && m.playable.includes(m.drawn)) ui.selected = ui.selected === null ? m.drawn : ui.selected;
    box.textContent = '';
    if (!hand.length) { box.append(h('div', { class: 'hand-empty' }, 'Δεν έχεις κάρτες')); return; }

    // Lay the cards out in overlapping rows that fit the screen.
    const W = box.clientWidth, H = box.clientHeight;
    const cw = Math.min(96, Math.max(58, (H - 30) / 1.5 / (hand.length > 12 ? 1.6 : 1)));
    const ch = cw * 1.5;
    const perRow = Math.max(1, Math.floor((W - cw) / Math.max(22, cw * 0.32)) + 1);
    const rows = Math.ceil(hand.length / perRow);
    const rowStep = rows > 1 ? Math.min(ch * 0.55, (H - ch - 16) / (rows - 1)) : 0;
    const myTurn = isMyTurn();
    hand.forEach((c, i) => {
      const r = Math.floor(i / perRow), inRow = Math.min(perRow, hand.length - r * perRow), k = i - r * perRow;
      const step = inRow > 1 ? Math.min(cw + 6, (W - cw) / (inRow - 1)) : 0;
      const rowW = cw + step * (inRow - 1);
      const el = UnoCards.el(c);
      const ok = myTurn && m.playable.includes(c.id);
      el.classList.toggle('ok', ok);
      el.classList.toggle('dim', myTurn && !ok);
      el.classList.toggle('sel', ok && ui.selected === c.id);
      if (fresh.includes(c.id)) el.classList.add('new');
      // Rows sit at the bottom of the screen, within thumb reach.
      const top = Math.max(26, H - ch - 14 - (rows - 1) * rowStep) + r * rowStep;
      Object.assign(el.style, { width: cw + 'px', left: (W - rowW) / 2 + k * step + 'px', top: top + 'px', zIndex: String(i + 1) });
      el.addEventListener('click', () => onCard(c, el));
      box.append(el);
    });
  }

  function onCard(c, el) {
    const m = me();
    if (!isMyTurn()) { toast(game().pending ? 'Περίμενε…' : `Παίζει ${pname(game().current)}`); return; }
    if (!m.playable.includes(c.id)) {
      el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
      toast(game().drew ? 'Μπορείς να παίξεις μόνο την κάρτα που τράβηξες' : 'Αυτή η κάρτα δεν ταιριάζει', 'error');
      return;
    }
    if (ui.selected === c.id) return playCard(c);
    ui.selected = c.id;
    render();
  }

  function playCard(c) {
    if (c.color === 'wild') { ui.wildCard = c; openSheet('color'); return; }
    ui.selected = null;
    act({ type: 'play', cardId: c.id });
  }

  function feedback() {
    const g = game();
    const mine = isMyTurn() || (g.pending && (g.pending.target === myId() || g.pending.pid === myId()));
    if (mine && !ui.wasMyTurn) vibrate([120, 60, 120]);
    ui.wasMyTurn = !!mine;
    if (ui.lastSeq === null || g.seq < ui.lastSeq) { ui.lastSeq = g.seq; return; }
    for (const ev of g.events) {
      if (ev.seq <= ui.lastSeq) continue;
      if (ev.type === 'draw' && ev.pid === myId() && ev.count > 1) toast(`Τράβηξες ${ev.count} κάρτες`, 'error');
      if (ev.type === 'caught' && ev.pid === myId()) { toast(`Σε έπιασε ${pname(ev.by)} χωρίς ΟΥΝΟ! +2`, 'error'); vibrate(300); }
      if (ev.type === 'caught' && ev.by === myId()) toast(`Έπιασες ${pname(ev.pid)}! Τραβάει 2`, 'ok');
      if (ev.type === 'challenge' && (ev.pid === myId() || ev.from === myId())) {
        const iChallenged = ev.pid === myId();
        toast(ev.won === iChallenged ? 'Κέρδισες την αμφισβήτηση!' : 'Έχασες την αμφισβήτηση', ev.won === iChallenged ? 'ok' : 'error');
      }
      if (ev.type === 'skip' && ev.pid === myId()) toast('Χάνεις τη σειρά σου');
    }
    ui.lastSeq = g.seq;
  }

  // ------------------------------------------------------------------ sheets
  function openSheet(kind) { ui.sheet = kind; renderSheet(); }
  function closeSheet() { ui.sheet = null; ui.renderedKey = null; $('sheet-root').textContent = ''; }

  function shell(title, sub, body, { closable = true, actions = [] } = {}) {
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (closable && e.target === overlay) closeSheet(); } });
    const acts = actions.slice();
    if (closable) acts.push(h('button', { class: 'btn ghost', onclick: closeSheet }, 'Κλείσιμο'));
    overlay.append(h('div', { class: 'sheet' }, h('h2', null, title), sub ? h('div', { class: 'sub' }, sub) : null, body,
      acts.length ? h('div', { class: 'actions' }, acts) : null));
    return overlay;
  }

  function colorPicker(onPick) {
    return h('div', { class: 'colors' }, ['red', 'yellow', 'green', 'blue'].map((c) =>
      h('button', { class: c, onclick: () => onPick(c) }, COLOUR_NAMES[c])));
  }

  function renderSheet() {
    const g = game(), root = $('sheet-root');
    let node = null, key = null;
    const pend = g && g.pending;
    if (pend && pend.type === 'startColor' && pend.pid === myId()) {
      key = 'start';
      node = shell('Διάλεξε χρώμα', 'Ο γύρος ξεκίνησε με μπαλαντέρ: εσύ διαλέγεις το χρώμα.', colorPicker((c) => act({ type: 'chooseColor', color: c })), { closable: false });
    } else if (pend && pend.type === 'wild4' && pend.target === myId()) {
      key = 'wild4';
      node = shell('+4 για σένα!', `${pname(pend.from)} έπαιξε Μπαλαντέρ +4.`,
        h('div', { class: 'sub' }, 'Αν πιστεύεις ότι είχε κι άλλη κάρτα στο χρώμα που έπαιζε, αμφισβήτησέ το: αν έχεις δίκιο τραβάει αυτός 4 και παίζεις κανονικά, αν όχι τραβάς εσύ 6.'),
        { closable: false, actions: [
          h('button', { class: 'btn primary', onclick: () => act({ type: 'accept' }) }, 'Δέξου (+4)'),
          h('button', { class: 'btn yellow', onclick: () => act({ type: 'challenge' }) }, 'Αμφισβήτησε'),
        ] });
    } else if (g && (g.phase === 'roundOver' || g.phase === 'gameOver') && ui.resultsFor !== `${g.round}:${g.phase}:closed`) {
      key = 'results:' + g.round + g.phase;
      node = resultsSheet(g);
    } else if (ui.sheet === 'color' && ui.wildCard && isMyTurn()) {
      key = 'color';
      node = shell('Διάλεξε χρώμα', UnoCards.name(ui.wildCard), colorPicker((c) => {
        const card = ui.wildCard;
        ui.wildCard = null; ui.selected = null; closeSheet();
        act({ type: 'play', cardId: card.id, color: c });
      }));
    }
    const same = node && key === ui.renderedKey;
    root.textContent = '';
    ui.renderedKey = node ? key : null;
    if (node) {
      root.append(node);
      if (same) node.querySelector('.sheet').style.animation = 'none';
    }
  }

  function resultsSheet(g) {
    const res = g.roundResult, over = g.phase === 'gameOver';
    const players = g.players.slice().sort((a, b) => b.score - a.score);
    const table = h('table', { class: 'scores' },
      h('tr', null, ['#', 'Παίκτης', 'Γύρος', 'Σύνολο'].map((t) => h('th', null, t))),
      players.map((p, i) => h('tr', { class: i === 0 ? 'win' : '' },
        h('td', null, String(i + 1)),
        h('td', null, h('span', { class: 'who' }, avatar(p), p.name)),
        h('td', null, p.id === res.winner ? '+' + res.points : '–'),
        h('td', null, h('b', null, String(p.score))))));
    const hands = h('div', { style: { marginTop: '14px' } }, res.hands.filter((x) => x.cards.length).map((x) => [
      h('div', { class: 'muted', style: { fontSize: '13px', fontWeight: '700' } }, `${pname(x.id)}: ${x.points} πόντοι`),
      h('div', { class: 'res-hand' }, x.cards.map((c) => UnoCards.el(c))),
    ]));
    const actions = [];
    if (!over) actions.push(h('button', { class: 'btn primary', onclick: () => act({ type: 'nextRound' }) }, 'Επόμενος γύρος'));
    actions.push(h('button', { class: 'btn ghost', onclick: () => { ui.resultsFor = `${g.round}:${g.phase}:closed`; closeSheet(); } }, 'Κλείσιμο'));
    const title = over ? (g.winner === myId() ? 'Κέρδισες το παιχνίδι! 🎉' : `Νικητής: ${pname(g.winner)}`) : (res.winner === myId() ? 'Κέρδισες τον γύρο!' : `Τον γύρο κέρδισε ${pname(res.winner)}`);
    return shell(title, over ? `Τελικό σκορ (${UNO.targetText(g.target)})` : `+${res.points} πόντοι · ${UNO.targetText(g.target)}`, h('div', null, table, hands), { closable: false, actions });
  }

  $('pile').addEventListener('click', () => {
    const g = game();
    if (!g || !isMyTurn()) return toast(g && g.pending ? 'Περίμενε…' : 'Δεν είναι η σειρά σου');
    if (g.drew) return toast('Έχεις ήδη τραβήξει: παίξε την κάρτα ή πάσο');
    ui.selected = null;
    act({ type: 'draw' });
  });
  window.addEventListener('resize', () => { if (view && game()) renderHand(); });
})();
