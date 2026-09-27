'use strict';
/*
 * Game rooms: a 4-digit code, the people who joined it, the settings and the current game.
 * Rooms are kept in memory and mirrored to a JSON file so a server restart doesn't lose a game.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const G = require('./game');
const R = require('../public/js/uno-rules.js');

const IDLE_ROOM_MS = 1000 * 60 * 60 * 48;
const TARGETS = [0, 100, 200, 300, 500];

const hashPin = (code, name, pin) =>
  crypto.createHash('sha256').update(`${code}|${name.toLowerCase()}|${pin}`).digest('hex');
const newId = (bytes = 6) => crypto.randomBytes(bytes).toString('hex');

class Rooms {
  constructor({ dataFile } = {}) {
    this.rooms = new Map();
    this.dataFile = dataFile;
    this.saveTimer = null;
    this.load();
  }

  // ------------------------------------------------------------ persistence
  load() {
    if (!this.dataFile || !fs.existsSync(this.dataFile)) return;
    try {
      for (const r of JSON.parse(fs.readFileSync(this.dataFile, 'utf8'))) this.rooms.set(r.code, r);
      console.log(`Loaded ${this.rooms.size} room(s) from ${this.dataFile}`);
    } catch (e) {
      console.error('Could not read saved rooms:', e.message);
    }
  }

  save() {
    if (!this.dataFile) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
        const tmp = this.dataFile + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify([...this.rooms.values()]));
        fs.renameSync(tmp, this.dataFile);
      } catch (e) {
        console.error('Could not save rooms:', e.message);
      }
    }, 500);
  }

  touch(room) {
    room.updatedAt = Date.now();
    this.save();
  }

  prune() {
    const now = Date.now();
    for (const [code, r] of this.rooms) if (now - r.updatedAt > IDLE_ROOM_MS) this.rooms.delete(code);
  }

  // ------------------------------------------------------------ rooms
  create() {
    this.prune();
    if (this.rooms.size >= 9000) throw new G.GameError('Υπάρχουν πάρα πολλά ανοιχτά παιχνίδια');
    let code;
    do code = String(1000 + crypto.randomInt(9000)); while (this.rooms.has(code));
    const room = { code, createdAt: Date.now(), updatedAt: Date.now(), members: [], settings: { target: 500 }, game: null, gameNo: 0 };
    this.rooms.set(code, room);
    this.save();
    return room;
  }

  get(code) {
    return this.rooms.get(String(code || '').trim()) || null;
  }

  close(code) {
    this.rooms.delete(code);
    this.save();
  }

  phase(room) {
    return room.game ? room.game.phase : 'lobby';
  }

  list() {
    return [...this.rooms.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        code: r.code, phase: this.phase(r), createdAt: r.createdAt, gameNo: r.gameNo, settings: r.settings,
        round: r.game ? r.game.round : 0,
        members: r.members.map((m) => ({ id: m.id, name: m.name, color: m.color })),
        current: r.game && r.game.phase === 'playing' ? r.game.players[r.game.current].id : null,
      }));
  }

  setTarget(room, target) {
    if (!TARGETS.includes(target)) throw new G.GameError('Μη έγκυρος στόχος πόντων');
    room.settings.target = target;
    this.touch(room);
  }

  // ------------------------------------------------------------ members
  join(room, { name, pin }) {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    pin = String(pin || '').trim();
    if (name.length < 1 || name.length > 14) throw new G.GameError('Το όνομα πρέπει να έχει 1–14 χαρακτήρες');
    if (!/^\d{4}$/.test(pin)) throw new G.GameError('Το PIN πρέπει να είναι 4 ψηφία');
    const existing = room.members.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (existing.pinHash !== hashPin(room.code, name, pin)) throw new G.GameError('Το όνομα υπάρχει ήδη με άλλο PIN');
      return existing;
    }
    if (room.game) throw new G.GameError('Το παιχνίδι έχει ξεκινήσει. Μπες με το όνομα και το PIN που έδωσες.');
    if (room.members.length >= R.MAX_PLAYERS) throw new G.GameError(`Το παιχνίδι είναι γεμάτο (${R.MAX_PLAYERS} παίκτες)`);
    const taken = new Set(room.members.map((m) => m.color));
    const member = {
      id: newId(), name, pinHash: hashPin(room.code, name, pin),
      color: G.PLAYER_COLORS.find((c) => !taken.has(c)),
      token: newId(16), joinedAt: Date.now(),
    };
    room.members.push(member);
    this.touch(room);
    return member;
  }

  byToken(room, token) {
    return (token && room.members.find((m) => m.token === token)) || null;
  }

  kick(room, memberId) {
    if (room.game) throw new G.GameError('Αφαίρεση παίκτη γίνεται μόνο πριν ξεκινήσει το παιχνίδι');
    room.members = room.members.filter((m) => m.id !== memberId);
    this.touch(room);
  }

  // ------------------------------------------------------------ games
  start(room) {
    if (room.members.length < R.MIN_PLAYERS) throw new G.GameError('Χρειάζονται τουλάχιστον 2 παίκτες');
    room.game = G.newGame(room.members.map((m) => ({ id: m.id, name: m.name, color: m.color })), { target: room.settings.target });
    room.gameNo++;
    this.touch(room);
  }

  toLobby(room) {
    room.game = null;
    this.touch(room);
  }

  action(room, memberId, action) {
    if (!room.game) throw new G.GameError('Το παιχνίδι δεν έχει ξεκινήσει');
    G.applyAction(room.game, memberId, action);
    this.touch(room);
  }

  skip(room) {
    if (!room.game) throw new G.GameError('Το παιχνίδι δεν έχει ξεκινήσει');
    G.skipTurn(room.game);
    this.touch(room);
  }

  nextRound(room) {
    if (!room.game || room.game.phase !== 'roundOver') throw new G.GameError('Ο γύρος δεν έχει τελειώσει');
    room.game.seq++;
    G.startRound(room.game, Math.random);
    this.touch(room);
  }
}

module.exports = { Rooms, TARGETS };
