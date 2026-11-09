// Ende-till-ände-test: två klienter + en bot spelar en giv via WebSocket
const R = require('../shared/rules');
const URL = process.env.URL || 'ws://localhost:3123/ws';
function client(pid, name) {
  const ws = new WebSocket(URL);
  const c = { ws, pid, name, room: null, view: null, you: null, errors: [] };
  c.send = (o) => ws.send(JSON.stringify(o));
  c.ready = new Promise((res) => ws.onopen = () => { c.send({ t: 'hello', pid, name }); res(); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'room') { c.room = m.room; c.view = m.view; c.you = m.you; c.onRoom && c.onRoom(); }
    if (m.t === 'error') c.errors.push(m.msg);
  };
  return c;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const mode = process.argv[2] || 'bygg';
  const a = client('pidA', 'Anna'), b = client('pidB', 'Björn');
  await a.ready; await b.ready; await wait(100);
  a.send({ t: 'create', name: 'Anna', mode, target: 0 }); await wait(150);
  const code = a.room.code; console.log('rum', code);
  b.send({ t: 'join', code, name: 'Björn' }); await wait(150);
  a.send({ t: 'addBot', level: 'hard' }); await wait(150);
  console.log('platser', a.room.seats.map((s) => s.name + (s.isBot ? '(bot)' : '')).join(', '));
  a.send({ t: 'start' }); await wait(200);
  const bots = { easy: 1 };
  const B = require('../server/bot');
  let moves = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await wait(60);
    const v = a.view;
    if (!v) continue;
    if (v.phase === 'gameEnd') break;
    for (const c of [a, b]) {
      const cv = c.view;
      if (cv && cv.phase === 'playing' && cv.turn === cv.me && !c.pending) {
        const ms = R.listMoves({ mode: cv.mode, table: cv.table, hand: cv.hand, p: cv.me });
        const mv = ms[Math.floor(Math.random() * ms.length)];
        c.pending = true; c.onRoom = () => { c.pending = false; c.onRoom = null; };
        c.send({ t: 'move', move: mv }); moves++;
      }
    }
  }
  const v = a.view;
  console.log('fas', v.phase, 'drag av människor', moves, 'poäng', v.players.map((p) => p.name + ':' + p.score).join(' '), 'vinnare', v.winners);
  console.log('fel', a.errors, b.errors);
  // Dold information: Björn ska inte se Annas hand
  console.log('B ser annans hand?', JSON.stringify(b.view).includes('"hand":' + JSON.stringify(a.view.hand)) && a.view.hand.length > 0);
  // Återanslutning
  b.ws.close(); await wait(200);
  console.log('B frånkopplad syns:', a.room.seats[1].connected === false);
  const b2 = client('pidB', 'Björn'); await b2.ready; await wait(300);
  console.log('B återansluten till rum:', b2.room && b2.room.code === code, 'plats', b2.you);
  a.send({ t: 'rematch' }); await wait(200);
  console.log('omspel fas', a.view.phase, 'giv', a.view.round);
  process.exit(0);
})();
