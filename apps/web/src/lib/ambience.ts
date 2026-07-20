// Ambient soundscape engine for the Focus view. Everything is synthesized with
// Web Audio (noise buffers + filters + scheduled events) so no audio assets or
// network streams are needed. Independent of the UI sound-effects setting in
// sound.ts — ambience is something the user explicitly turns on.

export type AmbienceType =
  | 'rain'
  | 'thunder'
  | 'fireplace'
  | 'ocean'
  | 'wind'
  | 'forest'
  | 'lofi'
  | 'lofi_jazz'
  | 'lofi_sleep'
  | 'lofi_rain'
  | 'white'
  | 'brown';

export const AMBIENCE_META: Record<AmbienceType, { label: string }> = {
  rain: { label: 'Rain' },
  thunder: { label: 'Thunder' },
  fireplace: { label: 'Fireplace' },
  ocean: { label: 'Beach' },
  wind: { label: 'Wind' },
  forest: { label: 'Forest' },
  lofi: { label: 'Lofi chill' },
  lofi_jazz: { label: 'Lofi jazz' },
  lofi_sleep: { label: 'Lofi sleep' },
  lofi_rain: { label: 'Lofi rain' },
  white: { label: 'White noise' },
  brown: { label: 'Brown noise' },
};

type Cleanup = () => void;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let current: { type: AmbienceType; stop: Cleanup } | null = null;
let volume = 0.6;

function getCtx(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return { ctx, master: master! };
}

// ---------------------------------------------------------------------------
// Noise buffers (cached per context)

let whiteBuf: AudioBuffer | null = null;
let pinkBuf: AudioBuffer | null = null;
let brownBuf: AudioBuffer | null = null;

function noiseBuffer(ac: AudioContext, kind: 'white' | 'pink' | 'brown'): AudioBuffer {
  const cached = kind === 'white' ? whiteBuf : kind === 'pink' ? pinkBuf : brownBuf;
  if (cached && cached.sampleRate === ac.sampleRate) return cached;
  const len = ac.sampleRate * 4;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    whiteBuf = buf;
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
    brownBuf = buf;
  } else {
    // Paul Kellet's pink-noise approximation.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    pinkBuf = buf;
  }
  return buf;
}

function loopNoise(ac: AudioContext, kind: 'white' | 'pink' | 'brown'): AudioBufferSourceNode {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, kind);
  src.loop = true;
  src.start();
  return src;
}

// ---------------------------------------------------------------------------
// Soundscapes — each returns a cleanup function.

function makeRain(ac: AudioContext, out: AudioNode, intensity = 1): Cleanup {
  const src = loopNoise(ac, 'white');
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 500;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  const g = ac.createGain();
  g.gain.value = 0.35 * intensity;
  src.connect(hp).connect(lp).connect(g).connect(out);

  // Sparse droplet plinks on a window/leaf.
  const dropTimer = setInterval(() => {
    if (Math.random() > 0.6) return;
    const t = ac.currentTime + Math.random() * 0.2;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1600 + Math.random() * 2200, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.06);
    const dg = ac.createGain();
    dg.gain.setValueAtTime(0, t);
    dg.gain.linearRampToValueAtTime(0.015 + Math.random() * 0.02, t + 0.005);
    dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.connect(dg).connect(out);
    osc.start(t);
    osc.stop(t + 0.1);
  }, 350);

  return () => {
    clearInterval(dropTimer);
    src.stop();
    src.disconnect();
    g.disconnect();
  };
}

function makeThunder(ac: AudioContext, out: AudioNode): Cleanup {
  const stopRain = makeRain(ac, out, 0.85);

  let cancelled = false;
  let timeout: ReturnType<typeof setTimeout>;
  const rumble = () => {
    if (cancelled) return;
    const t = ac.currentTime + 0.05;
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac, 'brown');
    src.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(60, t + 3.5);
    const g = ac.createGain();
    const peak = 0.5 + Math.random() * 0.4;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.15 + Math.random() * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3 + Math.random() * 2.5);
    src.connect(lp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 6.5);
    timeout = setTimeout(rumble, 9000 + Math.random() * 21000);
  };
  timeout = setTimeout(rumble, 2500 + Math.random() * 5000);

  return () => {
    cancelled = true;
    clearTimeout(timeout);
    stopRain();
  };
}

