'use strict';
/*
 * Bottar för Kasino.
 *   easy   – slumpar mycket, tar ofta det första den ser
 *   medium – girig: tar det som ger mest poäng just nu
 *   hard   – räknar kort och väger in vad motståndarna kan ta efteråt
 */
const R = require('../shared/rules');

function cardWorth(c) {
  let v = 0.045; // flest kort
  if (c.s === 'S') v += 0.13; // flest spader
  if (c.r === 1) v += 1;
  if (R.isLillan(c)) v += 1;
  if (R.isStoran(c)) v += 2;
  return v;
}
const cardsWorth = (cards) => cards.reduce((a, c) => a + cardWorth(c), 0);

function itemsById(table, ids) { return ids.map((id) => table.find((x) => x.id === id)); }

/** Omedelbart poängvärde av ett drag (ur den dragande spelarens perspektiv) */
function immediate(ctx, mv, isLast) {
  const card = ctx.hand.find((c) => c.id === mv.cardId);
  const items = itemsById(ctx.table, mv.itemIds);
  if (mv.type === 'capture') {
    const cards = [card];
    for (const it of items) cards.push(...R.itemCards(it));
    let v = cardsWorth(cards);
    if (items.length === ctx.table.length && !isLast) v += 1; // tabbe
    return v;
  }
  return 0;
}

function tableAfter(ctx, mv) {
  const card = ctx.hand.find((c) => c.id === mv.cardId);
  const items = itemsById(ctx.table, mv.itemIds);
  const rest = ctx.table.filter((x) => !items.includes(x));
  if (mv.type === 'trail') return rest.concat([{ kind: 'card', id: card.id, card }]);
  if (mv.type === 'build') {
    const cards = [card];
    for (const it of items) cards.push(...R.itemCards(it));
    return rest.concat([{ kind: 'build', id: 'tmp', cards, value: mv.value, locked: true, owner: ctx.p }]);
  }
  return rest;
}

/** Bästa fångstvärde med ett kort av handvärde h på bordet */
function bestCaptureValue(table, h) {
  const n = Math.min(table.length, 11);
  let best = 0;
  for (let mask = 1; mask < 1 << n; mask++) {
    const loose = [];
    const cards = [];
    let okB = true;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const it = table[i];
      sum += R.itemValue(it);
      if (it.kind === 'build') { if (it.value !== h) { okB = false; break; } }
      else loose.push(R.tableValue(it.card));
      cards.push(...R.itemCards(it));
    }
    if (!okB || sum % h) continue;
    if (loose.length && !R.canPartition(loose, h)) continue;
    let v = cardsWorth(cards);
    if (n === table.length && mask === (1 << n) - 1) v += 1; // tabbe
    if (v > best) best = v;
  }
  return best;
}

/** Okända kort per handvärde (2..16) */
function unseenByValue(ctx, known) {
  const seen = new Set(known.map((c) => c.id));
  for (const c of ctx.hand) seen.add(c.id);
  for (const it of ctx.table) for (const c of R.itemCards(it)) seen.add(c.id);
  const counts = {};
  let total = 0;
  for (const c of R.makeDeck()) {
    if (seen.has(c.id)) continue;
    const h = R.handValue(c);
    counts[h] = (counts[h] || 0) + 1;
    total++;
  }
  return { counts, total };
}

/** Förväntat bästa motståndarfångst efter draget */
function opponentRisk(table, unseen, oppCards) {
  if (!table.length || !unseen.total || !oppCards) return 0;
  const list = [];
  for (const h in unseen.counts) {
    const g = bestCaptureValue(table, +h);
    if (g <= 0) continue;
    const f = unseen.counts[h] / unseen.total;
    const p = 1 - Math.pow(1 - f, oppCards);
    list.push({ g, p });
  }
  list.sort((a, b) => b.g - a.g);
  let e = 0;
  let none = 1;
  for (const x of list) { e += x.g * x.p * none; none *= 1 - x.p; }
  return e;
}

function chooseMove(state, p, level) {
  const ctx = R.ctxFor(state, p);
  const moves = R.listMoves(ctx);
  if (!moves.length) return null;
  const sign = R.MODES[state.mode].reverse ? -1 : 1;
  const isLast = state.deck.length === 0 && state.players.every((pl, i) => (i === p ? pl.hand.length === 1 : pl.hand.length === 0));

  if (level === 'easy') {
    const caps = moves.filter((m) => m.type === 'capture');
    if (caps.length && Math.random() < 0.65) return caps[Math.floor(Math.random() * caps.length)];
    if (Math.random() < 0.4) return moves[Math.floor(Math.random() * moves.length)];
    // annars ungefär medel
  }

  const scored = moves.map((mv) => {
    const card = ctx.hand.find((c) => c.id === mv.cardId);
    let s = sign * immediate(ctx, mv, isLast);
    if (mv.type === 'trail') {
      // Lägg inte ut värdefulla kort i onödan
      s -= sign * cardWorth(card) * 0.6;
      // Undvik att lämna en tabbe (bordet kan tas i ett svep)
      const after = tableAfter(ctx, mv);
      const vals = after.map(R.itemValue);
      const sum = vals.reduce((a, b) => a + b, 0);
      if (sum <= 16 && after.every((it) => it.kind === 'card') && R.canPartition(vals, sum)) s -= sign * 0.5;
    }
    if (mv.type === 'build') {
      const items = itemsById(ctx.table, mv.itemIds);
      const cards = [card];
      for (const it of items) cards.push(...R.itemCards(it));
      s += sign * cardsWorth(cards) * 0.7 + 0.05;
    }
    return { mv, s };
  });

  if (level === 'hard') {
    const known = [];
    state.players.forEach((pl) => known.push(...pl.pile));
    const unseen = unseenByValue(ctx, known);
    const oppCards = state.players.reduce((a, pl, i) => (i === p ? a : a + pl.hand.length), 0) - 0;
    const oppPer = Math.max(1, Math.round(oppCards / Math.max(1, state.players.length - 1)));
    scored.sort((a, b) => b.s - a.s);
    const top = scored.slice(0, 14).concat(scored.slice(14).filter((x) => x.mv.type === 'trail'));
    for (const x of top) {
      const after = tableAfter(ctx, x.mv);
      // Efter draget: motståndare kan ta saker från bordet
      let risk = opponentRisk(after, unseen, oppPer);
      if (x.mv.type === 'build') {
        // Risk att någon annan tar vårt bygge
        const f = (unseen.counts[x.mv.value] || 0) / Math.max(1, unseen.total);
        const pOpp = 1 - Math.pow(1 - f, oppPer);
        const items = itemsById(ctx.table, x.mv.itemIds);
        const cards = [ctx.hand.find((c) => c.id === x.mv.cardId)];
        for (const it of items) cards.push(...R.itemCards(it));
        x.s -= sign * cardsWorth(cards) * 0.7 * pOpp;
      }
      x.s -= sign * risk * 0.85;
      x.s += Math.random() * 0.01;
    }
    top.sort((a, b) => b.s - a.s);
    return top[0].mv;
  }

  // medium (och easy utan slump)
  for (const x of scored) x.s += Math.random() * (level === 'easy' ? 0.6 : 0.05);
  scored.sort((a, b) => b.s - a.s);
  return scored[0].mv;
}

module.exports = { chooseMove };
