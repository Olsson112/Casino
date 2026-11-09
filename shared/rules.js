/*
 * Kasino – regelmotor (delas mellan server och klient)
 *
 * Lägen:
 *   classic – Klassiskt kasino: ta eller lägg ut.
 *   bygg    – Byggkasino: som klassiskt men man får bygga.
 *   kryp    – Krypkasino: lägst poäng vinner, man måste ta om man kan.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CasinoRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C']; // spader, hjärter, ruter, klöver
  const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAME = { S: 'spader', H: 'hjärter', D: 'ruter', C: 'klöver' };
  const RANK_LABEL = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

  const MODES = {
    classic: { id: 'classic', name: 'Klassiskt kasino', building: false, reverse: false, forceCapture: false },
    bygg: { id: 'bygg', name: 'Byggkasino', building: true, reverse: false, forceCapture: false },
    kryp: { id: 'kryp', name: 'Krypkasino', building: false, reverse: true, forceCapture: true },
  };

  // ---------- Kort ----------
  function makeDeck() {
    const deck = [];
    for (const s of SUITS) for (let r = 1; r <= 13; r++) deck.push({ id: s + r, s, r });
    return deck;
  }

  function shuffle(arr, rnd) {
    rnd = rnd || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const isLillan = (c) => c.s === 'S' && c.r === 2;
  const isStoran = (c) => c.s === 'D' && c.r === 10;

  /** Värde på bordet */
  function tableValue(c) { return c.r; }

  /** Värde i handen */
  function handValue(c) {
    if (c.r === 1) return 14;
    if (isLillan(c)) return 15;
    if (isStoran(c)) return 16;
    return c.r;
  }

  function cardLabel(c) { return (RANK_LABEL[c.r] || String(c.r)) + SUIT_SYMBOL[c.s]; }

  function itemValue(it) { return it.kind === 'build' ? it.value : tableValue(it.card); }
  function itemCards(it) { return it.kind === 'build' ? it.cards : [it.card]; }

  // ---------- Kombinatorik ----------
  /** Kan värdena delas i grupper där varje grupp summerar till t? */
  function canPartition(values, t) {
    if (!values.length || t <= 0) return false;
    let sum = 0;
    for (const v of values) { if (v > t) return false; sum += v; }
    if (sum % t) return false;
    const vals = values.slice().sort((a, b) => b - a);
    const used = new Array(vals.length).fill(false);
    function solve(groupsLeft) {
      if (groupsLeft === 0) return true;
      const first = used.indexOf(false);
      used[first] = true;
      if (fill(first + 1, t - vals[first], groupsLeft)) return true;
      used[first] = false;
      return false;
    }
    function fill(i, rem, groupsLeft) {
      if (rem === 0) return solve(groupsLeft - 1);
      let prev = -1;
      for (let j = i; j < vals.length; j++) {
        if (used[j] || vals[j] > rem || vals[j] === prev) continue;
        used[j] = true;
        if (fill(j + 1, rem - vals[j], groupsLeft)) return true;
        used[j] = false;
        prev = vals[j];
      }
      return false;
    }
    return solve(sum / t);
  }

  /** Finns någon delmängd av värdena som summerar exakt till t? */
  function subsetSumExists(values, t) {
    let reach = 1; // bitmask över summor
    const mask = (1 << (t + 1)) - 1;
    for (const v of values) {
      if (v > t) continue;
      reach = (reach | (reach << v)) & mask;
      if (reach & (1 << t)) return true;
    }
    return !!(reach & (1 << t));
  }

  // ---------- Validering ----------
  /**
   * ctx = { mode, table, hand, p }
   * move = { type: 'capture'|'build'|'trail', cardId, itemIds: [], value }
   */
  function validateMove(ctx, move) {
    const M = MODES[ctx.mode];
    if (!M) return err('Okänt spelläge');
    if (!move || typeof move !== 'object') return err('Ogiltigt drag');
    const card = ctx.hand.find((c) => c.id === move.cardId);
    if (!card) return err('Välj ett kort från handen');
    const ids = Array.isArray(move.itemIds) ? move.itemIds : [];
    if (new Set(ids).size !== ids.length) return err('Dubbla val');
    const items = [];
    for (const id of ids) {
      const it = ctx.table.find((x) => x.id === id);
      if (!it) return err('Kortet finns inte längre på bordet');
      items.push(it);
    }
    const rest = ctx.hand.filter((c) => c !== card);
    const myBuilds = ctx.table.filter((it) => it.kind === 'build' && it.owner === ctx.p);

    if (move.type === 'trail') {
      if (items.length) return err('Avmarkera bordskorten för att lägga ut');
      if (M.building && myBuilds.length) return err('Du har ett bygge på bordet – du måste ta det eller bygga vidare');
      if (M.forceCapture && anyCapture(ctx)) return err('I krypkasino måste du ta när du kan');
      return ok({ type: 'trail' });
    }

    if (move.type === 'capture') {
      if (!items.length) return err('Markera korten du vill ta');
      const h = handValue(card);
      const looseVals = [];
      for (const it of items) {
        if (it.kind === 'build') { if (it.value !== h) return err('Ett bygge kan bara tas med ett kort av samma värde (' + it.value + ')'); }
        else looseVals.push(tableValue(it.card));
      }
      if (looseVals.length && !canPartition(looseVals, h)) return err(cardLabel(card) + ' (' + h + ') kan inte ta de markerade korten');
      const leftBuilds = myBuilds.filter((b) => !items.includes(b));
      const e = checkOwner(rest, leftBuilds);
      if (e) return err(e);
      return ok({ type: 'capture', value: h });
    }

    if (move.type === 'build') {
      if (!M.building) return err('Man får inte bygga i ' + M.name.toLowerCase());
      if (!items.length) return err('Markera bordskort att bygga på');
      const vals = [tableValue(card)].concat(items.map(itemValue));
      const total = vals.reduce((a, b) => a + b, 0);
      const candidates = buildCandidates(card, items, rest);
      if (!candidates.length) return err('Inget giltigt bygge – du måste ha ett kort i handen som kan ta bygget');
      let v = move.value;
      if (v == null) v = candidates[0];
      if (!candidates.includes(v)) return err('Du kan inte bygga ' + v);
      const leftBuilds = myBuilds.filter((b) => !items.includes(b));
      const e = checkOwner(rest, leftBuilds.concat([{ value: v }]));
      if (e) return err(e);
      return ok({ type: 'build', value: v, groups: total / v, candidates });
    }
    return err('Okänd dragtyp');
  }

  /** Möjliga byggvärden för kort + markerade bordsföremål */
  function buildCandidates(card, items, rest) {
    if (!items.length) return [];
    const vals = [tableValue(card)].concat(items.map(itemValue));
    const total = vals.reduce((a, b) => a + b, 0);
    const holdVals = [...new Set(rest.map(handValue))].sort((a, b) => a - b);
    const out = [];
    for (const v of holdVals) {
      if (total % v) continue;
      if (items.some((it) => it.kind === 'build' && it.locked && it.value !== v)) continue;
      // Ett bygge som inte ändras alls (t.ex. bara ett bygge + inget) är inte ett bygge
      if (!canPartition(vals, v)) continue;
      out.push(v);
    }
    return out;
  }

  function checkOwner(rest, builds) {
    for (const b of builds) {
      if (!rest.some((c) => handValue(c) === b.value)) return 'Du måste behålla ett kort som kan ta ditt bygge (' + b.value + ')';
    }
    return null;
  }

  function anyCapture(ctx) {
    const loose = ctx.table.filter((it) => it.kind === 'card').map((it) => tableValue(it.card));
    const builds = ctx.table.filter((it) => it.kind === 'build').map((b) => b.value);
    return ctx.hand.some((c) => {
      const h = handValue(c);
      return builds.includes(h) || subsetSumExists(loose, h);
    });
  }

  const ok = (x) => Object.assign({ ok: true }, x);
  const err = (msg) => ({ ok: false, error: msg });

  // ---------- Draggenerering (bottar / tips) ----------
  function listMoves(ctx) {
    const M = MODES[ctx.mode];
    const moves = [];
    const table = ctx.table;
    const n = Math.min(table.length, 12);
    const seen = new Set();
    for (const card of ctx.hand) {
      const tr = { type: 'trail', cardId: card.id, itemIds: [] };
      if (validateMove(ctx, tr).ok) moves.push(tr);
      const h = handValue(card);
      const rest = ctx.hand.filter((c) => c !== card);
      for (let mask = 1; mask < 1 << n; mask++) {
        const items = [];
        let sum = 0;
        for (let i = 0; i < n; i++) if (mask & (1 << i)) { items.push(table[i]); sum += itemValue(table[i]); }
        const ids = items.map((i) => i.id);
        // Ta
        if (sum % h === 0) {
          const mv = { type: 'capture', cardId: card.id, itemIds: ids };
          if (validateMove(ctx, mv).ok) moves.push(mv);
        }
        // Bygg
        if (M.building) {
          for (const v of buildCandidates(card, items, rest)) {
            const key = card.r + ':' + card.s + ':' + ids.join(',') + ':' + v;
            if (seen.has(key)) continue;
            seen.add(key);
            const mv = { type: 'build', cardId: card.id, itemIds: ids, value: v };
            if (validateMove(ctx, mv).ok) moves.push(mv);
          }
        }
      }
    }
    return moves;
  }

  // ---------- Spelets gång ----------
  function newGame(names, mode, opts) {
    opts = opts || {};
    const state = {
      mode,
      target: opts.target == null ? 21 : opts.target, // 0 = en giv
      players: names.map((name) => ({ name, hand: [], pile: [], tabbar: 0, score: 0 })),
      deck: [],
      table: [],
      dealer: Math.floor((opts.rnd || Math.random)() * names.length),
      turn: 0,
      round: 0,
      phase: 'playing',
      lastCapturer: null,
      lastMove: null,
      roundResult: null,
      history: [],
      winners: null,
      seq: 0,
    };
    startRound(state, opts.rnd);
    return state;
  }

  function startRound(state, rnd) {
    state.round++;
    state.deck = shuffle(makeDeck(), rnd);
    state.table = [];
    state.lastCapturer = null;
    state.lastMove = null;
    state.roundResult = null;
    for (const p of state.players) { p.hand = []; p.pile = []; p.tabbar = 0; }
    const n = state.players.length;
    // Två omgångar om två kort till varje spelare och bordet
    for (let k = 0; k < 2; k++) {
      for (let i = 1; i <= n; i++) {
        const p = state.players[(state.dealer + i) % n];
        p.hand.push(state.deck.pop(), state.deck.pop());
      }
      for (let j = 0; j < 2; j++) {
        const c = state.deck.pop();
        state.table.push({ kind: 'card', id: c.id, card: c });
      }
    }
    state.turn = (state.dealer + 1) % n;
    state.phase = 'playing';
  }

  function dealHands(state) {
    const n = state.players.length;
    for (let k = 0; k < 2; k++) {
      for (let i = 1; i <= n; i++) {
        const p = state.players[(state.dealer + i) % n];
        p.hand.push(state.deck.pop(), state.deck.pop());
      }
    }
  }

  function ctxFor(state, p) {
    return { mode: state.mode, table: state.table, hand: state.players[p].hand, p };
  }

  function applyMove(state, p, move) {
    if (state.phase !== 'playing') return err('Given är slut');
    if (state.turn !== p) return err('Det är inte din tur');
    const ctx = ctxFor(state, p);
    const res = validateMove(ctx, move);
    if (!res.ok) return res;
    const player = state.players[p];
    const card = player.hand.find((c) => c.id === move.cardId);
    const items = (move.itemIds || []).map((id) => state.table.find((x) => x.id === id));
    const finalPlay = state.deck.length === 0 && state.players.every((pl, i) => (i === p ? pl.hand.length === 1 : pl.hand.length === 0));
    player.hand = player.hand.filter((c) => c !== card);
    const lm = { p, type: res.type, card, items: items.map((i) => ({ kind: i.kind, value: itemValue(i), cards: itemCards(i) })), value: res.value || null, tabbe: false, seq: ++state.seq };

    if (res.type === 'trail') {
      state.table.push({ kind: 'card', id: card.id, card });
    } else if (res.type === 'capture') {
      state.table = state.table.filter((x) => !items.includes(x));
      player.pile.push(card);
      for (const it of items) player.pile.push(...itemCards(it));
      state.lastCapturer = p;
      if (state.table.length === 0 && !finalPlay) { player.tabbar++; lm.tabbe = true; }
    } else if (res.type === 'build') {
      state.table = state.table.filter((x) => !items.includes(x));
      const cards = [card];
      for (const it of items) cards.push(...itemCards(it));
      const locked = res.groups >= 2 || items.some((it) => it.kind === 'build' && it.locked);
      state.table.push({ kind: 'build', id: 'b' + state.seq, cards, value: res.value, locked, owner: p });
    }
    state.lastMove = lm;
    state.history.push(describeMove(state, lm));
    if (state.history.length > 30) state.history.shift();

    // Nästa tur
    const n = state.players.length;
    if (state.players.every((pl) => pl.hand.length === 0)) {
      if (state.deck.length) {
        dealHands(state);
        state.turn = (state.dealer + 1) % n;
      } else {
        endRound(state);
      }
    } else {
      state.turn = (p + 1) % n;
    }
    return ok({ move: lm });
  }

  function describeMove(state, lm) {
    const who = state.players[lm.p].name;
    const c = cardLabel(lm.card);
    if (lm.type === 'trail') return who + ' lade ut ' + c;
    const parts = lm.items.map((i) => (i.kind === 'build' ? 'bygge ' + i.value : cardLabel(i.cards[0]))).join(' + ');
    if (lm.type === 'capture') return who + ' tog ' + parts + ' med ' + c + (lm.tabbe ? ' – TABBE!' : '');
    return who + ' byggde ' + lm.value + ' (' + c + ' på ' + parts + ')';
  }

  function endRound(state) {
    const leftover = [];
    for (const it of state.table) leftover.push(...itemCards(it));
    if (leftover.length && state.lastCapturer != null) {
      state.players[state.lastCapturer].pile.push(...leftover);
      state.table = [];
    }
    const res = scoreRound(state);
    state.roundResult = res;
    state.players.forEach((p, i) => { p.score += res.rows[i].total; });
    state.history.push('Given är slut');
    state.phase = 'roundEnd';
    const w = checkWinners(state);
    if (w) { state.winners = w; state.phase = 'gameEnd'; }
  }

  function scoreRound(state) {
    const rows = state.players.map((p) => {
      const cards = p.pile.length;
      const spades = p.pile.filter((c) => c.s === 'S').length;
      const aces = p.pile.filter((c) => c.r === 1).length;
      const lillan = p.pile.some(isLillan) ? 1 : 0;
      const storan = p.pile.some(isStoran) ? 2 : 0;
      return { cards, spades, aces, lillan, storan, tabbar: p.tabbar, mostCards: 0, mostSpades: 0, total: 0 };
    });
    const uniqueMax = (key) => {
      const max = Math.max(...rows.map((r) => r[key]));
      const who = rows.filter((r) => r[key] === max);
      return who.length === 1 && max > 0 ? who[0] : null;
    };
    const mc = uniqueMax('cards'); if (mc) mc.mostCards = 1;
    const ms = uniqueMax('spades'); if (ms) ms.mostSpades = 1;
    for (const r of rows) r.total = r.mostCards + r.mostSpades + r.aces + r.lillan + r.storan + r.tabbar;
    return { rows };
  }

  function checkWinners(state) {
    const scores = state.players.map((p) => p.score);
    const reverse = MODES[state.mode].reverse;
    const reached = state.target === 0 || scores.some((s) => s >= state.target);
    if (!reached) return null;
    const best = reverse ? Math.min(...scores) : Math.max(...scores);
    const winners = scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
    if (winners.length > 1 && state.target !== 0) return null; // oavgjort – spela en giv till
    return winners;
  }

  function nextRound(state, rnd) {
    if (state.phase !== 'roundEnd') return err('Kan inte starta ny giv nu');
    state.dealer = (state.dealer + 1) % state.players.length;
    startRound(state, rnd);
    return ok({});
  }

  /** Vad en viss spelare får se */
  function viewFor(state, p) {
    return {
      mode: state.mode,
      target: state.target,
      round: state.round,
      phase: state.phase,
      turn: state.turn,
      dealer: state.dealer,
      table: state.table,
      deckCount: state.deck.length,
      me: p,
      hand: p != null && state.players[p] ? state.players[p].hand : [],
      players: state.players.map((pl) => ({ name: pl.name, handCount: pl.hand.length, pileCount: pl.pile.length, tabbar: pl.tabbar, score: pl.score })),
      lastMove: state.lastMove,
      lastCapturer: state.lastCapturer,
      roundResult: state.roundResult,
      winners: state.winners,
      history: state.history.slice(-8),
    };
  }

  return {
    SUITS, SUIT_SYMBOL, SUIT_NAME, MODES,
    makeDeck, shuffle, tableValue, handValue, cardLabel, itemValue, itemCards, isLillan, isStoran,
    canPartition, subsetSumExists, validateMove, buildCandidates, anyCapture, listMoves,
    newGame, applyMove, nextRound, viewFor, ctxFor, scoreRound,
  };
});
