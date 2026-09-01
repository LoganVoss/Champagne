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
    summary:
      'Forward and full, with parallel density around intact transients.',
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
    summary:
      'Richer center weight and low-level body without a cloudy top end.',
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
  lowEnd: number;
  presence: number;
  air: number;
  width: number;
  glue: number;
  density: number;
  smoothness: number;
}

export const DEFAULT_MODIFIERS: MasteringModifiers = {
  intensity: 0,
  warmth: 0,
  brightness: 0,
  punch: 0,
  dynamics: 0,
  lowEnd: 0,
  presence: 0,
  air: 0,
  width: 0,
  glue: 0,
  density: 0,
  smoothness: 0,
};

export interface DirectionProfile {
  id: string;
  name: string;
  accent: string;
  description: string;
  baseStyle: StyleId;
  matches: RegExp;
  modifiers: Partial<MasteringModifiers>;
  priorities: string[];
  constraints?: string[];
}

export const DIRECTION_PROFILES: DirectionProfile[] = [
  {
    id: 'club_impact',
    name: 'Club Impact',
    accent: 'Impact',
    description: 'Club-level weight with the kick kept articulate.',
    baseStyle: 'dominant',
    matches: /club|dancefloor|nightclub|festival loud/i,
    modifiers: { intensity: 0.42, lowEnd: 0.28, punch: 0.36, glue: 0.22 },
    priorities: ['loudness', 'punch', 'low end'],
    constraints: ['preserve transients'],
  },
  {
    id: 'festival_wide',
    name: 'Festival Wide',
    accent: 'Wide',
    description: 'Large-scale width and high-energy impact.',
    baseStyle: 'dominant',
    matches: /festival|arena|stadium|massive|huge/i,
    modifiers: { intensity: 0.34, width: 0.38, lowEnd: 0.2, air: 0.12 },
    priorities: ['scale', 'width', 'loudness'],
  },
  {
    id: 'radio_ready',
    name: 'Radio Ready',
    accent: 'Radio',
    description: 'Consistent forward energy and clear mid presence.',
    baseStyle: 'full_power',
    matches: /radio|broadcast|airplay/i,
    modifiers: { intensity: 0.24, presence: 0.28, glue: 0.24, density: 0.12 },
    priorities: ['consistency', 'presence'],
  },
  {
    id: 'streaming_clean',
    name: 'Streaming Clean',
    accent: 'Clean',
    description: 'Controlled level with uncluttered spectral balance.',
    baseStyle: 'full_power',
    matches: /streaming|spotify|apple music|platform ready/i,
    modifiers: {
      intensity: -0.05,
      dynamics: 0.2,
      smoothness: 0.15,
      glue: 0.08,
    },
    priorities: ['balance', 'translation'],
  },
  {
    id: 'punch_first',
    name: 'Punch First',
    accent: 'Punch',
    description: 'Transient-forward drums with restrained density.',
    baseStyle: 'full_power',
    matches: /punch|punchy|kick intact|drums? hit|transient/i,
    modifiers: { punch: 0.48, dynamics: 0.2, glue: -0.12, density: -0.08 },
    priorities: ['punch', 'transients'],
    constraints: ['preserve transients'],
  },
  {
    id: 'tight_low',
    name: 'Tight Low End',
    accent: 'Tight',
    description: 'Taut bass movement without excess bloom.',
    baseStyle: 'full_power',
    matches:
      /tight bass|tight low|controlled bass|clean low|less boomy|less boom/i,
    modifiers: { lowEnd: -0.12, punch: 0.28, glue: 0.18, warmth: -0.08 },
    priorities: ['low-end control', 'punch'],
    constraints: ['avoid mud'],
  },
  {
    id: 'deep_low',
    name: 'Deep Low End',
    accent: 'Deep',
    description: 'Extended low weight with a composed center.',
    baseStyle: 'warm_presence',
    matches:
      /deep bass|more bass|sub heavy|sub-heavy|low end weight|bigger low/i,
    modifiers: { lowEnd: 0.48, warmth: 0.18, punch: 0.12 },
    priorities: ['depth', 'low end'],
  },
  {
    id: 'warm_analog',
    name: 'Warm Analog',
    accent: 'Analog',
    description: 'Harmonic warmth and softened digital edges.',
    baseStyle: 'warm_presence',
    matches: /analog|tape|warmth|warmer|warm\b/i,
    modifiers: { warmth: 0.48, density: 0.22, air: -0.14, smoothness: 0.25 },
    priorities: ['warmth', 'body'],
  },
  {
    id: 'vintage_soft',
    name: 'Vintage Soft',
    accent: 'Vintage',
    description: 'Rounded presence and gently softened air.',
    baseStyle: 'warm_presence',
    matches: /vintage|retro|old school|old-school|seventies|70s|eighties|80s/i,
    modifiers: {
      warmth: 0.36,
      brightness: -0.28,
      air: -0.22,
      smoothness: 0.38,
      width: -0.08,
    },
    priorities: ['character', 'softness'],
  },
  {
    id: 'intimate_center',
    name: 'Intimate Center',
    accent: 'Intimate',
    description: 'Close, centered weight with restrained width.',
    baseStyle: 'warm_presence',
    matches: /intimate|close|personal|up close|centered/i,
    modifiers: { warmth: 0.28, presence: 0.2, width: -0.34, dynamics: 0.14 },
    priorities: ['intimacy', 'center focus'],
  },
  {
    id: 'velvet_dark',
    name: 'Velvet Dark',
    accent: 'Dark',
    description: 'A darker, luxurious finish without lost definition.',
    baseStyle: 'warm_presence',
    matches: /dark|darker|velvet|moody|nocturnal/i,
    modifiers: { brightness: -0.45, air: -0.34, warmth: 0.32, smoothness: 0.3 },
    priorities: ['darkness', 'smoothness'],
  },
  {
    id: 'smooth_top',
    name: 'Smooth Top',
    accent: 'Smooth',
    description: 'De-emphasized edge and controlled high-frequency bite.',
    baseStyle: 'warm_presence',
    matches:
      /smooth top|smooth high|less harsh|not harsh|de-harsh|soft top|tame the top/i,
    modifiers: { smoothness: 0.55, brightness: -0.2, air: -0.18 },
    priorities: ['smoothness'],
    constraints: ['avoid harshness'],
  },
  {
    id: 'open_air',
    name: 'Open Air',
    accent: 'Air',
    description: 'Lifted air and space without a brittle presence peak.',
    baseStyle: 'modern_crisp',
    matches: /open|airy|more air|breath|spacious/i,
    modifiers: { air: 0.48, width: 0.2, dynamics: 0.16, brightness: 0.12 },
    priorities: ['air', 'openness'],
  },
  {
    id: 'modern_detail',
    name: 'Modern Detail',
    accent: 'Detail',
    description: 'Crisp definition and contemporary polish.',
    baseStyle: 'modern_crisp',
    matches: /modern|detail|detailed|definition|hi-fi|hifi/i,
    modifiers: { presence: 0.28, air: 0.24, brightness: 0.2, density: -0.08 },
    priorities: ['detail', 'clarity'],
  },
  {
    id: 'glossy_pop',
    name: 'Glossy Pop',
    accent: 'Gloss',
    description: 'Shining air, forward presence, and controlled density.',
    baseStyle: 'modern_crisp',
    matches: /glossy|pop polish|shiny|expensive|commercial/i,
    modifiers: { air: 0.32, presence: 0.25, glue: 0.18, intensity: 0.12 },
    priorities: ['polish', 'presence'],
  },
  {
    id: 'crystal_clear',
    name: 'Crystal Clear',
    accent: 'Clear',
    description: 'Maximum intelligibility with restrained coloration.',
    baseStyle: 'modern_crisp',
    matches: /crystal|clear|clean|clarity|transparent top/i,
    modifiers: { presence: 0.34, air: 0.22, warmth: -0.15, density: -0.18 },
    priorities: ['clarity', 'separation'],
  },
  {
    id: 'wide_screen',
    name: 'Wide Screen',
    accent: 'Wide',
    description: 'Expanded stereo scale with a stable center.',
    baseStyle: 'modern_crisp',
    matches: /wide|wider|stereo spread|stereo image|panoramic/i,
    modifiers: { width: 0.55, air: 0.14, dynamics: 0.12 },
    priorities: ['width', 'scale'],
  },
  {
    id: 'mono_focus',
    name: 'Mono Focus',
    accent: 'Focus',
    description: 'Narrower image and a firmer central anchor.',
    baseStyle: 'full_power',
    matches: /mono|narrow|center focus|centered image|tight stereo/i,
    modifiers: { width: -0.6, presence: 0.15, glue: 0.12 },
    priorities: ['center focus', 'translation'],
  },
  {
    id: 'dynamic_lift',
    name: 'Dynamic Lift',
    accent: 'Dynamic',
    description: 'Polish and lift while leaving the track breathing.',
    baseStyle: 'modern_crisp',
    matches:
      /dynamic|breathe|breathing|not crushed|less compressed|keep dynamics/i,
    modifiers: {
      dynamics: 0.62,
      punch: 0.24,
      intensity: -0.25,
      glue: -0.2,
      density: -0.2,
    },
    priorities: ['dynamic range', 'transients'],
    constraints: ['keep dynamic'],
  },
  {
    id: 'transparent_finish',
    name: 'Transparent Finish',
    accent: 'Transparent',
    description: 'Minimal coloration with corrective restraint.',
    baseStyle: 'modern_crisp',
    matches: /transparent|natural|invisible|subtle|do less|minimal processing/i,
    modifiers: {
      dynamics: 0.48,
      intensity: -0.32,
      warmth: -0.08,
      brightness: -0.08,
      density: -0.32,
      glue: -0.22,
    },
    priorities: ['transparency', 'balance'],
  },
  {
    id: 'dense_glue',
    name: 'Dense Glue',
    accent: 'Glue',
    description: 'A cohesive, filled-in body with steady energy.',
    baseStyle: 'full_power',
    matches: /dense|density|glue|cohesive|together|solid/i,
    modifiers: { glue: 0.52, density: 0.44, warmth: 0.14, dynamics: -0.2 },
    priorities: ['density', 'cohesion'],
  },
  {
    id: 'aggressive_edge',
    name: 'Aggressive Edge',
    accent: 'Edge',
    description: 'Harder front-edge energy with bounded peak control.',
    baseStyle: 'dominant',
    matches: /aggressive|harder|angry|ferocious|slam|smash/i,
    modifiers: {
      intensity: 0.52,
      punch: 0.28,
      presence: 0.25,
      density: 0.22,
      smoothness: -0.12,
    },
    priorities: ['impact', 'edge'],
  },
  {
    id: 'cinematic_scale',
    name: 'Cinematic Scale',
    accent: 'Cinematic',
    description: 'Broad depth, dynamic size, and spacious air.',
    baseStyle: 'modern_crisp',
    matches: /cinematic|film|soundtrack|epic|grand/i,
    modifiers: {
      width: 0.42,
      lowEnd: 0.24,
      air: 0.2,
      dynamics: 0.3,
      intensity: 0.08,
    },
    priorities: ['scale', 'depth', 'dynamics'],
  },
  {
    id: 'bass_control',
    name: 'Bass Control',
    accent: 'Control',
    description: 'Stronger low-end discipline and kick definition.',
    baseStyle: 'full_power',
    matches: /bass control|control the bass|boomy|muddy|mud|low end control/i,
    modifiers: { lowEnd: -0.08, punch: 0.3, glue: 0.2, smoothness: 0.1 },
    priorities: ['low-end control'],
    constraints: ['avoid mud'],
  },
  {
    id: 'gentle_polish',
    name: 'Gentle Polish',
    accent: 'Gentle',
    description: 'A refined finish with very light-touch mechanics.',
    baseStyle: 'warm_presence',
    matches:
      /gentle|delicate|light touch|light-touch|soft polish|just polish|polished|balanced|release[- ]?ready|final polish|finished/i,
    modifiers: {
      intensity: -0.28,
      dynamics: 0.42,
      glue: -0.12,
      density: -0.18,
      smoothness: 0.2,
    },
    priorities: ['polish', 'restraint'],
  },
];

