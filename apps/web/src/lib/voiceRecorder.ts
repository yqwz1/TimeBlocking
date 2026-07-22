export interface WavRecording {
  stop(): Promise<Blob>;
  cancel(): Promise<void>;
  level(): number;
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function downsample(samples: Float32Array, inputRate: number, outputRate = 16_000): Float32Array {
  if (inputRate <= outputRate) return samples;
  const ratio = inputRate / outputRate;
  const output = new Float32Array(Math.round(samples.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function startWavRecording(): Promise<WavRecording> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone recording is not supported on this device.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
  const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('Audio recording is not supported in this browser.');
  }

  const context = new AudioContextCtor();
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silentOutput = context.createGain();
  silentOutput.gain.value = 0;
  const chunks: Float32Array[] = [];
  let closed = false;

  processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  source.connect(analyser);
  analyser.connect(processor);
  processor.connect(silentOutput);
  silentOutput.connect(context.destination);

  const cleanup = async () => {
    if (closed) return;
    closed = true;
    processor.onaudioprocess = null;
    source.disconnect();
    analyser.disconnect();
    processor.disconnect();
    silentOutput.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
  };

  return {
    async stop() {
      const inputRate = context.sampleRate;
      await cleanup();
      const samples = downsample(mergeChunks(chunks), inputRate);
      return encodeWav(samples, inputRate > 16_000 ? 16_000 : inputRate);
    },
    cancel: cleanup,
    level() {
      if (closed) return 0;
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      return Math.min(1, Math.sqrt(sum / data.length) * 4);
    },
  };
}

interface BrowserSpeechController {
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/** Starts best-effort live captions. Gemini audio remains authoritative. */
export function startBrowserSpeech(onTranscript: (text: string) => void): BrowserSpeechController | null {
  const speechWindow = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  const Ctor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  let finalText = '';
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result?.[0]?.transcript ?? '';
      if (result?.isFinal) finalText += `${text} `;
      else interim += text;
    }
    onTranscript(`${finalText}${interim}`.trim());
  };
  recognition.onerror = () => {};
  try {
    recognition.start();
  } catch {
    return null;
  }
  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        // The browser service may have already ended; recorded WAV audio is unaffected.
      }
    },
    abort: () => {
      try {
        recognition.abort();
      } catch {
        // Already inactive.
      }
    },
  };
}