function makeFireplace(ac: AudioContext, out: AudioNode): Cleanup {
  // Low roar of the fire.
  const src = loopNoise(ac, 'brown');
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g = ac.createGain();
  g.gain.value = 0.4;
  src.connect(lp).connect(g).connect(out);

  // Random crackles and pops.
  const crackleTimer = setInterval(() => {
    const n = Math.random() < 0.35 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const t = ac.currentTime + Math.random() * 0.25;
      const pop = ac.createBufferSource();
      pop.buffer = noiseBuffer(ac, 'white');
      pop.playbackRate.value = 0.6 + Math.random() * 1.4;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200 + Math.random() * 3500;
      bp.Q.value = 1.2;
      const pg = ac.createGain();
      pg.gain.setValueAtTime(0, t);
      pg.gain.linearRampToValueAtTime(0.04 + Math.random() * 0.12, t + 0.003);
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.05);
      pop.connect(bp).connect(pg).connect(out);
      pop.start(t, Math.random() * 3);
      pop.stop(t + 0.12);
    }
  }, 180);

  return () => {
    clearInterval(crackleTimer);
    src.stop();
    src.disconnect();
    g.disconnect();
  };
}

function makeOcean(ac: AudioContext, out: AudioNode): Cleanup {
  const src = loopNoise(ac, 'pink');
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;

  // Slow swell: an LFO drives both loudness and brightness so waves "break".
  const g = ac.createGain();
  g.gain.value = 0.35;
  const lfo = ac.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.08; // ~12s per wave
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 0.22;
  lfo.connect(lfoGain).connect(g.gain);
  const lfoFilter = ac.createGain();
  lfoFilter.gain.value = 450;
  lfo.connect(lfoFilter).connect(lp.frequency);
  lfo.start();

  // A second, faster shimmer for foam.
  const foam = loopNoise(ac, 'white');
  const foamHp = ac.createBiquadFilter();
  foamHp.type = 'highpass';
  foamHp.frequency.value = 3000;
  const foamG = ac.createGain();
  foamG.gain.value = 0.015;
  const foamLfo = ac.createOscillator();
  foamLfo.frequency.value = 0.08;
  const foamLfoG = ac.createGain();
  foamLfoG.gain.value = 0.012;
  foamLfo.connect(foamLfoG).connect(foamG.gain);
  foamLfo.start();
  foam.connect(foamHp).connect(foamG).connect(out);

  src.connect(lp).connect(g).connect(out);

  return () => {
    lfo.stop();
    foamLfo.stop();
    src.stop();
    foam.stop();
    src.disconnect();
    foam.disconnect();
    g.disconnect();
    foamG.disconnect();
  };
}

function makeWind(ac: AudioContext, out: AudioNode): Cleanup {
  const src = loopNoise(ac, 'pink');
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 500;
  bp.Q.value = 0.7;
  const g = ac.createGain();
  g.gain.value = 0.45;
  src.connect(bp).connect(g).connect(out);

  // Wandering gusts: retarget filter frequency and gain every few seconds.
  const gustTimer = setInterval(() => {
    const t = ac.currentTime;
    const dur = 2 + Math.random() * 4;
    bp.frequency.cancelScheduledValues(t);
    bp.frequency.setTargetAtTime(250 + Math.random() * 700, t, dur / 3);
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0.25 + Math.random() * 0.4, t, dur / 3);
  }, 3000);

  return () => {
    clearInterval(gustTimer);
    src.stop();
    src.disconnect();
    g.disconnect();
  };
}

function makeForest(ac: AudioContext, out: AudioNode): Cleanup {
  // Gentle breeze bed.
  const src = loopNoise(ac, 'pink');
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1000;
  const g = ac.createGain();
  g.gain.value = 0.18;
  src.connect(lp).connect(g).connect(out);

  // Occasional birdsong: short chirp sequences with pitch slides.
  let cancelled = false;
  let timeout: ReturnType<typeof setTimeout>;
  const sing = () => {
    if (cancelled) return;
    const chirps = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1800;
    let at = ac.currentTime + 0.05;
    for (let i = 0; i < chirps; i++) {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      const f0 = base * (0.9 + Math.random() * 0.25);
      const dur = 0.06 + Math.random() * 0.12;
      osc.frequency.setValueAtTime(f0, at);
      osc.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.4 : 0.75), at + dur);
      const cg = ac.createGain();
      cg.gain.setValueAtTime(0, at);
      cg.gain.linearRampToValueAtTime(0.03 + Math.random() * 0.03, at + 0.015);
      cg.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(cg).connect(out);
      osc.start(at);
      osc.stop(at + dur + 0.02);
      at += dur + 0.04 + Math.random() * 0.12;
    }
    timeout = setTimeout(sing, 2500 + Math.random() * 8000);
  };
  timeout = setTimeout(sing, 1000 + Math.random() * 2000);

  return () => {
    cancelled = true;
    clearTimeout(timeout);
    src.stop();
    src.disconnect();
    g.disconnect();
  };
}

function makePlainNoise(ac: AudioContext, out: AudioNode, kind: 'white' | 'brown'): Cleanup {
  const src = loopNoise(ac, kind);
  const g = ac.createGain();
  g.gain.value = kind === 'white' ? 0.12 : 0.4;
  src.connect(g).connect(out);
  return () => {
    src.stop();
    src.disconnect();
    g.disconnect();
  };
}

