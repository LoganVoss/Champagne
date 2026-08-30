import {
  clamp,
  dbToGain,
  gainToDb,
  type AudioAnalysis,
  type MasteringModifiers,
  type StyleId,
  STYLE_RECIPES,
  type TrimSettings,
} from '@/lib/studio';

const WAV_SAMPLE_RATE = 48_000;

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const AudioContextConstructor = window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('Web Audio is not available in this browser.');
  const context = new AudioContextConstructor();
  try {
    const bytes = await file.arrayBuffer();
    return await context.decodeAudioData(bytes.slice(0));
  } finally {
    await context.close();
  }
}

export function analyzeAudioBuffer(buffer: AudioBuffer): AudioAnalysis {
  let peak = 0;
  let energy = 0;
  let sampleCount = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const sample = Math.abs(data[index]);
      if (sample > peak) peak = sample;
      energy += sample * sample;
    }
    sampleCount += data.length;
  }

  const rms = Math.sqrt(energy / Math.max(1, sampleCount));
  const samplePeakDbfs = gainToDb(peak);
  const rmsDbfs = gainToDb(rms);
  const crestFactorDb = samplePeakDbfs - rmsDbfs;
  const headroomDb = Math.max(0, -samplePeakDbfs);
  const flags: string[] = [];
  if (crestFactorDb >= 9) flags.push('healthy_transient_range');
  if (crestFactorDb < 6) flags.push('already_dense');
  if (headroomDb >= 3) flags.push('comfortable_headroom');
  if (samplePeakDbfs > -0.15) flags.push('near_digital_ceiling');
  if (rmsDbfs < -22) flags.push('quiet_source');

  return {
    durationSeconds: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    samplePeakDbfs,
    rmsDbfs,
    crestFactorDb,
    headroomDb,
    flags,
  };
}

export function makeWaveform(buffer: AudioBuffer, target = 420): number[] {
  const channels = Math.min(2, buffer.numberOfChannels);
  const bins = Math.max(32, Math.min(target, buffer.length));
  const step = buffer.length / bins;
  const peaks = new Array<number>(bins).fill(0);

  for (let bin = 0; bin < bins; bin += 1) {
    const start = Math.floor(bin * step);
    const end = Math.min(buffer.length, Math.max(start + 1, Math.floor((bin + 1) * step)));
    let peak = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = start; index < end; index += 1) {
        const value = Math.abs(data[index]);
        if (value > peak) peak = value;
      }
    }
    peaks[bin] = peak;
  }

  const max = Math.max(1e-6, ...peaks);
  return peaks.map((peak) => clamp(peak / max, 0.025, 1));
}

export function createDemoTrack(): AudioBuffer {
  const sampleRate = WAV_SAMPLE_RATE;
  const duration = 18;
  const length = duration * sampleRate;
  const buffer = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let noiseState = 0x9e3779b9;
  const noise = () => {
    noiseState ^= noiseState << 13;
    noiseState ^= noiseState >>> 17;
    noiseState ^= noiseState << 5;
    return ((noiseState >>> 0) / 0xffffffff) * 2 - 1;
  };
  const bpm = 122;
  const beat = 60 / bpm;
  const notes = [55, 55, 65.406, 49, 73.416, 65.406, 55, 49];

  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    const beatIndex = Math.floor(time / beat);
    const beatPhase = time - beatIndex * beat;
    const eighth = beat / 2;
    const eighthIndex = Math.floor(time / eighth);
    const eighthPhase = time - eighthIndex * eighth;

    const kickEnv = Math.exp(-beatPhase * 18);
    const kickFreq = 48 + 95 * Math.exp(-beatPhase * 35);
    const kick = Math.sin(2 * Math.PI * kickFreq * beatPhase) * kickEnv * 0.56;

    const snareBeat = beatIndex % 4 === 1 || beatIndex % 4 === 3;
    const snareEnv = snareBeat ? Math.exp(-beatPhase * 22) : 0;
    const snare = noise() * snareEnv * 0.18 + Math.sin(2 * Math.PI * 185 * beatPhase) * snareEnv * 0.08;

    const hatEnv = Math.exp(-eighthPhase * 70);
    const hat = (noise() - 0.72 * noise()) * hatEnv * (eighthIndex % 2 ? 0.055 : 0.035);

    const note = notes[Math.floor(time / (beat * 2)) % notes.length];
    const bassPhase = time % (beat * 2);
    const bassEnv = Math.min(1, bassPhase * 50) * Math.exp(-bassPhase * 1.6);
    const bass = (Math.sin(2 * Math.PI * note * time) + 0.22 * Math.sin(4 * Math.PI * note * time)) * bassEnv * 0.18;

    const chordPhase = time * 0.25;
    const pad = (
      Math.sin(2 * Math.PI * 220 * time + Math.sin(time * 0.7) * 0.3) +
      0.55 * Math.sin(2 * Math.PI * 277.18 * time + 0.7) +
      0.42 * Math.sin(2 * Math.PI * 329.63 * time + 1.3)
    ) * (0.055 + 0.018 * Math.sin(2 * Math.PI * chordPhase));

    const rise = time > 14 ? noise() * ((time - 14) / 4) * 0.05 : 0;
    const sample = kick + snare + hat + bass + pad + rise;
    left[index] = clamp(sample + pad * Math.sin(time * 0.39) * 0.08, -0.94, 0.94);
    right[index] = clamp(sample - pad * Math.sin(time * 0.43) * 0.09 + hat * 0.12, -0.94, 0.94);
  }
  return buffer;
}

function makeSaturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const length = 16_384;
  const curve = new Float32Array(new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
  const drive = 1 + amount * 3.2;
  const norm = Math.tanh(drive);
  for (let index = 0; index < length; index += 1) {
    const x = (index / (length - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * drive) / norm;
  }
  return curve;
}

export async function renderMasteringTake(
  input: AudioBuffer,
  styleId: StyleId,
  modifiers: MasteringModifiers,
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const recipe = STYLE_RECIPES[styleId];
  const channels = Math.min(2, input.numberOfChannels);
  const offline = new OfflineAudioContext(channels, input.length, input.sampleRate);
  const source = offline.createBufferSource();
  source.buffer = input;

  const highPass = offline.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = 27;
  highPass.Q.value = 0.707;

  const lowShelf = offline.createBiquadFilter();
  lowShelf.type = 'lowshelf';
  lowShelf.frequency.value = 95;
  lowShelf.gain.value = clamp(recipe.lowColorDb + modifiers.warmth * 1.6, -1.5, 2.25);

  const mud = offline.createBiquadFilter();
  mud.type = 'peaking';
  mud.frequency.value = 310;
  mud.Q.value = 0.82;
  mud.gain.value = clamp(-modifiers.warmth * 0.3, -0.8, 0.4);

  const presence = offline.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 2_300;
  presence.Q.value = 0.9;
  presence.gain.value = clamp(recipe.presenceDb + modifiers.brightness * 0.65, -0.4, 1.6);

  const air = offline.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 11_500;
  air.gain.value = clamp(recipe.airColorDb + modifiers.brightness * 1.75, -1.6, 2.1);

  const compressor = offline.createDynamicsCompressor();
  const compressionScale = clamp(1 + modifiers.intensity * 0.5 - modifiers.dynamics * 0.55 - modifiers.punch * 0.25, 0.45, 1.35);
  compressor.threshold.value = -18 - recipe.compression * 6 * compressionScale;
  compressor.knee.value = 6;
  compressor.ratio.value = 1 + recipe.compression * 2.1 * compressionScale;
  compressor.attack.value = clamp(0.018 + modifiers.punch * 0.018, 0.008, 0.055);
  compressor.release.value = 0.15;

  const saturation = offline.createWaveShaper();
  saturation.curve = makeSaturationCurve(clamp(recipe.midDrive + modifiers.warmth * 0.08, 0.04, 0.42));
  saturation.oversample = '2x';

  source.connect(highPass);
  highPass.connect(lowShelf);
  lowShelf.connect(mud);
  mud.connect(presence);
  presence.connect(air);
  air.connect(compressor);
  compressor.connect(saturation);
  saturation.connect(offline.destination);
  source.start();

  const filtered = await offline.startRendering();
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  return finalizeMaster(filtered, recipe.targetLufs, recipe.ceilingDbtp, recipe.width, modifiers);
}

function finalizeMaster(
  input: AudioBuffer,
  targetLufs: number,
  ceilingDbtp: number,
  width: number,
  modifiers: MasteringModifiers,
): AudioBuffer {
  const channels = Math.min(2, input.numberOfChannels);
  const output = new AudioBuffer({
    length: input.length,
    numberOfChannels: channels,
    sampleRate: input.sampleRate,
  });
  const prepared = Array.from({ length: channels }, () => new Float32Array(input.length));

  if (channels === 2) {
    const left = input.getChannelData(0);
    const right = input.getChannelData(1);
    const outLeft = prepared[0];
    const outRight = prepared[1];
    const safeWidth = clamp(width + modifiers.brightness * 0.03, 0.94, 1.18);
    for (let index = 0; index < input.length; index += 1) {
      const mid = (left[index] + right[index]) * 0.5;
      const side = (left[index] - right[index]) * 0.5 * safeWidth;
      outLeft[index] = mid + side;
      outRight[index] = mid - side;
    }
  } else {
    prepared[0].set(input.getChannelData(0));
  }

  let energy = 0;
  for (const channel of prepared) {
    for (let index = 0; index < channel.length; index += 1) energy += channel[index] * channel[index];
  }
  const rms = Math.sqrt(energy / Math.max(1, input.length * channels));
  const target = targetLufs + modifiers.intensity * 2.2 - modifiers.dynamics * 0.65;
  const makeupDb = clamp(target - gainToDb(rms), -5, 12);
  const makeup = dbToGain(makeupDb);
  const ceiling = dbToGain(ceilingDbtp);
  const lookahead = Math.max(1, Math.floor(input.sampleRate * 0.005));
  const releaseCoefficient = Math.exp(-1 / (input.sampleRate * 0.11));
  const peaks = new Float32Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    let peak = 0;
    for (const channel of prepared) peak = Math.max(peak, Math.abs(channel[index] * makeup));
    peaks[index] = peak;
  }

  const deque = new Int32Array(input.length);
  let head = 0;
  let tail = 0;
  const enqueue = (index: number) => {
    while (tail > head && peaks[deque[tail - 1]] <= peaks[index]) tail -= 1;
    deque[tail] = index;
    tail += 1;
  };
  for (let index = 0; index <= Math.min(lookahead, input.length - 1); index += 1) enqueue(index);

  let limiterGain = 1;
  for (let index = 0; index < input.length; index += 1) {
    while (tail > head && deque[head] < index) head += 1;
    const futurePeak = tail > head ? peaks[deque[head]] : peaks[index];
    const desired = futurePeak > ceiling ? ceiling / futurePeak : 1;
    if (desired < limiterGain) limiterGain = desired;
    else limiterGain = releaseCoefficient * limiterGain + (1 - releaseCoefficient) * desired;

    for (let channel = 0; channel < channels; channel += 1) {
      output.getChannelData(channel)[index] = clamp(prepared[channel][index] * makeup * limiterGain, -ceiling, ceiling);
    }
    const next = index + lookahead + 1;
    if (next < input.length) enqueue(next);
  }
  return output;
}

