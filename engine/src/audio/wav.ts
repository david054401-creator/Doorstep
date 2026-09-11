/**
 * WAV read and write, plus the small DSP the mix needs.
 *
 * No audio library: the loudness and sync invariants have to be measurable
 * anywhere the engine runs, including CI with nothing installed.
 */

export type AudioBuffer = {
  sampleRate: number;
  /** One Float32Array per channel, samples in -1..1. */
  channels: Float32Array[];
  get length(): number;
};

export function createAudio(sampleRate: number, channels: number, frames: number): AudioBuffer {
  const data = Array.from({ length: channels }, () => new Float32Array(frames));
  return {
    sampleRate,
    channels: data,
    get length() {
      return data[0]?.length ?? 0;
    },
  };
}

export function wrapAudio(sampleRate: number, channels: Float32Array[]): AudioBuffer {
  return {
    sampleRate,
    channels,
    get length() {
      return channels[0]?.length ?? 0;
    },
  };
}

export function decodeWav(buffer: Buffer): AudioBuffer {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('not a RIFF/WAVE file');
  }
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAVE file');

  let offset = 12;
  let format = 1;
  let numChannels = 1;
  let sampleRate = 48000;
  let bitsPerSample = 16;
  let dataStart = -1;
  let dataLength = 0;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = buffer.readUInt16LE(body);
      numChannels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
      if (format === 0xfffe && size >= 40) format = buffer.readUInt16LE(body + 24);
    } else if (id === 'data') {
      dataStart = body;
      dataLength = size;
    }
    offset = body + size + (size % 2);
  }
  if (dataStart < 0) throw new Error('WAVE file has no data chunk');

  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataLength / (bytesPerSample * numChannels));
  const channels = Array.from({ length: numChannels }, () => new Float32Array(frames));

  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < numChannels; c++) {
      const at = dataStart + (f * numChannels + c) * bytesPerSample;
      let v = 0;
      if (format === 3 && bitsPerSample === 32) v = buffer.readFloatLE(at);
      else if (bitsPerSample === 16) v = buffer.readInt16LE(at) / 32768;
      else if (bitsPerSample === 24) {
        const raw = buffer.readUIntLE(at, 3);
        v = (raw & 0x800000 ? raw - 0x1000000 : raw) / 8388608;
      } else if (bitsPerSample === 32) v = buffer.readInt32LE(at) / 2147483648;
      else if (bitsPerSample === 8) v = (buffer.readUInt8(at) - 128) / 128;
      channels[c][f] = v;
    }
  }
  return wrapAudio(sampleRate, channels);
}

export function encodeWav(audio: AudioBuffer, bitsPerSample: 16 | 24 | 32 = 16): Buffer {
  const numChannels = audio.channels.length;
  const frames = audio.length;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = frames * numChannels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(bitsPerSample === 32 ? 3 : 1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(audio.sampleRate, 24);
  buffer.writeUInt32LE(audio.sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  let at = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < numChannels; c++) {
      const v = Math.max(-1, Math.min(1, audio.channels[c][f]));
      if (bitsPerSample === 32) {
        buffer.writeFloatLE(v, at);
      } else if (bitsPerSample === 24) {
        const i = Math.round(v * 8388607);
        buffer.writeUIntLE(i < 0 ? i + 0x1000000 : i, at, 3);
      } else {
        buffer.writeInt16LE(Math.round(v * 32767), at);
      }
      at += bytesPerSample;
    }
  }
  return buffer;
}

/** Mix `src` into `dst` at a sample offset with a gain in dB. */
export function mixInto(dst: AudioBuffer, src: AudioBuffer, offsetSamples: number, gainDb = 0): void {
  const gain = 10 ** (gainDb / 20);
  for (let c = 0; c < dst.channels.length; c++) {
    const from = src.channels[Math.min(c, src.channels.length - 1)];
    const to = dst.channels[c];
    for (let i = 0; i < from.length; i++) {
      const j = offsetSamples + i;
      if (j < 0 || j >= to.length) continue;
      to[j] += from[i] * gain;
    }
  }
}

/** Peak sample magnitude. */
export function peak(audio: AudioBuffer): number {
  let p = 0;
  for (const ch of audio.channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (v > p) p = v;
    }
  }
  return p;
}

/** True-peak estimate via 4x oversampling with linear interpolation. */
export function truePeak(audio: AudioBuffer): number {
  let p = 0;
  for (const ch of audio.channels) {
    for (let i = 1; i < ch.length; i++) {
      for (let k = 0; k < 4; k++) {
        const t = k / 4;
        const v = Math.abs(ch[i - 1] * (1 - t) + ch[i] * t);
        if (v > p) p = v;
      }
    }
  }
  return p;
}

export function applyGain(audio: AudioBuffer, gainDb: number): AudioBuffer {
  const gain = 10 ** (gainDb / 20);
  return wrapAudio(
    audio.sampleRate,
    audio.channels.map((ch) => {
      const out = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) out[i] = ch[i] * gain;
      return out;
    }),
  );
}

/** Biquad filter state, used by the loudness weighting stages. */
export type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

export function applyBiquad(samples: Float32Array, f: Biquad): Float32Array {
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/** Short-time energy envelope, for silence and gap detection. */
export function envelope(audio: AudioBuffer, windowSamples: number): Float32Array {
  const n = Math.max(1, Math.floor(audio.length / windowSamples));
  const out = new Float32Array(n);
  for (let w = 0; w < n; w++) {
    let sum = 0;
    let count = 0;
    for (let c = 0; c < audio.channels.length; c++) {
      const ch = audio.channels[c];
      for (let i = w * windowSamples; i < Math.min(ch.length, (w + 1) * windowSamples); i++) {
        sum += ch[i] * ch[i];
        count++;
      }
    }
    out[w] = count > 0 ? Math.sqrt(sum / count) : 0;
  }
  return out;
}

/** Simple sine tone, used for scratch tracks and tests. */
export function tone(
  sampleRate: number,
  frequency: number,
  seconds: number,
  amplitude = 0.3,
): AudioBuffer {
  const n = Math.round(sampleRate * seconds);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Fade the ends so a tone never clicks.
    const fade = Math.min(1, i / (sampleRate * 0.01), (n - i) / (sampleRate * 0.01));
    ch[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude * fade;
  }
  return wrapAudio(sampleRate, [ch]);
}
