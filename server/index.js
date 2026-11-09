'use strict';
/* Kasino – server: statiska filer + WebSocket-rum */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { upgrade } = require('./ws');
const R = require('../shared/rules');
const Bot = require('./bot');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const MAX_SEATS = 4;
const BOT_NAMES = ['Bosse', 'Greta', 'Sixten', 'Majken', 'Ture', 'Dagny', 'Stig', 'Elvy'];
const LEVEL_NAME = { easy: 'Lätt', medium: 'Medel', hard: 'Svår' };

// ---------- Statiska filer ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  let file;
  if (p === '/shared/rules.js') file = path.join(ROOT, 'shared', 'rules.js');
  else {
    if (p === '/' || !path.extname(p)) p = '/index.html';
    file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  }
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Hittades inte'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- Rum ----------
const rooms = new Map(); // kod -> rum
const clients = new Map(); // pid -> { ws, room }

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)]; } while (rooms.has(c));
  return c;
}

const cleanName = (n) => (String(n || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Spelare');
const validMode = (m) => (R.MODES[m] ? m : 'classic');
const validTarget = (t) => ([0, 11, 21, 31].includes(+t) ? +t : 21);

function createRoom(pid, name, mode, target) {
  const room = {
    code: makeCode(),
    host: pid,
    mode: validMode(mode),
    target: validTarget(target),
    seats: [{ pid, name: cleanName(name), isBot: false, connected: true }],
    status: 'lobby',
    game: null,
    ready: new Set(),
    botTimer: null,
    touched: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function seatIndex(room, pid) { return room.seats.findIndex((s) => s.pid === pid); }

function addBot(room, level) {
  if (room.seats.length >= MAX_SEATS) return;
  level = LEVEL_NAME[level] ? level : 'medium';
  const used = new Set(room.seats.map((s) => s.name));
  const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot';
  room.seats.push({ pid: 'bot:' + Math.random().toString(36).slice(2), name, isBot: true, level, connected: true });
}

function startGame(room) {
  if (room.seats.length < 2) return 'Det behövs minst två spelare';
  room.game = R.newGame(room.seats.map((s) => s.name), room.mode, { target: room.target });
  room.status = 'playing';
  room.ready.clear();
  return null;
}

function roomInfo(room) {
  const hostIdx = seatIndex(room, room.host);
  return {
    code: room.code,
    host: hostIdx,
    mode: room.mode,
    target: room.target,
    status: room.status,
    seats: room.seats.map((s) => ({ name: s.name, isBot: s.isBot, level: s.level || null, connected: s.connected })),
    ready: [...room.ready],
  };
}

function send(ws, obj) { if (ws) ws.send(JSON.stringify(obj)); }

function broadcast(room) {
  room.touched = Date.now();
  const info = roomInfo(room);
  room.seats.forEach((s, i) => {
    if (s.isBot) return;
    const c = clients.get(s.pid);
    if (!c || c.room !== room.code) return;
    send(c.ws, { t: 'room', room: info, you: i, view: room.game ? R.viewFor(room.game, i) : null });
  });
  scheduleBots(room);
}

function scheduleBots(room) {
  if (room.botTimer || room.status !== 'playing' || !room.game) return;
  const g = room.game;
  if (g.phase === 'roundEnd') { maybeNextRound(room); return; }
  if (g.phase !== 'playing') return;
  const seat = room.seats[g.turn];
  if (!seat || !seat.isBot) return;
  const delay = 750 + Math.random() * 700;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (!rooms.has(room.code) || room.status !== 'playing' || !room.game) return;
    const gg = room.game;
    if (gg.phase !== 'playing') return;
    const s = room.seats[gg.turn];
    if (!s || !s.isBot) return;
    const mv = Bot.chooseMove(gg, gg.turn, s.level);
    if (mv) {
      const r = R.applyMove(gg, gg.turn, mv);
      if (!r.ok) console.error('Botdrag ogiltigt', r.error, mv);
    }
    broadcast(room);
  }, delay);
}

function maybeNextRound(room) {
  const g = room.game;
  if (!g || g.phase !== 'roundEnd') return;
  const humans = room.seats.map((s, i) => ({ s, i })).filter((x) => !x.s.isBot && x.s.connected);
  if (humans.every((x) => room.ready.has(x.i))) {
    room.ready.clear();
    R.nextRound(g);
    broadcast(room);
  }
}

function leaveRoom(pid) {
  const c = clients.get(pid);
  if (!c || !c.room) return;
  const room = rooms.get(c.room);
  c.room = null;
  if (!room) return;
  const i = seatIndex(room, pid);
  if (i < 0) return;
  if (room.status === 'lobby') {
    room.seats.splice(i, 1);
  } else {
    // Mitt i spelet: en bot tar över platsen
    const s = room.seats[i];
    s.isBot = true; s.level = 'medium'; s.pid = 'bot:' + Math.random().toString(36).slice(2); s.connected = true;
    s.name = s.name + ' 🤖';
    if (room.game) room.game.players[i].name = s.name;
  }
  if (room.host === pid) {
    const h = room.seats.find((s) => !s.isBot);
    room.host = h ? h.pid : null;
  }
  if (!room.seats.some((s) => !s.isBot)) { clearTimeout(room.botTimer); rooms.delete(room.code); return; }
  broadcast(room);
}

function handle(pid, ws, msg) {
  const c = clients.get(pid);
  const room = c && c.room ? rooms.get(c.room) : null;
  const idx = room ? seatIndex(room, pid) : -1;
  const isHost = room && room.host === pid;
  const fail = (m) => send(ws, { t: 'error', msg: m });

  switch (msg.t) {
    case 'create': {
      leaveRoom(pid);
      const r = createRoom(pid, msg.name, msg.mode, msg.target);
      c.room = r.code;
      broadcast(r);
      break;
    }
    case 'solo': {
      leaveRoom(pid);
      const r = createRoom(pid, msg.name, msg.mode, msg.target);
      c.room = r.code;
      const bots = Array.isArray(msg.bots) ? msg.bots.slice(0, 3) : ['medium'];
      for (const l of bots) addBot(r, l);
      if (r.seats.length < 2) addBot(r, 'medium');
      startGame(r);
      broadcast(r);
      break;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) return fail('Rummet ' + code + ' finns inte');
      if (room && room.code === code) { broadcast(r); return; }
      const existing = seatIndex(r, pid);
      if (existing < 0) {
        if (r.status !== 'lobby') return fail('Spelet har redan börjat');
        if (r.seats.length >= MAX_SEATS) return fail('Rummet är fullt');
        leaveRoom(pid);
        r.seats.push({ pid, name: cleanName(msg.name), isBot: false, connected: true });
      }
      c.room = r.code;
      broadcast(r);
      break;
    }
    case 'leave': leaveRoom(pid); send(ws, { t: 'left' }); break;
    case 'addBot':
      if (!isHost || room.status !== 'lobby') return;
      addBot(room, msg.level); broadcast(room); break;
    case 'removeSeat': {
      if (!isHost || room.status !== 'lobby') return;
      const s = room.seats[msg.index];
      if (!s || s.pid === pid) return;
      room.seats.splice(msg.index, 1);
      if (!s.isBot) { const oc = clients.get(s.pid); if (oc) { oc.room = null; send(oc.ws, { t: 'kicked' }); } }
      broadcast(room);
      break;
    }
    case 'botLevel': {
      if (!isHost || room.status !== 'lobby') return;
      const s = room.seats[msg.index];
      if (s && s.isBot && LEVEL_NAME[msg.level]) { s.level = msg.level; broadcast(room); }
      break;
    }
    case 'options':
      if (!isHost || room.status !== 'lobby') return;
      if (msg.mode) room.mode = validMode(msg.mode);
      if (msg.target != null) room.target = validTarget(msg.target);
      broadcast(room);
      break;
    case 'start': {
      if (!isHost || room.status !== 'lobby') return;
      const e = startGame(room);
      if (e) return fail(e);
      broadcast(room);
      break;
    }
    case 'move': {
      if (!room || !room.game || idx < 0) return;
      const r = R.applyMove(room.game, idx, msg.move);
      if (!r.ok) { fail(r.error); broadcast(room); return; }
      broadcast(room);
      break;
    }
    case 'next':
      if (!room || !room.game || room.game.phase !== 'roundEnd') return;
      room.ready.add(idx);
      broadcast(room);
      break;
    case 'rematch':
      if (!isHost || !room.game || room.game.phase !== 'gameEnd') return;
      startGame(room); broadcast(room); break;
    case 'lobby':
      if (!isHost) return;
      clearTimeout(room.botTimer); room.botTimer = null;
      room.status = 'lobby'; room.game = null; room.ready.clear();
      // Spelare som ersatts av bottar under spelet får vara kvar som bottar
      broadcast(room);
      break;
    case 'botify': {
      if (!isHost || !room.game) return;
      const s = room.seats[msg.index];
      if (!s || s.isBot || s.connected) return;
      const oc = clients.get(s.pid); if (oc) oc.room = null;
      s.isBot = true; s.level = 'medium'; s.pid = 'bot:' + Math.random().toString(36).slice(2); s.connected = true;
      broadcast(room);
      break;
    }
    case 'emote': {
      if (!room || idx < 0) return;
      const e = String(msg.e || '').slice(0, 4);
      room.seats.forEach((s) => { if (!s.isBot) { const oc = clients.get(s.pid); if (oc && oc.room === room.code) send(oc.ws, { t: 'emote', seat: idx, e }); } });
      break;
    }
    case 'rename': {
      if (!room || idx < 0 || room.status !== 'lobby') return;
      room.seats[idx].name = cleanName(msg.name); broadcast(room); break;
    }
    case 'ping': send(ws, { t: 'pong' }); break;
  }
}

server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
  upgrade(req, socket, (ws) => {
    let pid = null;
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        pid = String(msg.pid || '').slice(0, 40) || Math.random().toString(36).slice(2);
        const prev = clients.get(pid);
        if (prev && prev.ws !== ws) { try { prev.ws.close(); } catch (e) { /* */ } }
        const c = { ws, room: prev ? prev.room : null };
        clients.set(pid, c);
        send(ws, { t: 'welcome' });
        const room = c.room && rooms.get(c.room);
        if (room) {
          const i = seatIndex(room, pid);
          if (i >= 0) { room.seats[i].connected = true; broadcast(room); }
          else { c.room = null; }
        }
        return;
      }
      if (!pid) return;
      try { handle(pid, ws, msg); } catch (e) { console.error(e); }
    });
    ws.on('close', () => {
      if (!pid) return;
      const c = clients.get(pid);
      if (!c || c.ws !== ws) return;
      const room = c.room && rooms.get(c.room);
      if (room) {
        const i = seatIndex(room, pid);
        if (i >= 0) {
          room.seats[i].connected = false;
          if (room.status === 'lobby') {
            // Ge spelaren en stund att ladda om sidan innan platsen släpps
            setTimeout(() => {
              const cc = clients.get(pid);
              const rr = rooms.get(room.code);
              if (rr && rr.status === 'lobby' && cc && cc.ws === ws) leaveRoom(pid);
            }, 60000);
          }
          broadcast(room);
        }
      }
    });
  });
});

// Städa bort övergivna rum
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyone = room.seats.some((s) => !s.isBot && s.connected);
    if (!anyone && now - room.touched > 30 * 60 * 1000) { clearTimeout(room.botTimer); rooms.delete(code); }
  }
}, 60000).unref();

server.listen(PORT, () => console.log('Kasino kör på http://localhost:' + PORT));
