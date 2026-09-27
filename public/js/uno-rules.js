/*
 * UNO basics shared by the server (game engine) and the phones (which cards light up).
 * A card is { id, color, value }:
 *   color: 'red' | 'yellow' | 'green' | 'blue' | 'wild'
 *   value: '0'..'9' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4'
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UnoRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLORS = ['red', 'yellow', 'green', 'blue'];
  const ACTIONS = ['skip', 'reverse', 'draw2'];
  const HAND_SIZE = 7;
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 10;

  /** The classic 108-card deck: per colour one 0, two of 1–9, two of each action; 4 Wild, 4 Wild Draw Four. */
  function buildDeck() {
    const cards = [];
    const add = (color, value) => cards.push({ id: cards.length, color, value });
    for (const color of COLORS) {
      add(color, '0');
      for (let n = 1; n <= 9; n++) { add(color, String(n)); add(color, String(n)); }
      for (const a of ACTIONS) { add(color, a); add(color, a); }
    }
    for (let i = 0; i < 4; i++) add('wild', 'wild');
    for (let i = 0; i < 4; i++) add('wild', 'wild4');
    return cards;
  }

  /** Can `card` go on `top` when the colour in play is `color`? */
  function canPlay(card, top, color) {
    if (card.color === 'wild') return true;
    if (card.color === color) return true;
    return top.color !== 'wild' && card.value === top.value;
  }

  function points(card) {
    if (card.color === 'wild') return 50;
    if (ACTIONS.includes(card.value)) return 20;
    return Number(card.value);
  }

  // Display order for a hand: by colour, then number, then actions, wilds last.
  const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2', 'wild', 'wild4'];
  function sortHand(hand) {
    const ci = (c) => (c.color === 'wild' ? 9 : COLORS.indexOf(c.color));
    return hand.slice().sort((a, b) => ci(a) - ci(b) || VALUE_ORDER.indexOf(a.value) - VALUE_ORDER.indexOf(b.value) || a.id - b.id);
  }

  return { COLORS, ACTIONS, HAND_SIZE, MIN_PLAYERS, MAX_PLAYERS, buildDeck, canPlay, points, sortHand };
});
