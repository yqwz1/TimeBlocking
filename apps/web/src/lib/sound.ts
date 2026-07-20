let ctx: AudioContext | null = null;

// Synced from the server `soundEffects` setting by Layout; defaults on so the
// first interaction before settings load still gives feedback.
let soundEnabled = true;

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
}

function getCtx(): AudioContext | null {
  if (!soundEnabled) return null;
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface Tone {
  freq: number;
  /** seconds after the sequence starts */
  at: number;
  dur?: number;
  gain?: number;
  type?: OscillatorType;
}

function playTones(tones: Tone[]) {
  const audioCtx = getCtx();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  for (const t of tones) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = t.type ?? 'sine';
    osc.frequency.value = t.freq;
    const start = now + t.at;
    const dur = t.dur ?? 0.32;
    const peak = t.gain ?? 0.22;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }
}

/** Bright two-note ascending chime (C6 -> E6) — task/habit completed. */
export function playCompletionChime() {
  playTones([
    { freq: 1046.5, at: 0 },
    { freq: 1318.5, at: 0.085 },
  ]);
}

/** Soft single ping — a reminder or notification arrived. Quieter than the completion chime. */
export function playNotificationPing() {
  playTones([
    { freq: 987.8, at: 0, dur: 0.28, gain: 0.14 },
    { freq: 1479.98, at: 0.06, dur: 0.34, gain: 0.1 },
  ]);
}

/** Rising three-note arpeggio (C5 -> E5 -> G5 -> C6) — level up. */
export function playLevelUp() {
  playTones([
    { freq: 523.25, at: 0, dur: 0.25, gain: 0.18 },
    { freq: 659.25, at: 0.1, dur: 0.25, gain: 0.18 },
    { freq: 783.99, at: 0.2, dur: 0.28, gain: 0.18 },
    { freq: 1046.5, at: 0.32, dur: 0.45, gain: 0.2 },
  ]);
}

/** Two-note sparkle (triangle) — achievement unlocked. */
export function playAchievement() {
  playTones([
    { freq: 1318.5, at: 0, dur: 0.3, gain: 0.16, type: 'triangle' },
    { freq: 1760, at: 0.09, dur: 0.4, gain: 0.14, type: 'triangle' },
  ]);
}

/** Two-tone alert (A5 -> E6) — a focus-timer phase finished. */
export function playTimerDone() {
  playTones([
    { freq: 880, at: 0, dur: 0.35, gain: 0.25 },
    { freq: 1320, at: 0.18, dur: 0.4, gain: 0.25 },
  ]);
}
