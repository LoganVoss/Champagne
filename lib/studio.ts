export type StyleId =
  | 'full_power'
  | 'warm_presence'
  | 'modern_crisp'
  | 'dominant';

export type Creator = 'manual' | 'brief' | 'webmcp';

export type StudioPhase =
  | 'empty'
  | 'analyzing'
  | 'ready'
  | 'rendering'
  | 'preview_ready'
  | 'export_ready'
  | 'error';

export interface StyleRecipe {
  id: StyleId;
  name: string;
  subtitle: string;
  targetLufs: number;
  ceilingDbtp: number;
  lowColorDb: number;
  presenceDb: number;
  airColorDb: number;
  compression: number;
  upwardAmount: number;
  parallelMix: number;
  midDrive: number;
  width: number;
  summary: string;
}

export const STYLE_RECIPES: Record<StyleId, StyleRecipe> = {
  full_power: {
    id: 'full_power',
    name: 'Full Power',
    subtitle: 'Parallel punch · full · competitive',
    targetLufs: -10,
    ceilingDbtp: -1,
    lowColorDb: 0.5,
    presenceDb: 0.7,
    airColorDb: 0.25,
    compression: 0.78,
    upwardAmount: 0.22,
    parallelMix: 0.2,
    midDrive: 0.18,
    width: 1.1,
    summary: 'Forward and full, with parallel density around intact transients.',
  },
  warm_presence: {
    id: 'warm_presence',
    name: 'Warm Presence',
    subtitle: 'Upward lift · warm density',
    targetLufs: -11,
    ceilingDbtp: -1,
    lowColorDb: 0.9,
    presenceDb: 0.35,
    airColorDb: -0.15,
    compression: 0.62,
    upwardAmount: 0.3,
    parallelMix: 0.14,
    midDrive: 0.3,
    width: 1.05,
    summary: 'Richer center weight and low-level body without a cloudy top end.',
  },
  modern_crisp: {
    id: 'modern_crisp',
    name: 'Modern Crisp',
    subtitle: 'Open · clear · dynamic polish',
    targetLufs: -10.5,
    ceilingDbtp: -1,
    lowColorDb: 0.1,
    presenceDb: 0.9,
    airColorDb: 1.1,
    compression: 0.55,
    upwardAmount: 0.15,
    parallelMix: 0.12,
    midDrive: 0.1,
    width: 1.14,
    summary: 'A more open, articulate finish with restrained dynamic control.',
  },
  dominant: {
    id: 'dominant',
    name: 'Dominant',
    subtitle: 'Heavy glue · club loud',
    targetLufs: -8.8,
    ceilingDbtp: -0.8,
    lowColorDb: 0.7,
    presenceDb: 0.55,
    airColorDb: 0.15,
    compression: 1,
    upwardAmount: 0.24,
    parallelMix: 0.25,
    midDrive: 0.22,
    width: 1.12,
    summary: 'Maximum approved density and loudness with linked peak control.',
  },
};

export const STYLE_IDS = Object.keys(STYLE_RECIPES) as StyleId[];

export interface MasteringModifiers {
  intensity: number;
  warmth: number;
  brightness: number;
  punch: number;
  dynamics: number;
}

export const DEFAULT_MODIFIERS: MasteringModifiers = {
  intensity: 0,
  warmth: 0,
  brightness: 0,
  punch: 0,
  dynamics: 0,
};

export interface MasteringIntent {
  style: StyleId;
  priorities: string[];
  constraints: string[];
  modifiers: MasteringModifiers;
}

export interface AudioAnalysis {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  samplePeakDbfs: number;
  rmsDbfs: number;
  crestFactorDb: number;
  headroomDb: number;
  flags: string[];
}

export interface MasterRevision {
  id: string;
  label: string;
  parentId?: string;
  style: StyleId;
  creator: Creator;
  createdAt: number;
  prompt: string;
  intent: MasteringIntent;
  buffer: AudioBuffer;
  waveform: number[];
  analysis: AudioAnalysis;
  summary: string;
  planHash: string;
}

