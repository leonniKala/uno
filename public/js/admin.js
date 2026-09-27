/* Admin page: create games and control them. */
(function () {
  'use strict';
  const { h, toast, store, avatar } = UNO;
  const $ = (id) => document.getElementById(id);
  const socket = UNO.connect();
  let rooms = [], freshCode = null;

  const PHASES = { lobby: 'Αναμονή παικτών', playing: 'Σε εξέλιξη', roundOver: 'Τέλος γύρου', gameOver: 'Τελείωσε' };
  const TARGETS = [[500, '500 πόντοι'], [300, '300 πόντοι'], [200, '200 πόντοι'], [100, '100 πόντοι'], [0, 'Ένας γύρος']];

  async function login(payload) {
    try {
      const r = await socket.request('admin:login', payload);
      store.set('uno:admin', r.token);
      $('login').classList.add('hidden');
      $('main').classList.remove('hidden');
    } catch (e) {
      store.del('uno:admin');
      $('main').classList.add('hidden');
      $('login').classList.remove('hidden');
      if (payload.password !== undefined) $('login-err').textContent = e.message;
    }
  }
  socket.on('connect', () => {
    const token = store.get('uno:admin');
    if (token) login({ token }); else $('login').classList.remove('hidden');
  });
  $('login').addEventListener('submit', (e) => { e.preventDefault(); login({ password: $('pw').value }); });
  $('logout').addEventListener('click', () => { store.del('uno:admin'); location.reload(); });
  socket.on('admin:rooms', (list) => { rooms = list; render(); });

  async function cmd(event, payload, confirmText) {
    if (confirmText && !confirm(confirmText)) return null;
    try {
      return await socket.request(event, payload);
    } catch (e) {
      toast(e.message, 'error');
      return null;
    }
  }

  $('new').addEventListener('click', async () => {
    const r = await cmd('admin:create', {});
    if (r) { freshCode = r.code; toast(`Νέο παιχνίδι: ${r.code}`, 'ok'); render(); }
  });

  function render() {
    const box = $('rooms');
    box.textContent = '';
    if (!rooms.length) return box.append(h('div', { class: 'empty' }, 'Δεν υπάρχει ανοιχτό παιχνίδι. Πάτα «Νέο παιχνίδι».'));
    for (const r of rooms) {
      const code = r.code;
      const btns = h('div', { class: 'btns' });
      if (r.phase === 'lobby') {
        const sel = h('select', { onchange: (e) => cmd('admin:target', { code, target: Number(e.target.value) }) },
          TARGETS.map(([v, label]) => h('option', { value: v, selected: r.settings.target === v }, label)));
        btns.append(
          h('button', { class: 'btn primary', disabled: r.members.length < 2, onclick: () => cmd('admin:start', { code }) },
            r.members.length < 2 ? 'Έναρξη (θέλει 2+ παίκτες)' : `Έναρξη με ${r.members.length} παίκτες`),
          sel);
      } else {
        if (r.phase === 'roundOver') btns.append(h('button', { class: 'btn primary', onclick: () => cmd('admin:next', { code }) }, 'Επόμενος γύρος'));
        btns.append(h('button', { class: 'btn yellow', onclick: () => cmd('admin:restart', { code }, 'Restart: νέο παιχνίδι από το μηδέν με τους ίδιους παίκτες. Σίγουρα;') }, 'Restart'));
        btns.append(h('button', { class: 'btn', onclick: () => cmd('admin:lobby', { code }, 'Επιστροφή στην αναμονή: το τρέχον παιχνίδι χάνεται, οι παίκτες μένουν και μπορούν να μπουν κι άλλοι. Σίγουρα;') }, 'Πίσω στην αναμονή'));
        if (r.phase === 'playing') {
          const cur = r.members.find((m) => m.id === r.current);
          btns.append(h('button', { class: 'btn', onclick: () => cmd('admin:skip', { code }, `Παράλειψη της σειράς του/της ${cur ? cur.name : ''};`) }, 'Παράλειψη σειράς'));
        }
      }
      btns.append(h('button', { class: 'btn danger', onclick: () => cmd('admin:close', { code }, `Κλείσιμο του παιχνιδιού ${code}; Όλοι αποσυνδέονται.`) }, 'Κλείσιμο'));

      box.append(h('div', { class: 'room' + (code === freshCode ? ' fresh' : '') },
        h('div', { class: 'room-head' },
          h('div', { class: 'room-code' }, code),
          h('span', { class: 'phase ' + r.phase }, PHASES[r.phase] || r.phase),
          h('span', { class: 'muted' }, (r.round ? `γύρος ${r.round} · ` : '') + UNO.targetText(r.settings.target)),
          h('div', { class: 'qr' }, h('img', { src: `/api/qr/${code}`, alt: 'QR' }))),
        h('div', { class: 'links' },
          h('a', { href: `/tv?code=${code}`, target: '_blank' }, 'Άνοιγμα στην τηλεόραση ↗'),
          h('a', { href: `/?code=${code}`, target: '_blank' }, 'Link για παίκτες ↗'),
          h('span', { class: 'muted' }, `${location.origin}/?code=${code}`)),
        h('div', { class: 'members' },
          r.members.length ? r.members.map((m) => h('div', { class: 'mem' + (m.id === r.current ? ' current' : '') },
            avatar(m), m.name,
            r.phase === 'lobby' ? h('button', { title: 'Αφαίρεση', onclick: () => cmd('admin:kick', { code, memberId: m.id }, `Αφαίρεση του/της ${m.name};`) }, '×') : null))
            : h('span', { class: 'muted' }, 'Δεν έχει μπει κανείς ακόμα.')),
        btns));
    }
  }
})();