async function resample(buffer: AudioBuffer, sampleRate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === sampleRate) return buffer;
  const length = Math.max(1, Math.ceil(buffer.duration * sampleRate));
  const offline = new OfflineAudioContext(Math.min(2, buffer.numberOfChannels), length, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return offline.startRendering();
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function parabolicFadeGain(normalizedDistance: number): number {
  const x = clamp(normalizedDistance, 0, 1);
  return (x * (4 - x)) / 3;
}

export async function encodeMasterWav24(
  source: AudioBuffer,
  trim: TrimSettings,
): Promise<Blob> {
  const buffer = await resample(source, WAV_SAMPLE_RATE);
  const channels = Math.min(2, buffer.numberOfChannels);
  const startFrame = clamp(Math.floor(trim.startSeconds * WAV_SAMPLE_RATE), 0, buffer.length - 1);
  const endFrame = clamp(Math.ceil(trim.endSeconds * WAV_SAMPLE_RATE), startFrame + 1, buffer.length);
  const frames = endFrame - startFrame;
  const bytesPerSample = 3;
  const dataSize = frames * channels * bytesPerSample;
  const bytes = new ArrayBuffer(44 + dataSize);
  const view = new DataView(bytes);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, WAV_SAMPLE_RATE, true);
  view.setUint32(28, WAV_SAMPLE_RATE * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 24, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const fadeInFrames = Math.min(Math.floor(trim.fadeInSeconds * WAV_SAMPLE_RATE), Math.floor(frames * 0.45));
  const fadeOutFrames = Math.min(Math.floor(trim.fadeOutSeconds * WAV_SAMPLE_RATE), Math.floor(frames * 0.45));
  let randomState = (startFrame ^ frames ^ 0xa5a5a5a5) >>> 0;
  const uniform = () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 0xffffffff;
  };

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    let fadeGain = 1;
    if (fadeInFrames > 1 && frame < fadeInFrames) {
      fadeGain = parabolicFadeGain(frame / (fadeInFrames - 1));
    } else if (fadeOutFrames > 1 && frame >= frames - fadeOutFrames) {
      fadeGain = parabolicFadeGain((frames - 1 - frame) / (fadeOutFrames - 1));
    }

    for (let channel = 0; channel < channels; channel += 1) {
      const dither = (uniform() - uniform()) / 8_388_608;
      const value = clamp(buffer.getChannelData(channel)[startFrame + frame] * fadeGain + dither, -1, 0.99999988);
      let integer = Math.round(value * 8_388_607);
      if (integer < 0) integer += 0x1000000;
      view.setUint8(offset, integer & 0xff);
      view.setUint8(offset + 1, (integer >>> 8) & 0xff);
      view.setUint8(offset + 2, (integer >>> 16) & 0xff);
      offset += 3;
    }
  }

  return new Blob([bytes], { type: 'audio/wav' });
}