export interface TrimSettings {
  startSeconds: number;
  endSeconds: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export interface ActivityReceipt {
  id: string;
  creator: Creator;
  title: string;
  detail: string;
  time: number;
  revisionId?: string;
}

export interface InterpretedBrief {
  mode: 'create' | 'refine' | 'variations';
  style: StyleId;
  styles?: StyleId[];
  priorities: string[];
  constraints: string[];
  modifiers: MasteringModifiers;
  refinement?: {
    dimension: keyof MasteringModifiers;
    delta: number;
  };
}

export function interpretBrief(text: string, hasActiveTake: boolean): InterpretedBrief {
  const value = text.toLowerCase();
  const priorities: string[] = [];
  const constraints: string[] = [];
  const modifiers = { ...DEFAULT_MODIFIERS };

  let style: StyleId = 'full_power';
  if (/club|dominant|aggressive|huge|hard|loud/.test(value)) style = 'dominant';
  if (/warm|intimate|rounded|rich|soft/.test(value)) style = 'warm_presence';
  if (/crisp|open|airy|clear|bright|modern/.test(value)) style = 'modern_crisp';
  if (/full power|punch|competitive|impact/.test(value)) style = 'full_power';

  if (/loud|club|competitive|impact/.test(value)) priorities.push('loudness');
  if (/punch|kick|drum|transient/.test(value)) priorities.push('punch');
  if (/warm|rich|body|intimate/.test(value)) priorities.push('warmth');
  if (/clear|crisp|open|air|detail/.test(value)) priorities.push('clarity');
  if (/dynamic|breathe|restrain/.test(value)) priorities.push('dynamic range');

  if (/keep|preserve|intact|don.t flatten|without flatten/.test(value) && /kick|drum|punch|transient/.test(value)) {
    constraints.push('preserve transients');
    modifiers.punch = 0.35;
  }
  if (/not muddy|avoid mud|clean low|tight low/.test(value)) constraints.push('avoid mud');
  if (/not harsh|avoid harsh|smooth top|smooth high/.test(value)) constraints.push('avoid harshness');
  if (/dynamic|breathe|don.t crush|not crushed/.test(value)) {
    constraints.push('keep dynamic');
    modifiers.dynamics = 0.5;
    modifiers.intensity = -0.25;
  }
  if (/warmer|more warmth|richer/.test(value)) modifiers.warmth = 0.35;
  if (/less bright|darker|softer top/.test(value)) modifiers.brightness = -0.35;
  if (/brighter|more air|open the top/.test(value)) modifiers.brightness = 0.3;
  if (/back off|less intense|more restrained|ease up/.test(value)) modifiers.intensity = -0.3;
  if (/harder|more intense|push it|louder/.test(value)) modifiers.intensity = Math.max(modifiers.intensity, 0.25);

  const wantsVariations = /three|3 |versions|options|directions|alternatives/.test(value);
  if (wantsVariations) {
    return {
      mode: 'variations',
      style,
      styles: ['warm_presence', 'modern_crisp', 'dominant'],
      priorities: priorities.length ? priorities : ['contrast'],
      constraints,
      modifiers,
    };
  }

  const refinements: Array<[RegExp, keyof MasteringModifiers, number]> = [
    [/less bright|darker|softer top/, 'brightness', -0.28],
    [/brighter|more air|open the top/, 'brightness', 0.25],
    [/warmer|more warmth|richer/, 'warmth', 0.28],
    [/less warm|leaner/, 'warmth', -0.25],
    [/back off|less intense|restrained|ease up/, 'intensity', -0.25],
    [/louder|harder|more intense|push it/, 'intensity', 0.22],
    [/more punch|kick.*more|drums.*forward/, 'punch', 0.25],
    [/more dynamic|breathe|less compressed/, 'dynamics', 0.3],
  ];
  const refinement = hasActiveTake
    ? refinements.find(([pattern]) => pattern.test(value))
    : undefined;

  if (refinement) {
    return {
      mode: 'refine',
      style,
      priorities,
      constraints,
      modifiers,
      refinement: { dimension: refinement[1], delta: refinement[2] },
    };
  }

  return {
    mode: 'create',
    style,
    priorities: priorities.length ? priorities : ['balance', 'release readiness'],
    constraints,
    modifiers,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(1e-12, gain));
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00.0';
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

export function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function makePlanHash(
  style: StyleId,
  modifiers: MasteringModifiers,
  sourceKey: string,
): string {
  const value = `${sourceKey}|${style}|${Object.values(modifiers).map((v) => v.toFixed(3)).join('|')}|web-0.1`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `plan_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
