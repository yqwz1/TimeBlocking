// Real recordings and artist-produced music for the Focus view. Nature sounds
// and music stream from freely licensed Wikimedia Commons originals; only the
// explicitly labelled white/brown noise options are generated in the browser.

export type AmbienceType =
  | 'rain' | 'thunder' | 'fireplace' | 'ocean' | 'wind' | 'forest'
  | 'lofi' | 'lofi_jazz' | 'lofi_sleep' | 'lofi_rain' | 'white' | 'brown';

interface AmbienceMeta {
  label: string;
  credit: string;
  sourceUrl?: string;
}

export const AMBIENCE_META: Record<AmbienceType, AmbienceMeta> = {
  rain: { label: 'Rain', credit: 'Field recording by ジダネ', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Rain.ogg' },
  thunder: { label: 'Thunderstorm', credit: 'Field recording by Bidgee', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Rain_and_thunder_(01).ogg' },
  fireplace: { label: 'Campfire', credit: 'Recording by Glaneur de sons', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Campfire_sound_ambience.ogg' },
  ocean: { label: 'Lake shore', credit: 'Field recording by Dsw4', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Waves.ogg' },
  wind: { label: 'Woodland wind', credit: 'Field recording by nille', sourceUrl: 'https://commons.wikimedia.org/wiki/File:20090610_0_ambience.ogg' },
  forest: { label: 'Forest', credit: 'Field recording by nille', sourceUrl: 'https://commons.wikimedia.org/wiki/File:20090610_0_ambience.ogg' },
  lofi: { label: 'Lofi chill', credit: '“Aesthetic” — DreamHeaven', sourceUrl: 'https://commons.wikimedia.org/wiki/File:DreamHeaven_-_Aesthetic.ogg' },
  lofi_jazz: { label: 'Lofi upbeat', credit: '“Lofi Hip Hop Upbeat” — Raspberrymusic', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Raspberrymusic_-_Lofi_Hip_Hop_Upbeat.ogg' },
  lofi_sleep: { label: 'Lofi sleep', credit: '“Perspective” — Sappheiros', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Sappheiros_-_Perspective_(Lofi_Hip_Hop).ogg' },
  lofi_rain: { label: 'Lofi + rain', credit: 'DreamHeaven + field recording by ジダネ', sourceUrl: 'https://commons.wikimedia.org/wiki/File:DreamHeaven_-_Aesthetic.ogg' },
  white: { label: 'White noise', credit: 'Generated noise' },
  brown: { label: 'Brown noise', credit: 'Generated noise' },
};

const media = (filename: string) =>
  `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(filename)}`;

const SOURCES: Partial<Record<AmbienceType, string[]>> = {
  rain: [media('Rain.ogg')],
  thunder: [media('Rain and thunder (01).ogg')],
  fireplace: [media('Campfire sound ambience.ogg')],
  ocean: [media('Waves.ogg')],
  wind: [media('20090610 0 ambience.ogg')],
  forest: [media('20090610 0 ambience.ogg')],
  lofi: [media('DreamHeaven - Aesthetic.ogg')],
  lofi_jazz: [media('Raspberrymusic - Lofi Hip Hop Upbeat.ogg')],
  lofi_sleep: [media('Sappheiros - Perspective (Lofi Hip Hop).ogg')],
  lofi_rain: [media('DreamHeaven - Aesthetic.ogg'), media('Rain.ogg')],
};

interface Playback { stop: () => void; setVolume: (value: number) => void }
let current: ({ type: AmbienceType } & Playback) | null = null;
let volume = 0.6;
let noiseCtx: AudioContext | null = null;

function playRecordings(type: AmbienceType, urls: string[]): Playback {
  const players = urls.map((url, index) => {
    const audio = new Audio(url);
    audio.loop = true;
    audio.preload = 'auto';
    // Keep the rain layer behind the music in the combined preset.
    audio.volume = volume * (type === 'lofi_rain' && index === 1 ? 0.38 : 1);
    void audio.play().catch(() => { /* browser/network error: user can retry */ });
    return audio;
  });
  return {
    stop: () => players.forEach((audio) => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }),
    setVolume: (value) => players.forEach((audio, index) => {
      audio.volume = value * (type === 'lofi_rain' && index === 1 ? 0.38 : 1);
    }),
  };
}

function playNoise(kind: 'white' | 'brown'): Playback | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  noiseCtx ??= new Ctor();
  if (noiseCtx.state === 'suspended') void noiseCtx.resume();
  const length = noiseCtx.sampleRate * 4;
  const buffer = noiseCtx.createBuffer(1, length, noiseCtx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'brown') last = (last + 0.02 * white) / 1.02;
    data[i] = kind === 'brown' ? last * 3.5 : white;
  }
  const source = noiseCtx.createBufferSource();
  const gain = noiseCtx.createGain();
  source.buffer = buffer;
  source.loop = true;
  gain.gain.value = volume * (kind === 'white' ? 0.22 : 0.65);
  source.connect(gain).connect(noiseCtx.destination);
  source.start();
  return {
    stop: () => { source.stop(); source.disconnect(); gain.disconnect(); },
    setVolume: (value) => gain.gain.setTargetAtTime(value * (kind === 'white' ? 0.22 : 0.65), noiseCtx!.currentTime, 0.05),
  };
}

export function startAmbience(type: AmbienceType): boolean {
  if (typeof window === 'undefined') return false;
  stopAmbience();
  const urls = SOURCES[type];
  const playback = urls ? playRecordings(type, urls) : playNoise(type as 'white' | 'brown');
  if (!playback) return false;
  current = { type, ...playback };
  return true;
}

export function stopAmbience() {
  current?.stop();
  current = null;
}

export function currentAmbience(): AmbienceType | null { return current?.type ?? null; }

export function setAmbienceVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  current?.setVolume(volume);
}

export function getAmbienceVolume(): number { return volume; }
