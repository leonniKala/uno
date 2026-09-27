/*
 * UNO cards drawn as SVG.
 *   UnoCards.svg(card)        → SVG markup for a card ({ color, value }) or UnoCards.svg(null) for the back
 *   UnoCards.el(card, extra)  → a <div class="card"> element containing it
 */
(function (root) {
  'use strict';

  const FILL = { red: '#e03a2f', yellow: '#f4c20d', green: '#2ea043', blue: '#1e6fd9', wild: '#1b1b1d' };
  const DARK = '#1b1b1d';
  const FONT = "'Archivo Black', 'Arial Black', Impact, sans-serif";
  let uid = 0;

  // Symbols are drawn around (0, 0), about 90 units tall, in colour `c`.
  function symbol(card, c, big) {
    const v = card.value;
    const o = `stroke="${DARK}" stroke-linejoin="round" paint-order="stroke"`;
    if (/^\d$/.test(v)) {
      const underline = v === '6' || v === '9' ? `<rect x="-16" y="30" width="32" height="7" rx="3" fill="${c}" stroke="${DARK}" stroke-width="3"/>` : '';
      return `<text x="0" y="27" text-anchor="middle" font-family="${FONT}" font-size="${big ? 76 : 80}" fill="${c}" ${o} stroke-width="${big ? 5 : 7}">${v}</text>${underline}`;
    }
    if (v === 'skip') {
      return `<g fill="none" stroke-linecap="round">
        <circle r="26" stroke="${DARK}" stroke-width="17"/><line x1="-18" y1="18" x2="18" y2="-18" stroke="${DARK}" stroke-width="17"/>
        <circle r="26" stroke="${c}" stroke-width="10"/><line x1="-18" y1="18" x2="18" y2="-18" stroke="${c}" stroke-width="10"/></g>`;
    }
    if (v === 'reverse') {
      const arrow = 'M-9 22 V-4 H-19 L0 -28 L19 -4 H9 V22 Z';
      return `<g stroke="${DARK}" stroke-width="5" stroke-linejoin="round" fill="${c}">
        <path d="${arrow}" transform="rotate(45) translate(-12 -2)"/>
        <path d="${arrow}" transform="rotate(225) translate(-12 -2)"/></g>`;
    }
    if (v === 'draw2' || v === 'wild4') {
      return `<text x="0" y="20" text-anchor="middle" font-family="${FONT}" font-size="54" fill="${c}" ${o} stroke-width="6">${v === 'draw2' ? '+2' : '+4'}</text>`;
    }
    return '';
  }

  function fourColourOval(id, cx, cy, rx, ry, rot) {
    return `<clipPath id="${id}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})"/></clipPath>
      <g clip-path="url(#${id})">
        <rect x="${cx - 80}" y="${cy - 100}" width="80" height="100" fill="${FILL.red}"/>
        <rect x="${cx}" y="${cy - 100}" width="80" height="100" fill="${FILL.blue}"/>
        <rect x="${cx - 80}" y="${cy}" width="80" height="100" fill="${FILL.yellow}"/>
        <rect x="${cx}" y="${cy}" width="80" height="100" fill="${FILL.green}"/>
      </g>`;
  }

  function svg(card) {
    const id = 'uc' + (++uid);
    if (!card) {
      return `<svg viewBox="0 0 120 180" xmlns="http://www.w3.org/2000/svg" class="card-svg">
        <rect width="120" height="180" rx="14" fill="#fff"/><rect x="6" y="6" width="108" height="168" rx="10" fill="${DARK}"/>
        <ellipse cx="60" cy="90" rx="40" ry="70" transform="rotate(28 60 90)" fill="${FILL.red}"/>
        <text x="60" y="104" text-anchor="middle" font-family="${FONT}" font-size="38" fill="${FILL.yellow}" stroke="${DARK}" stroke-width="5" paint-order="stroke" transform="rotate(-22 60 90)">UNO</text></svg>`;
    }
    const wild = card.color === 'wild';
    const colour = FILL[card.color];
    const centre = wild
      ? fourColourOval(id, 60, 90, 38, 64, 28) + (card.value === 'wild4' ? `<g transform="translate(60 90)">${symbol(card, '#fff', true)}</g>` : '')
      : `<ellipse cx="60" cy="90" rx="40" ry="68" transform="rotate(28 60 90)" fill="#fff"/><g transform="translate(60 90)">${symbol(card, colour, true)}</g>`;
    const corner = wild
      ? (card.value === 'wild4' ? symbol(card, '#fff') : `<ellipse rx="22" ry="34" transform="rotate(28)" fill="#fff" stroke="${DARK}" stroke-width="5"/>`)
      : symbol(card, '#fff');
    return `<svg viewBox="0 0 120 180" xmlns="http://www.w3.org/2000/svg" class="card-svg">
      <rect width="120" height="180" rx="14" fill="#fff"/>
      <rect x="6" y="6" width="108" height="168" rx="10" fill="${colour}"/>
      ${centre}
      <g transform="translate(22 30) scale(0.3)">${corner}</g>
      <g transform="translate(98 150) rotate(180) scale(0.3)">${corner}</g></svg>`;
  }

  function el(card, extra = {}) {
    const d = document.createElement('div');
    d.className = 'card' + (extra.class ? ' ' + extra.class : '');
    d.innerHTML = svg(card);
    if (card) { d.dataset.id = card.id; d.dataset.color = card.color; d.dataset.value = card.value; }
    return d;
  }

  const NAMES = { skip: 'Στοπ', reverse: 'Αλλαγή φοράς', draw2: '+2', wild: 'Μπαλαντέρ', wild4: 'Μπαλαντέρ +4' };
  const COLOUR_NAMES = { red: 'Κόκκινο', yellow: 'Κίτρινο', green: 'Πράσινο', blue: 'Μπλε' };
  const name = (c) => (c.color === 'wild' ? NAMES[c.value] : `${NAMES[c.value] || c.value} ${COLOUR_NAMES[c.color].toLowerCase()}`);

  root.UnoCards = { svg, el, FILL, COLOUR_NAMES, name };
})(window);
