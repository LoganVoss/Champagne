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
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextConstructor)
    throw new Error('Web Audio is not available in this browser.');
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
  const peaks = Array.from({ length: bins }, () => 0);

  for (let bin = 0; bin < bins; bin += 1) {
    const start = Math.floor(bin * step);
    const end = Math.min(
      buffer.length,
      Math.max(start + 1, Math.floor((bin + 1) * step)),
    );
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

function makeSaturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const length = 16_384;
  const curve = new Float32Array(
    new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT),
  );
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
  const offline = new OfflineAudioContext(
    channels,
    input.length,
    input.sampleRate,
  );
  const source = offline.createBufferSource();
  source.buffer = input;

  const highPass = offline.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = 27;
  highPass.Q.value = 0.707;

  const lowShelf = offline.createBiquadFilter();
  lowShelf.type = 'lowshelf';
  lowShelf.frequency.value = 95;
  lowShelf.gain.value = clamp(
    recipe.lowColorDb + modifiers.warmth * 1.25 + modifiers.lowEnd * 1.8,
    -2.2,
    3,
  );

  const mud = offline.createBiquadFilter();
  mud.type = 'peaking';
  mud.frequency.value = 310;
  mud.Q.value = 0.82;
  mud.gain.value = clamp(
    -modifiers.warmth * 0.3 - Math.max(0, modifiers.lowEnd) * 0.18,
    -1.1,
    0.5,
  );

  const presence = offline.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 2_300;
  presence.Q.value = 0.9;
  presence.gain.value = clamp(
    recipe.presenceDb + modifiers.brightness * 0.55 + modifiers.presence * 1.35,
    -1.2,
    2.2,
  );

  const air = offline.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 11_500;
  air.gain.value = clamp(
    recipe.airColorDb +
      modifiers.brightness * 1.25 +
      modifiers.air * 1.7 -
      modifiers.smoothness * 1.1,
    -2.4,
    2.8,
  );

  const deHarsh = offline.createBiquadFilter();
  deHarsh.type = 'peaking';
  deHarsh.frequency.value = 6_200;
  deHarsh.Q.value = 0.78;
  deHarsh.gain.value = clamp(-modifiers.smoothness * 1.7, -2.2, 0.5);

  const compressor = offline.createDynamicsCompressor();
  const compressionScale = clamp(
    1 +
      modifiers.intensity * 0.42 +
      modifiers.glue * 0.34 +
      modifiers.density * 0.25 -
      modifiers.dynamics * 0.58 -
      modifiers.punch * 0.24,
    0.38,
    1.5,
  );
  compressor.threshold.value =
    -18 - recipe.compression * 6 * compressionScale - modifiers.density * 1.8;
  compressor.knee.value = 6;
  compressor.ratio.value = 1 + recipe.compression * 2.1 * compressionScale;
  compressor.attack.value = clamp(
    0.018 + modifiers.punch * 0.018,
    0.008,
    0.055,
  );
  compressor.release.value = 0.15;

  const saturation = offline.createWaveShaper();
  saturation.curve = makeSaturationCurve(
    clamp(
      recipe.midDrive + modifiers.warmth * 0.1 + modifiers.density * 0.13,
      0.025,
      0.52,
    ),
  );
  saturation.oversample = '2x';

  source.connect(highPass);
  highPass.connect(lowShelf);
  lowShelf.connect(mud);
  mud.connect(presence);
  presence.connect(air);
  air.connect(deHarsh);
  deHarsh.connect(compressor);
  compressor.connect(saturation);
  saturation.connect(offline.destination);
  source.start();

  const filtered = await offline.startRendering();
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  return finalizeMaster(
    filtered,
    recipe.targetLufs,
    recipe.ceilingDbtp,
    recipe.width,
    modifiers,
  );
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
  const prepared = Array.from(
    { length: channels },
    () => new Float32Array(input.length),
  );

  if (channels === 2) {
    const left = input.getChannelData(0);
    const right = input.getChannelData(1);
    const outLeft = prepared[0];
    const outRight = prepared[1];
    const safeWidth = clamp(
      width + modifiers.width * 0.18 + modifiers.brightness * 0.02,
      0.82,
      1.26,
    );
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
    for (let index = 0; index < channel.length; index += 1)
      energy += channel[index] * channel[index];
  }
  const rms = Math.sqrt(energy / Math.max(1, input.length * channels));
  const target =
    targetLufs +
    modifiers.intensity * 2.2 +
    modifiers.density * 0.45 -
    modifiers.dynamics * 0.72;
  const makeupDb = clamp(target - gainToDb(rms), -5, 12);
  const makeup = dbToGain(makeupDb);
  const ceiling = dbToGain(ceilingDbtp);
  const lookahead = Math.max(1, Math.floor(input.sampleRate * 0.005));
  const releaseCoefficient = Math.exp(-1 / (input.sampleRate * 0.11));
  const peaks = new Float32Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    let peak = 0;
    for (const channel of prepared)
      peak = Math.max(peak, Math.abs(channel[index] * makeup));
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
  for (
    let index = 0;
    index <= Math.min(lookahead, input.length - 1);
    index += 1
  )
    enqueue(index);

  let limiterGain = 1;
  for (let index = 0; index < input.length; index += 1) {
    while (tail > head && deque[head] < index) head += 1;
    const futurePeak = tail > head ? peaks[deque[head]] : peaks[index];
    const desired = futurePeak > ceiling ? ceiling / futurePeak : 1;
    if (desired < limiterGain) limiterGain = desired;
    else
      limiterGain =
        releaseCoefficient * limiterGain + (1 - releaseCoefficient) * desired;

    for (let channel = 0; channel < channels; channel += 1) {
      output.getChannelData(channel)[index] = clamp(
        prepared[channel][index] * makeup * limiterGain,
        -ceiling,
        ceiling,
      );
    }
    const next = index + lookahead + 1;
    if (next < input.length) enqueue(next);
  }
  return output;
}