// ---------------------------------------------------------------------------
// Generative lofi: a slow jazz chord loop on a mellow "Rhodes-ish" voice, a
// sine bass, a laid-back kick/snare/hat groove, and vinyl crackle on top.
// Parameterized so different flavors (chill / jazz / sleep / rainy) share the
// same engine with different progressions, tempo, and instrumentation.

interface LofiConfig {
  bpm: number;
  /** Chord voicings as semitones from C4, one chord per bar. */
  chords: number[][];
  /** Bass roots (semitones from C4, played two octaves down), one per bar. */
  bass: number[];
  drums: boolean;
  hats: boolean;
  /** Lowpass cutoff for the musical bus — lower = darker/dreamier. */
  warmCutoff: number;
  padGain: number;
  bassGain: number;
  /** 0..1 — how far off-grid the offbeat hats land. */
  swing: number;
  /** If set, layer rain under the beat at this intensity. */
  rain?: number;
}

const LOFI_CONFIGS: Record<'chill' | 'jazz' | 'sleep', LofiConfig> = {
  // Fmaj7 – Em7 – Dm7 – Cmaj7: the classic descending lofi loop.
  chill: {
    bpm: 72,
    chords: [
      [5, 9, 12, 16],
      [4, 7, 11, 14],
      [2, 5, 9, 12],
      [0, 4, 7, 11],
    ],
    bass: [5, 4, 2, 0],
    drums: true,
    hats: true,
    warmCutoff: 2200,
    padGain: 0.028,
    bassGain: 0.14,
    swing: 0.08,
  },
  // Dm9 – G7 – Cmaj9 – Am7: a ii–V–I–vi turnaround with 9ths, harder swing.
  jazz: {
    bpm: 82,
    chords: [
      [2, 5, 9, 12, 16],
      [-5, -1, 2, 5],
      [0, 4, 7, 11, 14],
      [-3, 0, 4, 7],
    ],
    bass: [2, -5, 0, -3],
    drums: true,
    hats: true,
    warmCutoff: 2600,
    padGain: 0.024,
    bassGain: 0.15,
    swing: 0.14,
  },
  // Am7 – Fmaj7 – Cmaj7 – Em7: slow, dark, and drum-free for winding down.
  sleep: {
    bpm: 56,
    chords: [
      [-3, 0, 4, 7],
      [5, 9, 12, 16],
      [0, 4, 7, 11],
      [4, 7, 11, 14],
    ],
    bass: [-3, 5, 0, 4],
    drums: false,
    hats: false,
    warmCutoff: 1400,
    padGain: 0.034,
    bassGain: 0.1,
    swing: 0,
  },
};

function midiFromC4(semi: number, octaveShift = 0): number {
  return 261.63 * Math.pow(2, (semi + octaveShift * 12) / 12);
}

