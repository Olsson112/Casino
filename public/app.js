(() => {
  'use strict';
  const R = window.CasinoRules;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(k, d) { try { const v = localStorage.getItem('kasino.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('kasino.' + k, v); } catch (e) { /* privat läge */ } },
  };
  let pid = store.get('pid');
  if (!pid) { pid = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)); store.set('pid', pid); }

  const LEVELS = { easy: 'Lätt', medium: 'Medel', hard: 'Svår' };
  const TARGETS = [[0, 'En giv'], [11, '11 p'], [21, '21 p'], [31, '31 p']];
  const MODE_INFO = {
    classic: { ico: '🂡', name: 'Klassiskt', desc: 'Ta kort med kort. Flest poäng vinner.' },
    bygg: { ico: '🏗️', name: 'Byggkasino', desc: 'Bygg högar som du tar senare.' },
    kryp: { ico: '🐢', name: 'Krypkasino', desc: 'Tvärtom! Minst poäng vinner.' },
  };
  const RANK = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
  const SYM = R.SUIT_SYMBOL;
  const EMOTES = ['👍', '😂', '😮', '😤', '🎉'];

  const S = {
    ws: null, connected: false, room: null, you: null, view: null,
    name: store.get('name', ''),
    joinCode: (new URLSearchParams(location.search).get('rum') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4),
    solo: { mode: store.get('mode', 'classic'), bots: +store.get('bots', 1) || 1, level: store.get('level', 'medium'), target: +store.get('target', 21) },
    sel: { card: null, items: [] },
    lastSeq: null, prevTable: new Set(), prevHand: new Set(), screen: null, modal: null,
    roundEndAt: 0, wantJoin: !!(new URLSearchParams(location.search).get('rum')),
  };
  if (!R.MODES[S.solo.mode]) S.solo.mode = 'classic';
  if (!TARGETS.some((t) => t[0] === S.solo.target)) S.solo.target = 21;

  // ---------- Anslutning ----------
  let retry = 500;
  function connect() {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    S.ws = ws;
    ws.onopen = () => { retry = 500; S.connected = true; send({ t: 'hello', pid, name: S.name }); updateConn(); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
    ws.onclose = () => {
      if (S.ws !== ws) return;
      S.connected = false; S.ws = null; updateConn();
      setTimeout(connect, retry); retry = Math.min(retry * 1.7, 8000);
    };
  }
  function send(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); }
  setInterval(() => send({ t: 'ping' }), 25000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && (!S.ws || S.ws.readyState > 1)) connect(); });

  function onMsg(m) {
    if (m.t === 'welcome') {
      setTimeout(() => {
        if (!S.room && S.wantJoin && S.joinCode && S.name) { S.wantJoin = false; send({ t: 'join', code: S.joinCode, name: S.name }); }
      }, 250);
    } else if (m.t === 'room') {
      const prev = S.view;
      S.room = m.room; S.you = m.you; S.view = m.view;
      onView(prev, S.view);
      history.replaceState(null, '', '?rum=' + S.room.code);
      render(true);
    } else if (m.t === 'error') {
      toast(m.msg, 'err');
      if (!S.room) render(true);
    } else if (m.t === 'left' || m.t === 'kicked') {
      S.room = null; S.view = null; S.modal = null; S.sel = { card: null, items: [] };
      history.replaceState(null, '', location.pathname);
      if (m.t === 'kicked') toast('Du togs bort från rummet');
      render(true);
    } else if (m.t === 'emote') {
      showEmote(m.seat, m.e);
    }
  }

  function onView(prev, v) {
    if (!v) return;
    const lm = v.lastMove;
    const seq = lm ? lm.seq : null;
    if (seq !== S.lastSeq) {
      if (lm && S.lastSeq !== null && lm.tabbe) toast('TABBE! ' + v.players[lm.p].name + ' sopade bordet', 'gold');
      S.lastSeq = seq;
    }
    if (v.phase === 'roundEnd' || v.phase === 'gameEnd') {
      if (!prev || prev.phase === 'playing' || prev.round !== v.round) { S.roundEndAt = Date.now() + 1400; setTimeout(() => render(true), 1450); }
    }
    // Rensa val som inte längre gäller
    if (v.turn !== v.me || v.phase !== 'playing') S.sel = { card: null, items: [] };
    else {
      if (S.sel.card && !v.hand.some((c) => c.id === S.sel.card)) S.sel.card = null;
      S.sel.items = S.sel.items.filter((id) => v.table.some((x) => x.id === id));
    }
  }

  // ---------- Rendering ----------
  function render(force) {
    const scr = !S.room ? 'home' : S.room.status === 'lobby' ? 'lobby' : 'game';
    if (scr === 'home' && S.screen === 'home' && !force) return;
    S.screen = scr;
    const app = $('#app');
    if (scr === 'home') app.innerHTML = homeHTML();
    else if (scr === 'lobby') app.innerHTML = lobbyHTML();
    else { app.innerHTML = gameHTML(); afterGame(); }
    renderModal();
    updateConn();
  }

  function updateConn() {
    let el = $('#conn');
    if (S.connected) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'conn'; el.className = 'conn'; document.body.appendChild(el); }
    el.textContent = 'Ansluter till servern…';
  }

  function cardHTML(c, cls, attrs, tag) {
    const red = c.s === 'H' || c.s === 'D';
    const rk = RANK[c.r] || String(c.r);
    const sym = SYM[c.s];
    let center;
    if (c.r > 10) center = '<div class="face">' + rk + '</div>';
    else if (c.r === 1) center = '<div class="pip" style="font-size:calc(var(--cw)*.75)">' + sym + '</div>';
    else center = '<div class="pip">' + sym + '</div>';
    return '<div class="card ' + (red ? 'red ' : '') + (cls || '') + '" ' + (attrs || '') + ' aria-label="' + R.cardLabel(c) + '">' +
      '<div class="rk">' + rk + '<small>' + sym + '</small></div>' + center +
      '<div class="rk b">' + rk + '<small>' + sym + '</small></div>' + (tag ? '<span class="tag">' + tag + '</span>' : '') + '</div>';
  }
  const backHTML = (cls) => '<div class="card back ' + (cls || '') + '"></div>';

  function segHTML(act, options, cur, disabled) {
    return '<div class="seg' + (disabled ? ' disabled' : '') + '">' + options.map(([v, l]) =>
      '<button data-act="' + act + '" data-v="' + v + '" class="' + (String(v) === String(cur) ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
  }
  function modesHTML(act, cur, disabled) {
    return '<div class="modes">' + Object.keys(MODE_INFO).map((k) => {
      const m = MODE_INFO[k];
      return '<button class="mode' + (k === cur ? ' on' : '') + '" data-act="' + act + '" data-v="' + k + '"' + (disabled ? ' disabled' : '') + '><span class="ico">' + m.ico + '</span><b>' + m.name + '</b><span>' + m.desc + '</span></button>';
    }).join('') + '</div>';
  }

  // Startsida
  function homeHTML() {
    const demo = [{ s: 'S', r: 2 }, { s: 'D', r: 10 }, { s: 'H', r: 1 }, { s: 'C', r: 13 }];
    return '<div class="screen">' +
      '<div class="brand"><div class="brand-cards">' + demo.map((c) => cardHTML(c)).join('') + '</div><h1>Kasino</h1><p>Det svenska kortspelet – mot datorn eller med vänner</p></div>' +
      '<div class="panel stack"><h2>Ditt namn</h2><input id="name" class="input" maxlength="16" placeholder="Skriv ditt namn" value="' + esc(S.name) + '" autocomplete="nickname"></div>' +
      '<div class="panel stack"><h2>Spela med vänner</h2>' +
        '<button class="btn primary" data-act="create">Skapa rum</button>' +
        '<div class="divider">eller gå med i ett rum</div>' +
        '<div class="row"><input id="code" class="input code" maxlength="4" placeholder="KOD" value="' + esc(S.joinCode) + '" autocapitalize="characters" autocomplete="off"><button class="btn" style="flex:none" data-act="join">Gå med</button></div>' +
      '</div>' +
      '<div class="panel stack"><h2>Spela mot datorn</h2>' + modesHTML('soloMode', S.solo.mode) +
        '<div class="muted small">Motståndare</div>' + segHTML('soloBots', [[1, '1'], [2, '2'], [3, '3']], S.solo.bots) +
        '<div class="muted small">Svårighet</div>' + segHTML('soloLevel', Object.entries(LEVELS), S.solo.level) +
        '<div class="muted small">Spela till</div>' + segHTML('soloTarget', TARGETS, S.solo.target) +
        '<button class="btn primary" data-act="solo">Starta spel</button>' +
      '</div>' +
      '<button class="btn ghost" data-act="rules">📖 Spelregler</button>' +
      '</div>';
  }

  // Lobby
  function lobbyHTML() {
    const r = S.room;
    const isHost = r.host === S.you;
    const seats = [];
    for (let i = 0; i < 4; i++) {
      const s = r.seats[i];
      if (s) {
        seats.push('<div class="seat"><div class="avatar c' + i + (s.connected ? '' : ' off') + '">' + (s.isBot ? '🤖' : esc(s.name[0].toUpperCase())) + '</div>' +
          '<div class="name">' + esc(s.name) + (i === S.you ? ' (du)' : '') + '<small>' + (i === r.host ? '👑 Värd' : s.isBot ? 'Dator' : s.connected ? 'Redo' : 'Frånkopplad') + '</small></div>' +
          (s.isBot && isHost ? '<select class="level-select" data-change="botLevel" data-i="' + i + '">' + Object.entries(LEVELS).map(([k, l]) => '<option value="' + k + '"' + (k === s.level ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' : s.isBot ? '<span class="muted small">' + LEVELS[s.level] + '</span>' : '') +
          (isHost && i !== S.you ? '<button class="icon-btn" data-act="removeSeat" data-i="' + i + '" title="Ta bort">✕</button>' : '') +
          '</div>');
      } else {
        seats.push('<div class="seat empty"><span>Ledig plats</span>' + (isHost ? '<button class="btn sm" data-act="addBot">+ Lägg till dator</button>' : '<span class="small">Väntar…</span>') + '</div>');
      }
    }
    return '<div class="screen">' +
      '<div class="topbar"><button class="icon-btn" data-act="leave" title="Lämna">←</button><div class="title"><b>Lobby</b><span>' + (isHost ? 'Du är värd' : 'Väntar på att värden startar') + '</span></div><button class="icon-btn" data-act="rules">?</button></div>' +
      '<div class="panel room-code"><div class="lbl">Rumskod</div><div class="code">' + r.code + '</div>' +
        '<div class="row"><button class="btn sm" data-act="copy">🔗 Kopiera länk</button>' + (navigator.share ? '<button class="btn sm" data-act="share">📤 Dela</button>' : '') + '</div></div>' +
      '<div class="panel"><h2>Spelare ' + r.seats.length + '/4</h2><div class="seats">' + seats.join('') + '</div></div>' +
      '<div class="panel stack"><h2>Spelläge</h2>' + modesHTML('setMode', r.mode, !isHost) +
        '<div class="muted small">Spela till</div>' + segHTML('setTarget', TARGETS, r.target, !isHost) + '</div>' +
      (isHost ? '<button class="btn primary" data-act="start"' + (r.seats.length < 2 ? ' disabled' : '') + '>' + (r.seats.length < 2 ? 'Bjud in eller lägg till en dator' : 'Starta spelet') + '</button>' : '<div class="center muted">Värden startar spelet när alla är med.</div>') +
      '</div>';
  }

  // Spelbord
  function myCtx() { const v = S.view; return { mode: v.mode, table: v.table, hand: v.hand, p: v.me }; }

  function analyze() {
    const v = S.view;
    const out = { capture: null, autoCapture: null, builds: [], trail: null, hints: new Set(), error: '' };
    if (!v || v.phase !== 'playing' || v.turn !== v.me || !S.sel.card) return out;
    const ctx = myCtx();
    const card = v.hand.find((c) => c.id === S.sel.card);
    if (!card) return out;
    const items = S.sel.items.map((id) => v.table.find((x) => x.id === id)).filter(Boolean);
    const moves = R.listMoves(ctx).filter((m) => m.cardId === card.id);
    for (const m of moves) for (const id of m.itemIds) out.hints.add(id);
    const tr = R.validateMove(ctx, { type: 'trail', cardId: card.id, itemIds: [] });
    out.trail = tr.ok ? tr : null;
    out.trailErr = tr.ok ? '' : tr.error;
    if (items.length) {
      const cap = R.validateMove(ctx, { type: 'capture', cardId: card.id, itemIds: S.sel.items });
      if (cap.ok) out.capture = cap;
      if (R.MODES[v.mode].building) {
        const rest = v.hand.filter((c) => c !== card);
        for (const val of R.buildCandidates(card, items, rest)) {
          const b = R.validateMove(ctx, { type: 'build', cardId: card.id, itemIds: S.sel.items, value: val });
          if (b.ok) out.builds.push(val);
        }
      }
      if (!out.capture && !out.builds.length) out.error = cap.error;
    } else {
      // Föreslå den största fångsten
      let best = null;
      for (const m of moves) {
        if (m.type !== 'capture') continue;
        const cnt = m.itemIds.reduce((a, id) => a + R.itemCards(v.table.find((x) => x.id === id)).length, 0);
        if (!best || cnt > best.cnt) best = { m, cnt };
      }
      out.autoCapture = best;
    }
    return out;
  }

  function seatName(i) { return S.view.players[i] ? S.view.players[i].name : ''; }

  function oppHTML(i) {
    const v = S.view;
    const pl = v.players[i];
    const seat = S.room.seats[i] || {};
    const turn = v.phase === 'playing' && v.turn === i;
    const isHost = S.room.host === S.you;
    let backs = '';
    for (let k = 0; k < pl.handCount; k++) backs += '<i></i>';
    return '<div class="opp' + (turn ? ' turn' : '') + '" data-seat="' + i + '">' +
      (v.dealer === i ? '<span class="dealer-chip">GIV</span>' : '') +
      '<div class="avatar c' + i + (seat.connected === false ? ' off' : '') + '">' + (seat.isBot ? '🤖' : esc(pl.name[0].toUpperCase())) + '</div>' +
      '<div class="info"><div class="nm">' + esc(pl.name) + (turn && seat.isBot ? ' <span class="thinking"><i></i><i></i><i></i></span>' : '') + '</div>' +
        '<div class="meta"><span>🂠 ' + pl.pileCount + '</span>' + (pl.tabbar ? '<span>🧹 ' + pl.tabbar + '</span>' : '') + (seat.connected === false ? '<span style="color:var(--warn)">frånkopplad</span>' : '') + '</div>' +
        '<div class="minibacks">' + backs + '</div>' +
        (seat.connected === false && isHost ? '<button class="btn sm" style="margin-top:4px" data-act="botify" data-i="' + i + '">Ersätt med dator</button>' : '') +
      '</div><div class="score">' + pl.score + '</div></div>';
  }

  function itemHTML(it, a) {
    const sel = S.sel.items.includes(it.id) ? ' sel' : '';
    const hint = a.hints.has(it.id) ? ' hint' : '';
    const nw = S.prevTable.size && !S.prevTable.has(it.id) ? ' new' : '';
    if (it.kind === 'card') return cardHTML(it.card, 'selectable' + sel + hint + nw, 'data-act="item" data-id="' + it.id + '"');
    const cards = it.cards.map((c) => cardHTML(c)).join('');
    return '<div class="build' + sel + hint + nw + '" data-act="item" data-id="' + it.id + '" title="Bygge ' + it.value + ' av ' + esc(seatName(it.owner)) + '">' +
      '<div class="fan">' + cards + '</div><div class="badge c' + it.owner + '">' + (it.locked ? '🔒 ' : '🏗️ ') + it.value + '</div></div>';
  }

  function handTag(c) {
    if (c.r === 1) return '14';
    if (R.isLillan(c)) return 'Lillan 15';
    if (R.isStoran(c)) return 'Storan 16';
    return '';
  }

  function gameHTML() {
    const v = S.view;
    if (!v) return '<div class="screen center muted">Laddar…</div>';
    const me = v.me;
    const n = v.players.length;
    const myTurn = v.phase === 'playing' && v.turn === me;
    const a = analyze();
    const mode = R.MODES[v.mode];
    const opp = [];
    for (let k = 1; k < n; k++) opp.push(oppHTML((me + k) % n));

    const table = v.table.length ? v.table.map((it) => itemHTML(it, a)).join('') : '<div class="empty-table">Bordet är tomt</div>';
    const last = v.history.length ? v.history[v.history.length - 1] : '';

    const hand = v.hand.slice().sort((x, y) => R.handValue(x) - R.handValue(y) || x.s.localeCompare(y.s));
    const handHTML = hand.map((c) => cardHTML(c, (myTurn ? 'selectable' : '') + (S.sel.card === c.id ? ' sel' : '') + (S.prevHand.size && !S.prevHand.has(c.id) ? ' new' : ''), 'data-act="hand" data-id="' + c.id + '"', handTag(c))).join('');

    // Knappar
    let actions = '';
    let hint = '';
    let hintErr = false;
    if (myTurn) {
      if (!S.sel.card) hint = 'Välj ett kort i handen';
      else {
        if (S.sel.items.length) {
          if (a.capture) actions += '<button class="btn primary" data-act="capture">Ta ' + S.sel.items.length + (S.sel.items.length === 1 ? ' sak' : ' saker') + '</button>';
          for (const b of a.builds) actions += '<button class="btn primary" data-act="build" data-v="' + b + '">Bygg ' + b + '</button>';
          if (a.error) { hint = a.error; hintErr = true; }
        } else if (a.autoCapture) {
          actions += '<button class="btn primary" data-act="autoCapture">Ta ' + a.autoCapture.cnt + ' kort</button>';
          hint = 'Markera själv på bordet för att välja vad du tar' + (mode.building ? ' eller bygger' : '');
        } else {
          hint = a.hints.size ? 'Markera kort på bordet att bygga med' : '';
        }
        if (a.trail) actions += '<button class="btn" data-act="trail">Lägg ut</button>';
        else if (!actions && a.trailErr) { hint = a.trailErr; hintErr = true; }
      }
    } else if (v.phase === 'playing') {
      hint = 'Väntar på ' + esc(seatName(v.turn)) + '…';
    }

    const myP = v.players[me];
    return '<div class="game">' +
      '<div class="topbar"><button class="icon-btn" data-act="leave" title="Lämna">←</button>' +
        '<div class="title"><b>' + mode.name + '</b><span>Rum ' + S.room.code + ' · Giv ' + v.round + ' · ' + (v.target ? 'Till ' + v.target + ' p' : 'En giv') + (mode.reverse ? ' · minst vinner' : '') + '</span></div>' +
        '<button class="icon-btn" data-act="rules" title="Regler">?</button></div>' +
      '<div class="opponents">' + opp.join('') + '</div>' +
      '<div class="felt"><div class="felt-head"><span>' + (v.lastCapturer != null ? 'Sist tog: ' + esc(seatName(v.lastCapturer)) : '') + '</span>' +
        '<span class="deck">' + (v.deckCount ? backHTML() + v.deckCount + ' kvar' : 'Leken är slut') + '</span></div>' +
        '<div class="table-cards">' + table + '</div>' +
        '<div class="lastmove">' + esc(last) + '</div></div>' +
      '<div class="me"><div class="me-bar' + (myTurn ? ' turn' : '') + '" data-seat="' + me + '">' +
        (v.dealer === me ? '<span class="dealer-chip" style="position:static">GIV</span>' : '') +
        '<div class="avatar c' + me + '">' + esc((myP.name[0] || '?').toUpperCase()) + '</div>' +
        '<div class="info"><div class="status' + (myTurn ? ' your' : '') + '">' + (myTurn ? 'Din tur!' : esc(myP.name)) + '</div>' +
          '<div class="meta">' + myP.score + ' poäng · ' + myP.pileCount + ' tagna kort' + (myP.tabbar ? ' · 🧹 ' + myP.tabbar : '') + '</div></div>' +
        '<div class="emotes">' + EMOTES.map((e) => '<button data-act="emote" data-v="' + e + '">' + e + '</button>').join('') + '</div></div>' +
        '<div class="hand' + (myTurn ? '' : ' waiting') + '">' + handHTML + '</div>' +
        '<div class="hint-text' + (hintErr ? ' err' : '') + '">' + hint + '</div>' +
        '<div class="actions">' + actions + '</div></div>' +
      '</div>';
  }

  function afterGame() {
    const v = S.view;
    if (!v) return;
    S.prevTable = new Set(v.table.map((x) => x.id));
    S.prevHand = new Set(v.hand.map((c) => c.id));
  }

  // ---------- Modaler ----------
  function renderModal() {
    const m = $('#modal');
    const body = $('#modal-body');
    let html = null;
    const v = S.view;
    if (S.modal === 'rules') html = rulesHTML();
    else if (S.modal === 'leave') html = '<h2>Lämna spelet?</h2><p>' + (S.room && S.room.status === 'playing' ? 'En dator tar över din plats.' : 'Du lämnar rummet.') + '</p><div class="row" style="margin-top:16px"><button class="btn" data-act="closeModal">Stanna</button><button class="btn primary" data-act="leaveConfirm">Lämna</button></div>';
    else if (S.screen === 'game' && v && (v.phase === 'roundEnd' || v.phase === 'gameEnd') && Date.now() >= S.roundEndAt) html = roundHTML();
    if (html == null) { m.classList.add('hidden'); body.innerHTML = ''; return; }
    body.innerHTML = html;
    m.classList.remove('hidden');
  }

  function roundHTML() {
    const v = S.view;
    const r = v.roundResult;
    const end = v.phase === 'gameEnd';
    const reverse = R.MODES[v.mode].reverse;
    const ck = (x) => (x ? ' ✓' : '');
    const rows = v.players.map((p, i) => {
      const x = r.rows[i];
      const win = end && v.winners.includes(i);
      return '<tr class="' + (win ? 'win' : '') + '"><td>' + (win ? '🏆 ' : '') + esc(p.name) + '</td><td>' + x.cards + ck(x.mostCards) + '</td><td>' + x.spades + ck(x.mostSpades) + '</td><td>' + (x.aces || '') + '</td><td>' + (x.lillan ? '✓' : '') + '</td><td>' + (x.storan ? '✓' : '') + '</td><td>' + (x.tabbar || '') + '</td><td>+' + x.total + '</td><td class="tot">' + p.score + '</td></tr>';
    }).join('');
    const table = '<table class="score-table"><tr><th>Spelare</th><th>Kort</th><th>♠</th><th>Ess</th><th>2♠</th><th>10♦</th><th>Tabbe</th><th>Giv</th><th>Tot</th></tr>' + rows + '</table>';
    const isHost = S.room.host === S.you;
    if (end) {
      const names = v.winners.map((i) => v.players[i].name);
      const iWon = v.winners.includes(v.me);
      return '<div class="trophy">' + (iWon ? '🏆' : '🃏') + '</div><h2 class="center">' + (names.length > 1 ? 'Oavgjort!' : iWon ? 'Du vann!' : esc(names[0]) + ' vann!') + '</h2>' +
        '<p class="center muted">' + (reverse ? 'Lägst poäng vinner i krypkasino.' : 'Grattis!') + '</p>' + table +
        (isHost ? '<div class="stack"><button class="btn primary" data-act="rematch">Spela igen</button><div class="row"><button class="btn" data-act="toLobby">Ändra inställningar</button><button class="btn" data-act="leaveConfirm">Lämna</button></div></div>'
          : '<p class="center muted">Väntar på att värden startar en ny match…</p><button class="btn" style="width:100%" data-act="leaveConfirm">Lämna</button>');
    }
    const humans = S.room.seats.map((s, i) => ({ s, i })).filter((x) => !x.s.isBot && x.s.connected);
    const readyCount = humans.filter((x) => S.room.ready.includes(x.i)).length;
    const meReady = S.room.ready.includes(v.me);
    return '<h2>Given är slut</h2><p class="muted">' + (v.target ? (reverse ? 'Lägst poäng när någon når ' : 'Först till ') + v.target + ' poäng' + (reverse ? ' vinner.' : '.') : '') + '</p>' + table +
      '<button class="btn primary" style="width:100%" data-act="next"' + (meReady ? ' disabled' : '') + '>' + (meReady ? 'Väntar på andra (' + readyCount + '/' + humans.length + ')' : 'Nästa giv') + '</button>';
  }

  function rulesHTML() {
    return '<h2>Spelregler</h2><p class="muted">Kasino för 2–4 spelare med en vanlig kortlek.</p>' +
      '<h3>Given</h3><ul><li>Alla får 4 kort och 4 kort läggs på bordet (två åt gången).</li><li>När alla spelat sina kort delas 4 nya ut – bordet får bara kort i första utdelningen.</li><li>Den som tog sist får korten som ligger kvar när leken är slut.</li></ul>' +
      '<h3>Kortens värden</h3><ul><li>2–10 som de visar, knekt 11, dam 12, kung 13.</li><li><b>Ess</b>: 14 i handen, 1 på bordet.</li><li><b>Lillan</b> (spader 2): 15 i handen, 2 på bordet.</li><li><b>Storan</b> (ruter 10): 16 i handen, 10 på bordet.</li></ul>' +
      '<h3>Ditt drag</h3><ul><li><b>Ta</b>: ett kort tar kort med samma värde, eller flera kort som tillsammans blir värdet. Du kan ta flera grupper på en gång (t.ex. en 8:a tar 8 och 5+3).</li><li><b>Lägg ut</b>: kan eller vill du inte ta, lägger du ett kort på bordet.</li><li><b>Tabbe</b>: tar du alla kort på bordet får du en tabbe (1 poäng). Sista draget i given räknas inte.</li></ul>' +
      '<h3>Poäng</h3><ul><li>Flest kort: 1 · Flest spader: 1 (vid lika får ingen poängen)</li><li>Varje ess: 1 · Lillan: 1 · Storan: 2 · Varje tabbe: 1</li></ul>' +
      '<h3>🏗️ Byggkasino</h3><ul><li>Du får <b>bygga</b>: lägg ett kort på bordskort så att summan blir ett värde du har i handen, t.ex. en 3:a på en 5:a = bygge 8 om du har en 8:a.</li><li>Andra kan bygga vidare på ett öppet bygge om de har det nya värdet.</li><li>Ett bygge med flera grupper av samma värde (t.ex. 8 och 5+3) är <b>låst</b> 🔒 och kan inte höjas.</li><li>Har du ett bygge på bordet måste du behålla ett kort som tar det, och du får inte lägga ut.</li><li>Ett bygge kan bara tas med ett kort av exakt byggets värde.</li></ul>' +
      '<h3>🐢 Krypkasino</h3><ul><li>Samma poäng, men nu gäller det att få <b>så få poäng som möjligt</b>.</li><li>Du måste ta om du kan – lägga ut får du bara när inget kort kan ta något.</li><li>När någon når målpoängen vinner den med lägst poäng.</li></ul>' +
      '<h3>Så spelar du här</h3><ul><li>Tryck på ett kort i handen, markera sedan kort eller byggen på bordet och välj <b>Ta</b>, <b>Bygg</b> eller <b>Lägg ut</b>.</li><li>Markerar du inget föreslås den största möjliga fångsten.</li></ul>' +
      '<button class="btn primary" style="width:100%;margin-top:14px" data-act="closeModal">Stäng</button>';
  }

  // ---------- Effekter ----------
  let toastTimer;
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind === 'gold' ? ' gold' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, kind === 'gold' ? 2600 : 2200);
  }
  function showEmote(seat, e) {
    const el = document.querySelector('[data-seat="' + seat + '"]');
    const rect = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0 };
    const f = document.createElement('div');
    f.className = 'float-emote';
    f.textContent = e;
    f.style.left = rect.left + rect.width / 2 + 'px';
    f.style.top = rect.top + 'px';
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1900);
  }

  // ---------- Händelser ----------
  function needName() {
    const inp = $('#name');
    if (inp) S.name = inp.value.trim().slice(0, 16);
    if (!S.name) { toast('Skriv ditt namn först'); if (inp) inp.focus(); return false; }
    store.set('name', S.name);
    return true;
  }
  function roomUrl() { return location.origin + '/?rum=' + S.room.code; }

  const act = {
    create() { if (needName()) send({ t: 'create', name: S.name, mode: S.solo.mode, target: S.solo.target }); },
    join() {
      if (!needName()) return;
      const code = ($('#code').value || '').toUpperCase().replace(/[^A-Z]/g, '');
      if (code.length !== 4) { toast('Rumskoden har fyra bokstäver'); return; }
      S.joinCode = code;
      send({ t: 'join', code, name: S.name });
    },
    solo() {
      if (!needName()) return;
      send({ t: 'solo', name: S.name, mode: S.solo.mode, target: S.solo.target, bots: Array(S.solo.bots).fill(S.solo.level) });
    },
    soloMode(el) { S.solo.mode = el.dataset.v; store.set('mode', S.solo.mode); keepInputs(); render(true); },
    soloBots(el) { S.solo.bots = +el.dataset.v; store.set('bots', S.solo.bots); keepInputs(); render(true); },
    soloLevel(el) { S.solo.level = el.dataset.v; store.set('level', S.solo.level); keepInputs(); render(true); },
    soloTarget(el) { S.solo.target = +el.dataset.v; store.set('target', S.solo.target); keepInputs(); render(true); },
    rules() { S.modal = 'rules'; renderModal(); },
    closeModal() { S.modal = null; renderModal(); },
    copy() {
      const u = roomUrl();
      (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => toast('Länken är kopierad'), () => toast(u));
    },
    share() { navigator.share({ title: 'Kasino', text: 'Spela Kasino med mig! Rumskod ' + S.room.code, url: roomUrl() }).catch(() => {}); },
    addBot() { send({ t: 'addBot', level: 'medium' }); },
    removeSeat(el) { send({ t: 'removeSeat', index: +el.dataset.i }); },
    setMode(el) { send({ t: 'options', mode: el.dataset.v }); },
    setTarget(el) { send({ t: 'options', target: +el.dataset.v }); },
    start() { send({ t: 'start' }); },
    leave() { S.modal = 'leave'; renderModal(); },
    leaveConfirm() { S.modal = null; send({ t: 'leave' }); },
    hand(el) {
      const v = S.view;
      if (!v || v.turn !== v.me || v.phase !== 'playing') return;
      S.sel.card = S.sel.card === el.dataset.id ? null : el.dataset.id;
      render(true);
    },
    item(el) {
      const v = S.view;
      if (!v || v.turn !== v.me || v.phase !== 'playing') return;
      const id = el.dataset.id;
      if (!S.sel.card) { toast('Välj först ett kort i handen'); return; }
      const i = S.sel.items.indexOf(id);
      if (i >= 0) S.sel.items.splice(i, 1); else S.sel.items.push(id);
      render(true);
    },
    capture() { doMove({ type: 'capture', cardId: S.sel.card, itemIds: S.sel.items.slice() }); },
    autoCapture() { const a = analyze(); if (a.autoCapture) doMove(a.autoCapture.m); },
    build(el) { doMove({ type: 'build', cardId: S.sel.card, itemIds: S.sel.items.slice(), value: +el.dataset.v }); },
    trail() { doMove({ type: 'trail', cardId: S.sel.card, itemIds: [] }); },
    next() { send({ t: 'next' }); },
    rematch() { send({ t: 'rematch' }); },
    toLobby() { send({ t: 'lobby' }); },
    botify(el) { send({ t: 'botify', index: +el.dataset.i }); },
    emote(el) { send({ t: 'emote', e: el.dataset.v }); },
  };
  function doMove(move) { S.sel = { card: null, items: [] }; send({ t: 'move', move }); }
  function keepInputs() {
    const n = $('#name'); if (n) S.name = n.value.trim().slice(0, 16);
    const c = $('#code'); if (c) S.joinCode = c.value.toUpperCase();
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) {
      if (e.target.id === 'modal' && S.modal) { S.modal = null; renderModal(); }
      return;
    }
    if (el.disabled) return;
    const f = act[el.dataset.act];
    if (f) f(el, e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.change === 'botLevel') send({ t: 'botLevel', index: +el.dataset.i, level: el.value });
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'name') { S.name = e.target.value.trim().slice(0, 16); store.set('name', S.name); }
    if (e.target.id === 'code') { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); S.joinCode = e.target.value; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.modal) { S.modal = null; renderModal(); return; }
    if (e.key !== 'Enter') return;
    if (e.target.id === 'code') act.join();
  });

  render(true);
  connect();
})();