export interface MasteringIntent {
  style: StyleId;
  customName: string;
  matchedDirections: string[];
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
  displayName: string;
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
  fadeInCurve: number;
  fadeOutCurve: number;
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
  customName: string;
  matchedDirections: string[];
  priorities: string[];
  constraints: string[];
  modifiers: MasteringModifiers;
  refinement?: {
    dimension: keyof MasteringModifiers;
    delta: number;
    label: string;
  };
}

export interface StudioPromptActions {
  shouldMaster: boolean;
  shouldDownload: boolean;
  masteringText: string;
  speedPercent?: number;
  edits: {
    cutStartSeconds?: number;
    cutEndSeconds?: number;
    fadeInSeconds?: number;
    fadeOutSeconds?: number;
  };
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'but',
  'can',
  'could',
  'cut',
  'do',
  'download',
  'fade',
  'for',
  'from',
  'give',
  'i',
  'feel',
  'feels',
  'it',
  'keep',
  'like',
  'make',
  'master',
  'mastered',
  'mastering',
  'me',
  'more',
  'my',
  'of',
  'please',
  'something',
  'sound',
  'speed',
  'second',
  'seconds',
  'the',
  'then',
  'this',
  'to',
  'track',
  'trim',
  'version',
  'with',
  'without',
]);

