// His sounds, made with WebAudio so the prototype needs no files: a chirp when he
// speaks, footsteps, and the two background loops. Nothing plays until you've
// clicked something (browsers hold audio until then anyway).
(function (PAH) {
  'use strict';
  const VOLUME = Object.freeze({ Soft: 0.04, Normal: 0.08, Loud: 0.14 });
  const SURF = Object.freeze({ cutoff: 520, swell: 0.11, depth: 0.32, base: 0.45 });
  const DRIP = Object.freeze({ minGap: 380, maxGap: 1500 });

  let ctx = null;
  let master = null;
  let volume = VOLUME.Normal;
  let bgKind = 'Silence';
  let bgStop = null;

  function ensure() {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function blip(from, to, seconds, type = 'square', gain = 0.5, delay = 0) {
    const c = ensure();
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + seconds);
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    osc.connect(env).connect(master);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }

  function noiseBuffer(c) {
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function startSurf() {
    const c = ensure();
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = SURF.cutoff;
    const swell = c.createGain();
    swell.gain.value = SURF.base;
    const lfo = c.createOscillator();
    lfo.frequency.value = SURF.swell;
    const depth = c.createGain();
    depth.gain.value = SURF.depth;
    lfo.connect(depth).connect(swell.gain);
    src.connect(filter).connect(swell).connect(master);
    src.start();
    lfo.start();
    return () => { src.stop(); lfo.stop(); swell.disconnect(); };
  }

  function startPool() {
    let timer = 0;
    const drip = () => {
      const pitch = 900 + Math.random() * 900;
      blip(pitch, pitch * 0.55, 0.12, 'sine', 0.35);
      timer = setTimeout(drip, DRIP.minGap + Math.random() * (DRIP.maxGap - DRIP.minGap));
    };
    drip();
    return () => clearTimeout(timer);
  }

  PAH.sound = {
    chirp() { blip(900, 1400, 0.06, 'square', 0.35); blip(1250, 1800, 0.07, 'square', 0.3, 0.075); },
    step() { blip(240, 150, 0.035, 'triangle', 0.3); },
    snip() { blip(2400, 1200, 0.05, 'square', 0.25); blip(2600, 1300, 0.05, 'square', 0.25, 0.06); },
    tada() { [523, 659, 784, 1046].forEach((f, i) => blip(f, f, 0.14, 'triangle', 0.35, i * 0.08)); },
    setVolume(label) {
      volume = VOLUME[label] || VOLUME.Normal;
      if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
    },
    setBackground(kind) {
      if (kind === bgKind) return;
      if (bgStop) bgStop();
      bgStop = null;
      bgKind = kind;
      if (kind === 'Rolling surf') bgStop = startSurf();
      else if (kind === 'Rock pool') bgStop = startPool();
    },
  };
})(window.PAH);
