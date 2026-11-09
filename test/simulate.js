const R = require('../shared/rules');
const B = require('../server/bot');
function play(mode, levels){
  const s = R.newGame(levels.map((l,i)=>'P'+i+l), mode, {target: 21});
  let steps=0, t0=Date.now(), maxT=0;
  while(s.phase!=='gameEnd' && steps<5000){
    if(s.phase==='roundEnd'){ R.nextRound(s); continue; }
    const t=Date.now();
    const mv = B.chooseMove(s, s.turn, levels[s.turn]);
    maxT=Math.max(maxT, Date.now()-t);
    const r = R.applyMove(s, s.turn, mv);
    if(!r.ok){ console.log('ILLEGAL', r, mv); process.exit(1); }
    // card conservation
    let n = s.deck.length + s.table.reduce((a,it)=>a+R.itemCards(it).length,0) + s.players.reduce((a,p)=>a+p.hand.length+p.pile.length,0);
    if(n!==52){ console.log('CARD COUNT', n); process.exit(1);}
    steps++;
  }
  return {scores:s.players.map(p=>p.score), winners:s.winners, rounds:s.round, maxT};
}
for(const mode of ['classic','bygg','kryp']){
  const wins={};
  for(let g=0; g<20; g++){
    const levels = g%2? ['hard','easy']:['easy','hard'];
    const r=play(mode, levels);
    for(const w of r.winners) wins[levels[w]]=(wins[levels[w]]||0)+1;
    if(g===0) console.log(mode, r);
  }
  console.log(mode, 'hard vs easy wins', wins);
}
console.log('4p bygg', play('bygg',['hard','medium','easy','hard']));
console.log('3p kryp', play('kryp',['hard','medium','easy']));