const RESERVED_PRESET_WORDS = new Set([
  'full',
  'power',
  'warm',
  'presence',
  'modern',
  'crisp',
  'dominant',
]);

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const DURATION_TOKEN =
  '(?:\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten)';

function durationValue(value: string): number {
  const normalized = value.toLowerCase();
  return NUMBER_WORDS[normalized] ?? Number(normalized);
}

export function sanitizePresetName(
  requested: string,
  fallbackSource = '',
): string {
  const usableWords = `${requested} ${fallbackSource}`
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => {
      const normalized = word.toLowerCase();
      return (
        word.length > 2 &&
        !STOP_WORDS.has(normalized) &&
        !RESERVED_PRESET_WORDS.has(normalized)
      );
    });
  const uniqueWords = [
    ...new Set(usableWords.map((word) => word.toLowerCase())),
  ]
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  if (!uniqueWords.length) return 'Custom Finish';
  if (uniqueWords.length === 1) return `${uniqueWords[0]} Finish`;
  return uniqueWords.join(' ').slice(0, 48);
}

export function interpretStudioPrompt(text: string): StudioPromptActions {
  const normalized = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(
      /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)-seconds?\b/g,
      '$1 seconds',
    )
    .replace(/\s+/g, ' ')
    .trim();
  let remainder = normalized;
  let recognizedOperation = false;
  const edits: StudioPromptActions['edits'] = {};
  const removeMatches = (
    pattern: RegExp,
    handler: (match: RegExpExecArray) => void,
  ) => {
    remainder = remainder.replace(pattern, (...args: unknown[]) => {
      const values = args.slice(0, -2) as string[];
      const match = Object.assign(values, {
        index: args.at(-2) as number,
        input: args.at(-1) as string,
      }) as unknown as RegExpExecArray;
      handler(match);
      recognizedOperation = true;
      return ' ';
    });
  };

  const shouldDownload = /\bdownload(?:ed|ing)?\b/.test(normalized);
  if (shouldDownload) {
    recognizedOperation = true;
    remainder = remainder.replace(
      /\bdownload(?:ed|ing)?\s+(?:(?:the|my|this)\s+)?(?:(?:current|existing|selected|active|final|finished)\s+)?(?:master(?:ed\s+track)?|track|song|audio|wav|file)\b/g,
      ' ',
    );
    remainder = remainder.replace(/\bdownload(?:ed|ing)?\b/g, ' ');
  }

  let speedPercent: number | undefined;
  removeMatches(
    /\b(?:(?:turn|switch)\s+(?:the\s+)?(?:track\s+)?speed\s+off|(?:reset|return|restore|set|change)\s+(?:the\s+)?(?:track|song|audio)?\s*(?:to\s+)?(?:its\s+)?(?:normal|original|regular)\s+speed)\b/g,
    () => {
      speedPercent = 100;
    },
  );
  removeMatches(
    /\b(?:set|change|adjust|put)\s+(?:the\s+)?(?:track|song|audio)?\s*speed\s+(?:to|at)\s*(\d+(?:\.\d+)?)\s*%(?!\d)/g,
    (match) => {
      speedPercent = clamp(Number(match[1]), 50, 150);
    },
  );
  removeMatches(
    /\b(?:play|run)\s+(?:the\s+)?(?:track|song|audio|it)?\s*(?:back\s+)?at\s+(\d+(?:\.\d+)?)\s*%(?:\s*speed\b)?/g,
    (match) => {
      speedPercent = clamp(Number(match[1]), 50, 150);
    },
  );
  removeMatches(
    /\b(?:make|set|change|play)?\s*(?:the\s+)?(?:track|song|audio)?\s*(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:the\s+)?(?:current|original|normal)?\s*speed\b/g,
    (match) => {
      speedPercent = clamp(Number(match[1]), 50, 150);
    },
  );
  removeMatches(
    /\b(?:speed\s+(?:the\s+)?(?:track|song|audio|it)?\s*up|increase\s+(?:the\s+)?(?:track|song|audio)?\s*speed)\s+by\s+(\d+(?:\.\d+)?)\s*%(?!\d)/g,
    (match) => {
      speedPercent = clamp(100 + Number(match[1]), 50, 150);
    },
  );
  removeMatches(
    /\b(?:make|set|change|play)?\s*(?:the\s+)?(?:track|song|audio)?\s*(\d+(?:\.\d+)?)\s*%\s*faster\b/g,
    (match) => {
      speedPercent = clamp(100 + Number(match[1]), 50, 150);
    },
  );
  removeMatches(
    /\b(?:slow\s+(?:the\s+)?(?:track|song|audio|it)?\s*down|decrease\s+(?:the\s+)?(?:track|song|audio)?\s*speed)\s+by\s+(\d+(?:\.\d+)?)\s*%(?!\d)/g,
    (match) => {
      speedPercent = clamp(100 - Number(match[1]), 50, 150);
    },
  );
  removeMatches(
    /\bslow\s+(?:the\s+)?(?:track|song|audio|it)\s+by\s+(\d+(?:\.\d+)?)\s*%(?!\d)/g,
    (match) => {
      speedPercent = clamp(100 - Number(match[1]), 50, 150);
    },
  );
  removeMatches(
    /\b(?:make|set|change|play)?\s*(?:the\s+)?(?:track|song|audio)?\s*(\d+(?:\.\d+)?)\s*%\s*slower\b/g,
    (match) => {
      speedPercent = clamp(100 - Number(match[1]), 50, 150);
    },
  );
  removeMatches(
    /\b(?:make|set|change|play|run)?\s*(?:the\s+)?(?:track|song|audio|it)?\s*(?:at\s+)?(\d+(?:\.\d+)?)\s*x(?:\s+speed)?\b/g,
    (match) => {
      speedPercent = clamp(Number(match[1]) * 100, 50, 150);
    },
  );

  removeMatches(
    new RegExp(
      `\\b(?:cut|trim|remove)\\s+(?:the\\s+)?(?:first|front|start)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?\\s+(?:and|&)\\s+(?:(?:cut|trim|remove)\\s+)?(?:the\\s+)?(?:last|back|end)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?`,
      'g',
    ),
    (match) => {
      edits.cutStartSeconds = durationValue(match[1]);
      edits.cutEndSeconds = durationValue(match[2]);
    },
  );
  removeMatches(
    /\b(?:cut|trim|remove)\s+(?:the\s+)?first\s+second\s+(?:and|&)\s+(?:(?:cut|trim|remove)\s+)?(?:the\s+)?(?:last|final)\s+second\b/g,
    () => {
      edits.cutStartSeconds = 1;
      edits.cutEndSeconds = 1;
    },
  );
  removeMatches(
    new RegExp(
      `\\b(?:cut|trim|remove)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?\\s+(?:from|off)\\s+(?:each|both)\\s+(?:end|ends|side|sides)\\b`,
      'g',
    ),
    (match) => {
      const seconds = durationValue(match[1]);
      edits.cutStartSeconds = seconds;
      edits.cutEndSeconds = seconds;
    },
  );
  removeMatches(
    new RegExp(
      `\\b(?:cut|trim|remove)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?\\s+(?:from|off)\\s+(?:the\\s+)?(?:front|start)\\s+(?:and|&)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?\\s+(?:from|off)\\s+(?:the\\s+)?(?:back|end)\\b`,
      'g',
    ),
    (match) => {
      edits.cutStartSeconds = durationValue(match[1]);
      edits.cutEndSeconds = durationValue(match[2]);
    },
  );
  removeMatches(
    new RegExp(
      `\\b(?:cut|trim|remove)\\s+(?:the\\s+)?(?:first|front|start)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?\\s+(?:on|from|off)\\s+(?:the\\s+)?front\\s+(?:and|&)\\s+(?:the\\s+)?back\\b`,
      'g',
    ),
    (match) => {
      const seconds = durationValue(match[1]);
      edits.cutStartSeconds = seconds;
      edits.cutEndSeconds = seconds;
    },
  );
  removeMatches(
    new RegExp(
      `\\bfade(?:\\s+it)?\\s+in\\s+(?:for|over)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?\\s+(?:and|&)\\s+(?:fade\\s+)?(?:it\\s+)?out\\s+(?:for|over)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?`,
      'g',
    ),
    (match) => {
      edits.fadeInSeconds = durationValue(match[1]);
      edits.fadeOutSeconds = durationValue(match[2]);
    },
  );
  removeMatches(
    new RegExp(
      `\\bfade\\s+(?:the\\s+)?(?:start|front)\\s+(?:and|&)\\s+(?:the\\s+)?(?:finish|end|back)(?:\\s+(?:for|over))?[\\s(:-]*(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?\\s*(?:\\))?\\s*(?:(?:on|at|for)\\s+)?(?:each|both)\\s+(?:side|sides|end|ends)\\b`,
      'g',
    ),
    (match) => {
      const seconds = durationValue(match[1]);
      edits.fadeInSeconds = seconds;
      edits.fadeOutSeconds = seconds;
    },
  );
  removeMatches(
    new RegExp(
      `\\b(?:a\\s+)?(?:long\\s+)?(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)\\s+fade\\s+(?:at|on|for)\\s+(?:each|both)\\s+(?:end|ends|side|sides)\\b`,
      'g',
    ),
    (match) => {
      const seconds = durationValue(match[1]);
      edits.fadeInSeconds = seconds;
      edits.fadeOutSeconds = seconds;
    },
  );
  removeMatches(
    new RegExp(
      `\\b(?:a\\s+)?(?:long\\s+)?fade(?:\\s+it)?\\s+in\\s+(?:and|&)\\s+(?:fade\\s+)?(?:it\\s+)?out[\\s(:-]*(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?\\s*(?:\\))?\\s*(?:(?:on|at|for)\\s+)?(?:each|both)\\s+(?:end|ends|side|sides)\\b`,
      'g',
    ),
    (match) => {
      const seconds = durationValue(match[1]);
      edits.fadeInSeconds = seconds;
      edits.fadeOutSeconds = seconds;
    },
  );
  removeMatches(
    new RegExp(
      `\\bfade\\s+(?:the\\s+)?(?:each|both)\\s+(?:end|ends|side|sides)\\s+(?:for|over)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?`,
      'g',
    ),
    (match) => {
      const seconds = durationValue(match[1]);
      edits.fadeInSeconds = seconds;
      edits.fadeOutSeconds = seconds;
    },
  );
  removeMatches(
    new RegExp(
      `\\bfade\\s+(?:the\\s+)?(?:first|front|start)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?\\s+(?:and|&)\\s+(?:the\\s+)?(?:last|back|end)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?`,
      'g',
    ),
    (match) => {
      edits.fadeInSeconds = durationValue(match[1]);
      edits.fadeOutSeconds = durationValue(match[2]);
    },
  );
  removeMatches(
    new RegExp(
      `\\bfade\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?\\s+(?:at|on)\\s+(?:each|both)\\s+(?:end|ends|side|sides)\\b`,
      'g',
    ),
    (match) => {
      const seconds = durationValue(match[1]);
      edits.fadeInSeconds = seconds;
      edits.fadeOutSeconds = seconds;
    },
  );
  removeMatches(
    /\bfade\s+(?:the\s+)?first\s+(?:and|&)\s+(?:the\s+)?last\s+second\b/g,
    () => {
      edits.fadeInSeconds = 1;
      edits.fadeOutSeconds = 1;
    },
  );
  removeMatches(
    new RegExp(
      `\\bfade\\s+(?:the\\s+)?first\\s+(?:and|&)\\s+(?:the\\s+)?last\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)\\b`,
      'g',
    ),
    (match) => {
      const seconds = durationValue(match[1]);
      edits.fadeInSeconds = seconds;
      edits.fadeOutSeconds = seconds;
    },
  );
  removeMatches(
    /\bfade(?:\s+it)?\s+in\s+(?:and|&)\s+(?:fade\s+)?(?:it\s+)?out\b/g,
    () => {
      edits.fadeInSeconds = 1;
      edits.fadeOutSeconds = 1;
    },
  );
  removeMatches(
    /\bfade\s+(?:the\s+)?(?:start|front)\s+(?:and|&)\s+(?:the\s+)?(?:finish|end|back)\b/g,
    () => {
      edits.fadeInSeconds = 1;
      edits.fadeOutSeconds = 1;
    },
  );
  removeMatches(
    new RegExp(
      `\\b(?:cut|trim|remove)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)\\s+(?:from|off)\\s+(?:the\\s+)?front\\s+(?:and|&)\\s+(?:the\\s+)?back\\b`,
      'g',
    ),
    (match) => {
      const seconds = durationValue(match[1]);
      edits.cutStartSeconds = seconds;
      edits.cutEndSeconds = seconds;
    },
  );
  removeMatches(
    /\b(?:cut|trim|remove)\s+(?:the\s+)?first\s+second\s+(?:on|from|off)\s+(?:the\s+)?front\s+(?:and|&)\s+(?:the\s+)?back\b/g,
    () => {
      edits.cutStartSeconds = 1;
      edits.cutEndSeconds = 1;
    },
  );
  removeMatches(/\b(?:cut|trim|remove)\s+(?:the\s+)?first\s+second\b/g, () => {
    edits.cutStartSeconds = 1;
  });
  removeMatches(
    /\b(?:cut|trim|remove)\s+(?:the\s+)?(?:last|final)\s+second\b/g,
    () => {
      edits.cutEndSeconds = 1;
    },
  );
  removeMatches(
    new RegExp(
      `\\b(?:cut|trim|remove)\\s+(?:the\\s+)?(?:first|front|start)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?(?:\\s+(?:from|off|on)\\s+(?:the\\s+)?(?:front|start))?`,
      'g',
    ),
    (match) => {
      edits.cutStartSeconds = durationValue(match[1]);
    },
  );
  removeMatches(
    new RegExp(
      `\\b(?:cut|trim|remove)\\s+(?:the\\s+)?(?:last|final|back|end)\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?(?:\\s+(?:from|off|on)\\s+(?:the\\s+)?(?:back|end))?`,
      'g',
    ),
    (match) => {
      edits.cutEndSeconds = durationValue(match[1]);
    },
  );

  removeMatches(
    new RegExp(
      `\\bfade(?:\\s+in)?\\s+(?:the\\s+)?(?:front|start)(?:\\s+(?:first|for))?\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?\\s+(?:and|&)\\s+(?:fade\\s+)?(?:the\\s+)?(?:back|end)(?:\\s+(?:last|for))?\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?`,
      'g',
    ),
    (match) => {
      edits.fadeInSeconds = durationValue(match[1]);
      edits.fadeOutSeconds = durationValue(match[2]);
    },
  );
  removeMatches(
    /\bfade(?:\s+in)?\s+(?:the\s+)?(?:front|start)\s+first\s+second\s+(?:and|&)\s+(?:fade\s+)?(?:the\s+)?(?:back|end)\s+last\s+second\b/g,
    () => {
      edits.fadeInSeconds = 1;
      edits.fadeOutSeconds = 1;
    },
  );
  removeMatches(
    /\bfade(?:\s+in)?\s+(?:the\s+)?(?:first|front|start)\s+second\b/g,
    () => {
      edits.fadeInSeconds = 1;
    },
  );
  removeMatches(
    /\bfade(?:\s+out)?\s+(?:the\s+)?(?:last|back|end)\s+second\b/g,
    () => {
      edits.fadeOutSeconds = 1;
    },
  );
  removeMatches(
    new RegExp(
      `\\bfade(?:\\s+in)?\\s+(?:the\\s+)?(?:front|start)(?:\\s+(?:first|for))?\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?`,
      'g',
    ),
    (match) => {
      edits.fadeInSeconds = durationValue(match[1]);
    },
  );
  removeMatches(
    new RegExp(
      `\\bfade\\s+in(?:\\s+(?:the\\s+)?(?:first|front|start))?\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?`,
      'g',
    ),
    (match) => {
      edits.fadeInSeconds = durationValue(match[1]);
    },
  );
  removeMatches(
    new RegExp(
      `\\bfade(?:\\s+out)?\\s+(?:the\\s+)?(?:back|end)(?:\\s+(?:last|for))?\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?`,
      'g',
    ),
    (match) => {
      edits.fadeOutSeconds = durationValue(match[1]);
    },
  );
  removeMatches(
    new RegExp(
      `\\bfade\\s+out(?:\\s+(?:the\\s+)?(?:last|final|back|end))?\\s+(${DURATION_TOKEN})\\s*(?:seconds?|secs?|s)?`,
      'g',
    ),
    (match) => {
      edits.fadeOutSeconds = durationValue(match[1]);
    },
  );

  remainder = remainder
    .replace(
      /\b(?:keep|preserve|use)\s+(?:(?:the|this|my)\s+)?(?:(?:current|existing|selected|active)\s+)?master(?:ed\s+track)?\b/g,
      ' ',
    )
    .replace(/\b(?:do\s+not|don't|dont|without)\s+remaster(?:ing)?\b/g, ' ');
  const masteringSignal =
    /\b(?:master|mastering|remaster|style|preset|loud|louder|power|powerful|impactful|strong|warm|warmer|bright|brighter|dark|darker|punch|punchy|dynamic|dynamics|wide|wider|narrow|smooth|harsh|crisp|clear|airy|air|bass|low end|presence|glue|dense|density|analog|vintage|modern|club|festival|radio|streaming|cinematic|aggressive|gentle|polish|transparent|intimate|vocal|drums?|kick|energy|texture|feel|sound)\b/.test(
      remainder,
    );
  const hasOperationalAction =
    recognizedOperation ||
    Object.values(edits).some((value) => value != null) ||
    speedPercent != null;
  const masteringText = remainder
    .replace(/[()]/g, ' ')
    .replace(
      /\b(?:and|then|also|with)\b(?=\s*(?:(?:[,.;:&+-]\s*)|(?:\b(?:and|then|also|with)\b\s*))*$)/g,
      ' ',
    )
    .replace(/(?:\s*[,;:&+-]\s*){2,}/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:&+-]+|[\s,.;:&+-]+$/g, '')
    .trim();

  return {
    shouldMaster: hasOperationalAction
      ? masteringSignal
      : normalized.length > 0,
    shouldDownload,
    masteringText,
    speedPercent,
    edits,
  };
}

