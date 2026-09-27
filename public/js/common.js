/* Helpers shared by the TV, phone and admin pages. */
(function (root) {
  'use strict';

  function h(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  }

  /** A round badge with the player's initial in their colour. */
  function avatar(p, size = '') {
    return h('span', { class: 'avatar ' + size, style: { background: p.color } }, (p.name || '?').trim().charAt(0).toUpperCase());
  }

  function toast(msg, kind = '') {
    let box = document.getElementById('toasts');
    if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
    const t = h('div', { class: 'toast ' + kind }, msg);
    box.append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 4000 : 2800);
  }

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } },
  };

  // The player's login: per tab first (several players can share one browser), then per device.
  const playerSession = {
    get() {
      try { const s = JSON.parse(sessionStorage.getItem('uno:session')); if (s) return s; } catch (e) { /* ignore */ }
      return store.get('uno:session');
    },
    set(v) {
      try { sessionStorage.setItem('uno:session', JSON.stringify(v)); } catch (e) { /* ignore */ }
      store.set('uno:session', v);
    },
    del() {
      try { sessionStorage.removeItem('uno:session'); } catch (e) { /* ignore */ }
      store.del('uno:session');
    },
  };

  function connect() {
    const socket = root.io({ transports: ['websocket', 'polling'] });
    const badge = h('div', { class: 'conn hidden' }, 'Σύνδεση…');
    if (document.body) document.body.append(badge);
    else document.addEventListener('DOMContentLoaded', () => document.body.append(badge));
    socket.on('connect', () => badge.classList.add('hidden'));
    socket.on('disconnect', () => badge.classList.remove('hidden'));
    socket.request = (event, payload) => new Promise((resolve, reject) => {
      socket.timeout(10000).emit(event, payload, (err, res) => {
        if (err) return reject(new Error('Δεν απαντάει ο server'));
        if (!res || !res.ok) return reject(new Error((res && res.error) || 'Σφάλμα'));
        resolve(res);
      });
    });
    return socket;
  }

  /** Free Render instances sleep without HTTP traffic; ping while a page is open. */
  function keepAlive() {
    setInterval(() => fetch('/api/ping', { cache: 'no-store' }).catch(() => {}), 4 * 60 * 1000);
  }

  function keepAwake() {
    let lock = null;
    const req = async () => {
      try { if ('wakeLock' in navigator && !lock) lock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ }
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { lock = null; req(); } });
    req();
  }

  const targetText = (t) => (t ? `νίκη στους ${t} πόντους` : 'ένας γύρος');

  root.UNO = { h, avatar, toast, store, playerSession, connect, keepAlive, keepAwake, targetText };
})(window);