function makeLofi(ac: AudioContext, out: AudioNode, cfg: LofiConfig): Cleanup {
  const stopRain = cfg.rain != null ? makeRain(ac, out, cfg.rain) : null;
  // Vinyl bed: quiet hiss + sparse dusty pops.
  const hiss = loopNoise(ac, 'pink');
  const hissHp = ac.createBiquadFilter();
  hissHp.type = 'highpass';
  hissHp.frequency.value = 2500;
  const hissG = ac.createGain();
  hissG.gain.value = 0.01;
  hiss.connect(hissHp).connect(hissG).connect(out);

  const popTimer = setInterval(() => {
    if (Math.random() > 0.4) return;
    const t = ac.currentTime + Math.random() * 0.3;
    const pop = ac.createBufferSource();
    pop.buffer = noiseBuffer(ac, 'white');
    const pg = ac.createGain();
    pg.gain.setValueAtTime(0, t);
    pg.gain.linearRampToValueAtTime(0.02 + Math.random() * 0.03, t + 0.002);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
    pop.connect(pg).connect(out);
    pop.start(t, Math.random() * 3);
    pop.stop(t + 0.03);
  }, 400);

  // Everything musical goes through a dark lowpass for that tape warmth.
  const warm = ac.createBiquadFilter();
  warm.type = 'lowpass';
  warm.frequency.value = cfg.warmCutoff;
  warm.connect(out);

  const beat = 60 / cfg.bpm;
  const barLen = beat * 4;
  let bar = 0;
  let nextBarTime = ac.currentTime + 0.1;
  let cancelled = false;

  const scheduleBar = (t: number, barIdx: number) => {
    const chord = cfg.chords[barIdx % cfg.chords.length];
    const bass = cfg.bass[barIdx % cfg.bass.length];

    // Chord pad — slightly detuned triangles with a soft attack, held the bar.
    for (const semi of chord) {
      for (const det of [-3, 3]) {
        const osc = ac.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = midiFromC4(semi);
        osc.detune.value = det + (Math.random() * 4 - 2);
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(cfg.padGain, t + 0.4);
        g.gain.setValueAtTime(cfg.padGain, t + barLen - 0.6);
        g.gain.linearRampToValueAtTime(0, t + barLen);
        osc.connect(g).connect(warm);
        osc.start(t);
        osc.stop(t + barLen + 0.05);
      }
    }

    // Bass — root on beats 1 and 3.
    for (const beatIdx of [0, 2]) {
      const bt = t + beatIdx * beat;
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = midiFromC4(bass, -2);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, bt);
      g.gain.linearRampToValueAtTime(cfg.bassGain, bt + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, bt + beat * 1.6);
      osc.connect(g).connect(warm);
      osc.start(bt);
      osc.stop(bt + beat * 1.7);
    }

    // Drums — kick on 1 & 3, snare(ish) on 2 & 4, hats on eighths w/ swing.
    if (!cfg.drums) return;
    for (const beatIdx of [0, 2]) {
      const kt = t + beatIdx * beat;
      const osc = ac.createOscillator();
      osc.frequency.setValueAtTime(120, kt);
      osc.frequency.exponentialRampToValueAtTime(45, kt + 0.12);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.22, kt);
      g.gain.exponentialRampToValueAtTime(0.0001, kt + 0.18);
      osc.connect(g).connect(warm);
      osc.start(kt);
      osc.stop(kt + 0.2);
    }
    for (const beatIdx of [1, 3]) {
      const st = t + beatIdx * beat + 0.02; // lazy, behind the beat
      const snap = ac.createBufferSource();
      snap.buffer = noiseBuffer(ac, 'white');
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 0.8;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.06, st);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.12);
      snap.connect(bp).connect(g).connect(warm);
      snap.start(st, Math.random() * 3);
      snap.stop(st + 0.15);
    }
    if (!cfg.hats) return;
    for (let e = 0; e < 8; e++) {
      const swing = e % 2 === 1 ? beat * cfg.swing : 0;
      const ht = t + e * beat * 0.5 + swing;
      const hat = ac.createBufferSource();
      hat.buffer = noiseBuffer(ac, 'white');
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      const g = ac.createGain();
      g.gain.setValueAtTime(e % 2 === 0 ? 0.02 : 0.012, ht);
      g.gain.exponentialRampToValueAtTime(0.0001, ht + 0.05);
      hat.connect(hp).connect(g).connect(warm);
      hat.start(ht, Math.random() * 3);
      hat.stop(ht + 0.07);
    }
  };

  // Lookahead scheduler: keep ~2 bars queued.
  const tick = setInterval(() => {
    if (cancelled) return;
    while (nextBarTime < ac.currentTime + barLen * 2) {
      scheduleBar(nextBarTime, bar);
      bar += 1;
      nextBarTime += barLen;
    }
  }, 500);
  // Prime immediately.
  scheduleBar(nextBarTime, bar);
  bar += 1;
  nextBarTime += barLen;

  return () => {
    cancelled = true;
    clearInterval(tick);
    clearInterval(popTimer);
    stopRain?.();
    hiss.stop();
    hiss.disconnect();
    hissG.disconnect();
    warm.disconnect();
  };
}

// ---------------------------------------------------------------------------
// Public API

const BUILDERS: Record<AmbienceType, (ac: AudioContext, out: AudioNode) => Cleanup> = {
  rain: (ac, out) => makeRain(ac, out),
  thunder: makeThunder,
  fireplace: makeFireplace,
  ocean: makeOcean,
  wind: makeWind,
  forest: makeForest,
  lofi: (ac, out) => makeLofi(ac, out, LOFI_CONFIGS.chill),
  lofi_jazz: (ac, out) => makeLofi(ac, out, LOFI_CONFIGS.jazz),
  lofi_sleep: (ac, out) => makeLofi(ac, out, LOFI_CONFIGS.sleep),
  lofi_rain: (ac, out) => makeLofi(ac, out, { ...LOFI_CONFIGS.chill, rain: 0.5 }),
  white: (ac, out) => makePlainNoise(ac, out, 'white'),
  brown: (ac, out) => makePlainNoise(ac, out, 'brown'),
};

export function startAmbience(type: AmbienceType): boolean {
  const audio = getCtx();
  if (!audio) return false;
  stopAmbience();
  const stop = BUILDERS[type](audio.ctx, audio.master);
  current = { type, stop };
  return true;
}

export function stopAmbience() {
  if (current) {
    current.stop();
    current = null;
  }
}

export function currentAmbience(): AmbienceType | null {
  return current?.type ?? null;
}

export function setAmbienceVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
}

export function getAmbienceVolume(): number {
  return volume;
}