function mergeModifiers(
  ...parts: Array<Partial<MasteringModifiers>>
): MasteringModifiers {
  const result = { ...DEFAULT_MODIFIERS };
  for (const part of parts) {
    for (const key of Object.keys(result) as Array<keyof MasteringModifiers>) {
      result[key] = clamp(result[key] + (part[key] ?? 0), -1, 1);
    }
  }
  return result;
}

function customNameFromPrompt(
  text: string,
  matches: DirectionProfile[],
): string {
  if (matches.length >= 2)
    return sanitizePresetName(`${matches[0].name} ${matches[1].accent}`, text);
  if (matches.length === 1) return sanitizePresetName(matches[0].name, text);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return sanitizePresetName(words.join(' '), text);
}

export function interpretBrief(
  text: string,
  hasActiveStyle: boolean,
): InterpretedBrief {
  const value = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const isNegatedAt = (index: number) => {
    const clause =
      value
        .slice(Math.max(0, index - 42), index)
        .split(/[,.!?;]|\bbut\b|\bexcept\b/i)
        .at(-1) ?? '';
    return /\b(?:no|not|never|without|avoid|don't|do not|less)\b(?:\s+\w+){0,3}\s*$/.test(
      clause,
    );
  };
  const positiveMatch = (pattern: RegExp) => {
    const match = value.match(pattern);
    return Boolean(match && match.index != null && !isNegatedAt(match.index));
  };
  const matchedHits = DIRECTION_PROFILES.map((profile, tableIndex) => {
    const match = value.match(profile.matches);
    if (!match || match.index == null || isNegatedAt(match.index)) return null;
    const score = match[0].trim().split(/\s+/).length * 10 + match[0].length;
    return { profile, tableIndex, index: match.index, score };
  })
    .filter((hit): hit is NonNullable<typeof hit> => Boolean(hit))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.index - right.index ||
        left.tableIndex - right.tableIndex,
    )
    .slice(0, 3);
  const matched = matchedHits.map((hit) => hit.profile);
  const weightedProfileModifiers = matched.map(
    (profile, index) =>
      Object.fromEntries(
        (
          Object.entries(profile.modifiers) as Array<
            [keyof MasteringModifiers, number]
          >
        ).map(([key, amount]) => [
          key,
          amount * (index === 0 ? 1 : index === 1 ? 0.5 : 0.28),
        ]),
      ) as Partial<MasteringModifiers>,
  );
  const priorities = [
    ...new Set(matched.flatMap((profile) => profile.priorities)),
  ];
  const constraints = [
    ...new Set(matched.flatMap((profile) => profile.constraints ?? [])),
  ];
  const phraseModifiers: Partial<MasteringModifiers> = {};
  const inferredDirections: string[] = [];

  const addInference = (
    name: string,
    changes: Partial<MasteringModifiers>,
    inferredPriorities: string[] = [],
  ) => {
    inferredDirections.push(name);
    priorities.push(...inferredPriorities);
    for (const [key, amount] of Object.entries(changes) as Array<
      [keyof MasteringModifiers, number]
    >) {
      phraseModifiers[key] = clamp((phraseModifiers[key] ?? 0) + amount, -1, 1);
    }
  };

  if (/less bright|darker|softer top/.test(value))
    phraseModifiers.brightness = -0.35;
  if (/brighter|more air|open the top/.test(value))
    phraseModifiers.brightness = 0.3;
  if (/warmer|more warmth|richer/.test(value)) phraseModifiers.warmth = 0.35;
  if (/back off|less intense|more restrained|ease up/.test(value))
    phraseModifiers.intensity = -0.3;
  if (/harder|more intense|push it|louder/.test(value))
    phraseModifiers.intensity = 0.28;
  if (/more punch|kick.*more|drums.*forward/.test(value))
    phraseModifiers.punch = 0.35;
  if (/wider|more width/.test(value)) phraseModifiers.width = 0.35;
  if (/narrower|less wide/.test(value)) phraseModifiers.width = -0.35;
  if (/more presence|forward mids?/.test(value)) phraseModifiers.presence = 0.3;
  if (/less presence|pull.*mid/.test(value)) phraseModifiers.presence = -0.25;
  if (/more glue|more cohesive/.test(value)) phraseModifiers.glue = 0.3;
  if (/less dense|more open dynamics/.test(value))
    phraseModifiers.density = -0.3;
  if (/smoother|less harsh/.test(value)) phraseModifiers.smoothness = 0.35;

  if (
    positiveMatch(
      /\b(?:dreamy|ethereal|floating|weightless|atmospheric|otherworldly)\b/,
    )
  ) {
    addInference(
      'Dreamy Space',
      {
        intensity: -0.12,
        air: 0.3,
        width: 0.3,
        dynamics: 0.24,
        smoothness: 0.18,
      },
      ['space', 'atmosphere'],
    );
  }
  if (
    positiveMatch(
      /\b(?:alive|lively|more life|vibrant|electric|exciting|energetic)\b/,
    )
  ) {
    addInference(
      'Live Energy',
      { intensity: 0.16, punch: 0.26, presence: 0.16, dynamics: 0.22 },
      ['energy', 'movement'],
    );
  }
  if (
    positiveMatch(/\b(?:happy|sunny|uplifting|joyful|bright mood|feel good)\b/)
  ) {
    addInference(
      'Golden Lift',
      { brightness: 0.2, air: 0.2, punch: 0.12, width: 0.1 },
      ['lift', 'clarity'],
    );
  }
  if (
    positiveMatch(/\b(?:sad|melancholy|lonely|rainy|rain|heartbreak|somber)\b/)
  ) {
    addInference(
      'Rainy Depth',
      { warmth: 0.18, brightness: -0.2, smoothness: 0.2, dynamics: 0.18 },
      ['depth', 'emotion'],
    );
  }
  if (positiveMatch(/\b(?:cold|icy|metallic|chrome|frozen)\b/)) {
    addInference(
      'Icy Detail',
      { warmth: -0.3, brightness: 0.28, presence: 0.2, air: 0.18 },
      ['detail', 'edge'],
    );
  }
  if (positiveMatch(/\b(?:raw|gritty|dirty|grimy|crunchy|rough)\b/)) {
    addInference(
      'Raw Texture',
      { intensity: 0.18, density: 0.28, presence: 0.18, smoothness: -0.2 },
      ['texture', 'energy'],
    );
  }
  if (
    positiveMatch(/\b(?:soft|softer|gentle|delicate|tender|calm|relaxed)\b/)
  ) {
    addInference(
      'Soft Focus',
      { intensity: -0.24, dynamics: 0.3, smoothness: 0.28, warmth: 0.14 },
      ['softness', 'restraint'],
    );
  }
  if (positiveMatch(/\b(?:vocal|voice|lyrics|singer|front and center)\b/)) {
    addInference(
      'Center Presence',
      { presence: 0.2, width: -0.08, smoothness: 0.08 },
      ['presence', 'center focus'],
    );
  }
  if (positiveMatch(/\b(?:drums?|kick|snare|percussion|slap|hit)\b/)) {
    addInference(
      'Rhythmic Impact',
      { punch: 0.3, glue: -0.08, dynamics: 0.14 },
      ['punch', 'transients'],
    );
  }
  if (positiveMatch(/\b(?:lo[- ]?fi|dusty|cassette|worn|washed out)\b/)) {
    addInference(
      'Lo-Fi Patina',
      {
        warmth: 0.3,
        brightness: -0.32,
        air: -0.25,
        width: -0.12,
        density: 0.18,
      },
      ['character', 'warmth'],
    );
  }

  if (
    /keep|preserve|intact|don.t flatten|without flatten/.test(value) &&
    /kick|drum|punch|transient/.test(value)
  ) {
    constraints.push('preserve transients');
    phraseModifiers.punch = Math.max(0.4, phraseModifiers.punch ?? 0);
  }
  if (/not muddy|avoid mud|clean low|tight low/.test(value))
    constraints.push('avoid mud');
  if (/not harsh|avoid harsh|smooth top|smooth high/.test(value))
    constraints.push('avoid harshness');
  if (/dynamic|breathe|don.t crush|not crushed/.test(value))
    constraints.push('keep dynamic');

  if (
    /\b(?:not|never|avoid|without)\b.{0,28}\b(?:harsh|brittle|shrill|harshness)\b/.test(
      value,
    )
  ) {
    phraseModifiers.smoothness = Math.max(
      0.42,
      phraseModifiers.smoothness ?? 0,
    );
    phraseModifiers.brightness = Math.min(
      -0.12,
      phraseModifiers.brightness ?? 0,
    );
    phraseModifiers.air = Math.min(-0.08, phraseModifiers.air ?? 0);
    constraints.push('avoid harshness');
  }
  if (
    /\b(?:not|never|avoid|without)\b.{0,28}\b(?:muddy|boomy|mud|boom)\b/.test(
      value,
    )
  ) {
    phraseModifiers.lowEnd = Math.min(-0.22, phraseModifiers.lowEnd ?? 0);
    phraseModifiers.warmth = Math.min(-0.08, phraseModifiers.warmth ?? 0);
    phraseModifiers.punch = Math.max(0.12, phraseModifiers.punch ?? 0);
    constraints.push('avoid mud');
  }
  if (
    /\b(?:not|never|don't|do not)\b.{0,18}\b(?:crushed|flat)|without flattening\b/.test(
      value,
    )
  ) {
    phraseModifiers.dynamics = Math.max(0.44, phraseModifiers.dynamics ?? 0);
    phraseModifiers.density = Math.min(-0.2, phraseModifiers.density ?? 0);
    phraseModifiers.punch = Math.max(0.16, phraseModifiers.punch ?? 0);
    constraints.push('keep dynamic');
  }
  if (
    /\b(?:not|never|don't|do not)\b.{0,18}\b(?:loud|louder|intense|hard)\b/.test(
      value,
    )
  ) {
    phraseModifiers.intensity = Math.min(-0.34, phraseModifiers.intensity ?? 0);
    phraseModifiers.dynamics = Math.max(0.18, phraseModifiers.dynamics ?? 0);
  }
  if (
    /\b(?:not|never|avoid|without|less)\s+(?:too\s+)?(?:warm|rich|thick)\b/.test(
      value,
    )
  ) {
    phraseModifiers.warmth = Math.min(-0.3, phraseModifiers.warmth ?? 0);
  }
  if (
    /\b(?:not|never|avoid|without|less)\s+(?:too\s+)?(?:bright|airy|crisp)\b/.test(
      value,
    )
  ) {
    phraseModifiers.brightness = Math.min(
      -0.28,
      phraseModifiers.brightness ?? 0,
    );
    phraseModifiers.air = Math.min(-0.16, phraseModifiers.air ?? 0);
  }
  if (/\b(?:no|not|without|less)\s+(?:too\s+)?(?:wide|width)\b/.test(value)) {
    phraseModifiers.width = Math.min(-0.3, phraseModifiers.width ?? 0);
  }
  if (/\b(?:no|not|without|less)\s+(?:too\s+)?(?:punch|impact)\b/.test(value)) {
    phraseModifiers.punch = Math.min(-0.24, phraseModifiers.punch ?? 0);
  }

  const explicitStyle = STYLE_IDS.find((styleId) =>
    value.includes(STYLE_RECIPES[styleId].name.toLowerCase()),
  );
  let modifiers = mergeModifiers(...weightedProfileModifiers, phraseModifiers);
  const extractedSignal =
    matched.length > 0 ||
    inferredDirections.length > 0 ||
    Object.values(phraseModifiers).some(
      (amount) => Math.abs(amount ?? 0) > 0.001,
    ) ||
    Boolean(explicitStyle);
  const matchedDirections = [
    ...new Set([
      ...matched.map((profile) => profile.name),
      ...inferredDirections,
      ...(explicitStyle && matched.length === 0
        ? [STYLE_RECIPES[explicitStyle].name]
        : []),
    ]),
  ];
  if (!extractedSignal) {
    modifiers = mergeModifiers(modifiers, {
      intensity: 0.06,
      punch: 0.12,
      dynamics: 0.18,
      glue: 0.1,
      smoothness: 0.08,
    });
    matchedDirections.push('Adaptive Finish');
    priorities.push('balance', 'translation');
  }
  const style =
    explicitStyle ??
    matched[0]?.baseStyle ??
    (modifiers.intensity > 0.24
      ? 'dominant'
      : modifiers.warmth + modifiers.smoothness > 0.32
        ? 'warm_presence'
        : modifiers.brightness +
              modifiers.air +
              modifiers.width +
              modifiers.dynamics >
            0.42
          ? 'modern_crisp'
          : 'full_power');
  const customName =
    explicitStyle && matched.length === 0
      ? sanitizePresetName('', text)
      : matched.length > 0
        ? customNameFromPrompt(text, matched)
        : inferredDirections.length >= 2
          ? `${inferredDirections[0]} + ${inferredDirections[1].split(' ').at(-1)}`
          : inferredDirections.length === 1
            ? sanitizePresetName(inferredDirections[0], text)
            : extractedSignal
              ? sanitizePresetName('Controlled Finish', text)
              : customNameFromPrompt(text, matched);
  const resolvedPriorities = [...new Set(priorities)];

  const wantsVariations =
    /three|3 |versions|options|directions|alternatives/.test(value);
  if (wantsVariations) {
    return {
      mode: 'variations',
      style,
      styles: ['warm_presence', 'modern_crisp', 'dominant'],
      customName: 'Three Directions',
      matchedDirections,
      priorities: resolvedPriorities.length ? resolvedPriorities : ['contrast'],
      constraints: [...new Set(constraints)],
      modifiers,
    };
  }

  const refinements: Array<[RegExp, keyof MasteringModifiers, number, string]> =
    [
      [/less bright|darker|softer top/, 'brightness', -0.28, 'Less Bright'],
      [/brighter|more air|open the top/, 'brightness', 0.25, 'More Air'],
      [/warmer|more warmth|richer/, 'warmth', 0.28, 'Warmer'],
      [/less warm|leaner/, 'warmth', -0.25, 'Leaner'],
      [
        /back off|less intense|restrained|ease up/,
        'intensity',
        -0.25,
        'Less Intense',
      ],
      [/louder|harder|more intense|push it/, 'intensity', 0.22, 'More Intense'],
      [/more punch|kick.*more|drums.*forward/, 'punch', 0.25, 'More Punch'],
      [/more dynamic|breathe|less compressed/, 'dynamics', 0.3, 'More Dynamic'],
      [/wider|more width/, 'width', 0.25, 'Wider'],
      [/narrower|less wide/, 'width', -0.25, 'Narrower'],
      [/smoother|less harsh/, 'smoothness', 0.28, 'Smoother'],
      [/more bass|deeper low/, 'lowEnd', 0.25, 'Deeper Low End'],
    ];
  const refinement = hasActiveStyle
    ? refinements.find(([pattern]) => pattern.test(value))
    : undefined;

  if (refinement) {
    return {
      mode: 'refine',
      style,
      customName,
      matchedDirections,
      priorities: resolvedPriorities,
      constraints: [...new Set(constraints)],
      modifiers,
      refinement: {
        dimension: refinement[1],
        delta: refinement[2],
        label: refinement[3],
      },
    };
  }

  return {
    mode: 'create',
    style,
    customName,
    matchedDirections,
    priorities: resolvedPriorities.length
      ? resolvedPriorities
      : ['balance', 'release readiness'],
    constraints: [...new Set(constraints)],
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
  const value = `${sourceKey}|${style}|${Object.values(modifiers)
    .map((item) => item.toFixed(3))
    .join('|')}|web-0.2`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `plan_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