async function resample(
  buffer: AudioBuffer,
  sampleRate: number,
): Promise<AudioBuffer> {
  if (buffer.sampleRate === sampleRate) return buffer;
  const length = Math.max(1, Math.ceil(buffer.duration * sampleRate));
  const offline = new OfflineAudioContext(
    Math.min(2, buffer.numberOfChannels),
    length,
    sampleRate,
  );
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return offline.startRendering();
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1)
    view.setUint8(offset + index, value.charCodeAt(index));
}

export function parabolicFadeGain(
  normalizedDistance: number,
  curvature = 1 / 3,
): number {
  const x = clamp(normalizedDistance, 0, 1);
  const bend = clamp(Number.isFinite(curvature) ? curvature : 1 / 3, -1, 1);
  if (Math.abs(bend - 1 / 3) < 1e-9) return (x * (4 - x)) / 3;
  return clamp(x + bend * x * (1 - x), 0, 1);
}

export async function encodeMasterWav24(
  source: AudioBuffer,
  trim: TrimSettings,
  speedPercent = 100,
): Promise<Blob> {
  if (
    !Number.isFinite(speedPercent) ||
    speedPercent < 50 ||
    speedPercent > 150
  ) {
    throw new Error('WAV export supports speeds from 50% to 150%.');
  }
  const buffer = await resample(source, WAV_SAMPLE_RATE);
  const channels = Math.min(2, buffer.numberOfChannels);
  const startFrame = clamp(
    Math.floor(trim.startSeconds * WAV_SAMPLE_RATE),
    0,
    buffer.length - 1,
  );
  const endFrame = clamp(
    Math.ceil(trim.endSeconds * WAV_SAMPLE_RATE),
    startFrame + 1,
    buffer.length,
  );
  const speedRate = clamp(speedPercent / 100, 0.5, 1.5);
  const sourceFrames = endFrame - startFrame;
  const frames = Math.max(1, Math.ceil(sourceFrames / speedRate));
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

  const fadeInFrames = Math.min(
    Math.floor((trim.fadeInSeconds / speedRate) * WAV_SAMPLE_RATE),
    Math.floor(frames * 0.45),
  );
  const fadeOutFrames = Math.min(
    Math.floor((trim.fadeOutSeconds / speedRate) * WAV_SAMPLE_RATE),
    Math.floor(frames * 0.45),
  );
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
      fadeGain = parabolicFadeGain(
        frame / (fadeInFrames - 1),
        trim.fadeInCurve,
      );
    } else if (fadeOutFrames > 1 && frame >= frames - fadeOutFrames) {
      fadeGain = parabolicFadeGain(
        (frames - 1 - frame) / (fadeOutFrames - 1),
        trim.fadeOutCurve,
      );
    }

    for (let channel = 0; channel < channels; channel += 1) {
      const sourcePosition = clamp(
        startFrame + frame * speedRate,
        startFrame,
        endFrame - 1,
      );
      const lowerFrame = Math.floor(sourcePosition);
      const upperFrame = Math.min(endFrame - 1, lowerFrame + 1);
      const interpolation = sourcePosition - lowerFrame;
      const channelData = buffer.getChannelData(channel);
      const sample =
        channelData[lowerFrame] +
        (channelData[upperFrame] - channelData[lowerFrame]) * interpolation;
      const dither = (uniform() - uniform()) / 8_388_608;
      const value = clamp(sample * fadeGain + dither, -1, 0.99999988);
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
