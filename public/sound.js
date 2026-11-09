/* Ljudeffekter – syntetiseras med Web Audio, inga ljudfiler behövs */
(function () {
  'use strict';
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('kasino.muted') === '1'; } catch (e) { /* */ }

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  // Mobiler kräver en användargest innan ljud får spelas
  const unlock = () => {
    const c = init();
    if (c && c.state === 'suspended') c.resume();
  };
  ['pointerdown', 'touchstart', 'keydown'].forEach((e) => document.addEventListener(e, unlock, { passive: true }));

  function ready() {
    if (muted) return null;
    const c = init();
    if (!c || c.state !== 'running') return null;
    return c;
  }

  function tone(freq, start, dur, opts) {
    opts = opts || {};
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, start);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, start + dur);
    const vol = opts.vol == null ? 0.3 : opts.vol;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + (opts.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g);
    g.connect(master);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  function noise(start, dur, opts) {
    opts = opts || {};
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter || 'bandpass';
    f.frequency.setValueAtTime(opts.freq || 3000, start);
    if (opts.sweep) f.frequency.exponentialRampToValueAtTime(opts.sweep, start + dur);
    f.Q.value = opts.q || 0.8;
    const g = ctx.createGain();
    const vol = opts.vol == null ? 0.35 : opts.vol;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    s.connect(f);
    f.connect(g);
    g.connect(master);
    s.start(start, Math.random() * 0.3);
    s.stop(start + dur + 0.02);
  }

  // Ett kort som läggs på filten
  function cardSlap(t, vol) {
    noise(t, 0.09, { freq: 2600, sweep: 900, vol: (vol || 1) * 0.4, q: 0.7 });
    tone(140, t, 0.08, { vol: (vol || 1) * 0.18, slide: 70 });
  }
  function swish(t, vol) { noise(t, 0.12, { freq: 1200, sweep: 5000, vol: (vol || 1) * 0.22, q: 1.2 }); }

  const N = (semi) => 523.25 * Math.pow(2, semi / 12); // C5 som bas

  const sounds = {
    click() { const c = ready(); if (!c) return; tone(1800, c.currentTime, 0.03, { vol: 0.06, type: 'triangle' }); },
    select() { const c = ready(); if (!c) return; tone(1400, c.currentTime, 0.04, { vol: 0.05, type: 'triangle' }); },
    trail() { const c = ready(); if (!c) return; cardSlap(c.currentTime); },
    capture(n) {
      const c = ready(); if (!c) return;
      const t = c.currentTime;
      cardSlap(t, 0.7);
      const notes = [0, 4, 7, 12, 16];
      const k = Math.max(1, Math.min(notes.length, Math.ceil((n || 2) / 2)));
      for (let i = 0; i < k; i++) tone(N(notes[i]), t + 0.09 + i * 0.06, 0.35, { vol: 0.14, type: 'triangle' });
    },
    points() {
      const c = ready(); if (!c) return;
      const t = c.currentTime + 0.25;
      tone(N(19), t, 0.5, { vol: 0.12 });
      tone(N(24), t + 0.07, 0.6, { vol: 0.1 });
    },
    build() {
      const c = ready(); if (!c) return;
      const t = c.currentTime;
      cardSlap(t, 0.9);
      tone(330, t + 0.05, 0.12, { vol: 0.2, type: 'triangle' });
      tone(440, t + 0.13, 0.16, { vol: 0.2, type: 'triangle' });
    },
    tabbe() {
      const c = ready(); if (!c) return;
      const t = c.currentTime + 0.15;
      [0, 4, 7, 12].forEach((s, i) => {
        tone(N(s), t + i * 0.09, 0.45, { vol: 0.16, type: 'square' });
        tone(N(s + 12), t + i * 0.09, 0.45, { vol: 0.06 });
      });
      tone(N(16), t + 0.4, 0.9, { vol: 0.14, type: 'triangle' });
      noise(t + 0.38, 0.6, { filter: 'highpass', freq: 7000, vol: 0.08 });
    },
    turn() {
      const c = ready(); if (!c) return;
      const t = c.currentTime;
      tone(N(7), t, 0.25, { vol: 0.12 });
      tone(N(12), t + 0.1, 0.4, { vol: 0.12 });
    },
    deal(count) {
      const c = ready(); if (!c) return;
      const t = c.currentTime;
      // En mjuk, kort "fladdring" – inte en smäll per kort
      const k = Math.min(count || 4, 4);
      for (let i = 0; i < k; i++) noise(t + i * 0.06, 0.05, { freq: 2800, sweep: 1600, vol: 0.13, q: 0.9 });
    },
    shuffle() {
      const c = ready(); if (!c) return;
      const t = c.currentTime;
      for (let i = 0; i < 18; i++) noise(t + i * 0.022, 0.03, { freq: 3500 + Math.random() * 1500, vol: 0.12, q: 2 });
    },
    roundEnd() {
      const c = ready(); if (!c) return;
      const t = c.currentTime;
      [0, 7, 12].forEach((s, i) => tone(N(s - 12), t + i * 0.12, 0.5, { vol: 0.14, type: 'triangle' }));
    },
    win() {
      const c = ready(); if (!c) return;
      const t = c.currentTime;
      const mel = [0, 4, 7, 12, 7, 12, 16, 19];
      mel.forEach((s, i) => tone(N(s), t + i * 0.11, 0.3, { vol: 0.14, type: 'square' }));
      [0, 4, 7, 12].forEach((s) => tone(N(s), t + 0.9, 1.2, { vol: 0.08, type: 'triangle' }));
      noise(t + 0.9, 1, { filter: 'highpass', freq: 8000, vol: 0.06 });
    },
    lose() {
      const c = ready(); if (!c) return;
      const t = c.currentTime;
      [7, 5, 3, 0].forEach((s, i) => tone(N(s - 12), t + i * 0.18, 0.4, { vol: 0.14, type: 'triangle' }));
    },
    error() {
      const c = ready(); if (!c) return;
      const t = c.currentTime;
      tone(180, t, 0.12, { vol: 0.12, type: 'sawtooth', slide: 140 });
    },
    pop() {
      const c = ready(); if (!c) return;
      tone(500, c.currentTime, 0.12, { vol: 0.15, slide: 1100 });
    },
    join() {
      const c = ready(); if (!c) return;
      const t = c.currentTime;
      tone(N(0), t, 0.2, { vol: 0.1 });
      tone(N(7), t + 0.08, 0.3, { vol: 0.1 });
    },
  };

  const lastPlayed = {};
  let recent = [];
  window.Sound = {
    play(name, arg) {
      if (!sounds[name] || document.hidden) return;
      // Spärra dubbletter och för många ljud på en gång
      const now = performance.now();
      if (now - (lastPlayed[name] || 0) < 180) return;
      recent = recent.filter((x) => now - x < 300);
      if (recent.length >= 3 && name !== 'tabbe' && name !== 'win' && name !== 'lose') return;
      lastPlayed[name] = now;
      recent.push(now);
      try { sounds[name](arg); } catch (e) { /* ljud får aldrig stoppa spelet */ }
    },
    isMuted() { return muted; },
    setMuted(m) {
      muted = !!m;
      try { localStorage.setItem('kasino.muted', muted ? '1' : '0'); } catch (e) { /* */ }
      if (!muted) { unlock(); setTimeout(() => sounds.click(), 30); }
    },
  };
})();
