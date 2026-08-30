import type { MutableRefObject } from 'react';

import type { MasteringModifiers, StyleId } from '@/lib/studio';

interface ToolExecutionContext {
  signal?: AbortSignal;
}

interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (input: unknown, context?: ToolExecutionContext) => Promise<unknown> | unknown;
}

interface ModelContext {
  registerTool: (tool: ModelContextTool) => Promise<void> | void;
  unregisterTool?: (name: string) => Promise<void> | void;
}

type WebMCPDocument = Document & { modelContext?: ModelContext };

export interface StudioCommandApi {
  getState: () => Promise<unknown> | unknown;
  analyzeTrack: (signal?: AbortSignal) => Promise<unknown>;
  createTake: (input: {
    expectedStateVersion: number;
    baseStyle: StyleId;
    priorities: string[];
    constraints: string[];
    intensity?: number;
    creator: 'webmcp';
    prompt: string;
    signal?: AbortSignal;
  }) => Promise<unknown>;
  refineTake: (input: {
    expectedStateVersion: number;
    sourceTakeId: string;
    dimension: keyof MasteringModifiers;
    direction: 'increase' | 'decrease';
    amount: 'small' | 'medium';
    creator: 'webmcp';
    prompt: string;
    signal?: AbortSignal;
  }) => Promise<unknown>;
  createVariations: (input: {
    expectedStateVersion: number;
    styles: StyleId[];
    constraint: 'preserve_transients' | 'keep_dynamic' | 'avoid_harshness' | 'none';
    creator: 'webmcp';
    prompt: string;
    signal?: AbortSignal;
  }) => Promise<unknown>;
  stageComparison: (input: {
    expectedStateVersion: number;
    takeIds: string[];
    loudnessMatched: boolean;
    creator: 'webmcp';
  }) => Promise<unknown>;
  setTrimFades: (input: {
    expectedStateVersion: number;
    startSeconds: number;
    endSeconds: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
    creator: 'webmcp';
  }) => Promise<unknown>;
  commitMaster: (input: {
    expectedStateVersion: number;
    takeId: string;
    creator: 'webmcp';
  }) => Promise<unknown>;
}

const stateVersion = {
  type: 'integer',
  minimum: 0,
  description: 'Version returned by get_studio_state.',
};

const styleEnum = ['full_power', 'warm_presence', 'modern_crisp', 'dominant'];
const constraintEnum = [
  'preserve_transients',
  'avoid_pumping',
  'avoid_harshness',
  'avoid_clipping',
  'keep_dynamic',
];

export async function registerChampagneTools(
  apiRef: MutableRefObject<StudioCommandApi | null>,
  onAvailability: (available: boolean) => void,
): Promise<() => void> {
  const modelContext = (document as WebMCPDocument).modelContext;
  if (typeof modelContext?.registerTool !== 'function') {
    onAvailability(false);
    return () => undefined;
  }

  const call = <T,>(method: (api: StudioCommandApi) => T): T | { ok: false; code: string; message: string } => {
    const api = apiRef.current;
    if (!api) return { ok: false, code: 'STUDIO_NOT_READY', message: 'The Champagne studio is still starting.' };
    return method(api);
  };

  const tools: ModelContextTool[] = [
    {
      name: 'get_studio_state',
      title: 'Read Champagne studio state',
      description: 'Read the current local track status, mastering takes, active take, version, and valid next actions. Does not expose audio, waveform samples, or the local filename.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      execute: async () => call((api) => api.getState()),
    },
    {
      name: 'analyze_track',
      title: 'Analyze the loaded track',
      description: 'Measure the loaded track locally and return compact objective level, peak, crest-factor, duration, and headroom findings. No audio leaves the page.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      execute: async (_input, context) => call((api) => api.analyzeTrack(context?.signal)),
    },
    {
      name: 'create_mastering_take',
      title: 'Create a mastering take',
      description: 'Create and locally render one reversible Champagne mastering take from a tested style and bounded musical priorities. The result becomes audible and visible in the studio.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: stateVersion,
          baseStyle: { type: 'string', enum: styleEnum, description: 'Tested Champagne mastering style.' },
          priorities: { type: 'array', maxItems: 4, items: { type: 'string', enum: ['loudness', 'punch', 'warmth', 'clarity', 'dynamic_range'] } },
          constraints: { type: 'array', maxItems: 4, items: { type: 'string', enum: constraintEnum } },
          intensity: { type: 'number', minimum: -1, maximum: 1, description: 'Bounded relative intensity from -1 to 1.' },
        },
        required: ['expectedStateVersion', 'baseStyle', 'priorities', 'constraints'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      execute: async (input, context) => {
        const value = input as { expectedStateVersion: number; baseStyle: StyleId; priorities: string[]; constraints: string[]; intensity?: number };
        return call((api) => api.createTake({ ...value, creator: 'webmcp', prompt: 'Directed through ChatGPT', signal: context?.signal }));
      },
    },
    {
      name: 'refine_mastering_take',
      title: 'Refine a mastering take',
      description: 'Create a reversible child take with one bounded semantic change. The source take remains intact and the new result becomes audible in the studio.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: stateVersion,
          sourceTakeId: { type: 'string', minLength: 1, maxLength: 64, description: 'Existing take ID.' },
          dimension: { type: 'string', enum: ['intensity', 'warmth', 'brightness', 'punch', 'dynamics'] },
          direction: { type: 'string', enum: ['increase', 'decrease'] },
          amount: { type: 'string', enum: ['small', 'medium'] },
        },
        required: ['expectedStateVersion', 'sourceTakeId', 'dimension', 'direction', 'amount'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      execute: async (input, context) => {
        const value = input as {
          expectedStateVersion: number;
          sourceTakeId: string;
          dimension: keyof MasteringModifiers;
          direction: 'increase' | 'decrease';
          amount: 'small' | 'medium';
        };
        return call((api) => api.refineTake({ ...value, creator: 'webmcp', prompt: 'Refined through ChatGPT', signal: context?.signal }));
      },
    },
    {
      name: 'create_variations',
      title: 'Create three mastering directions',
      description: 'Create up to three sibling mastering takes in one transaction and stage them for comparison. Use this for contrasting warm, open, and club-loud directions.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: stateVersion,
          styles: { type: 'array', minItems: 2, maxItems: 3, uniqueItems: true, items: { type: 'string', enum: styleEnum } },
          constraint: { type: 'string', enum: ['preserve_transients', 'keep_dynamic', 'avoid_harshness', 'none'] },
        },
        required: ['expectedStateVersion', 'styles', 'constraint'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      execute: async (input, context) => {
        const value = input as { expectedStateVersion: number; styles: StyleId[]; constraint: 'preserve_transients' | 'keep_dynamic' | 'avoid_harshness' | 'none' };
        return call((api) => api.createVariations({ ...value, creator: 'webmcp', prompt: 'Variation set directed through ChatGPT', signal: context?.signal }));
      },
    },
    {
      name: 'stage_comparison',
      title: 'Stage a mastering comparison',
      description: 'Place two or three existing takes in the live A/B/C deck. This changes monitoring only and does not alter any rendered take.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: stateVersion,
          takeIds: { type: 'array', minItems: 2, maxItems: 3, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 64 } },
          loudnessMatched: { type: 'boolean', description: 'Normalize monitoring level for fair comparison.' },
        },
        required: ['expectedStateVersion', 'takeIds', 'loudnessMatched'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute: async (input) => call((api) => api.stageComparison({ ...(input as { expectedStateVersion: number; takeIds: string[]; loudnessMatched: boolean }), creator: 'webmcp' })),
    },
    {
      name: 'set_trim_fades',
      title: 'Set trim and fades',
      description: 'Update the non-destructive keep region and fade lengths for this local project. Values are validated against the loaded track duration.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: stateVersion,
          startSeconds: { type: 'number', minimum: 0 },
          endSeconds: { type: 'number', exclusiveMinimum: 0 },
          fadeInSeconds: { type: 'number', minimum: 0, maximum: 30 },
          fadeOutSeconds: { type: 'number', minimum: 0, maximum: 30 },
        },
        required: ['expectedStateVersion', 'startSeconds', 'endSeconds', 'fadeInSeconds', 'fadeOutSeconds'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute: async (input) => call((api) => api.setTrimFades({ ...(input as { expectedStateVersion: number; startSeconds: number; endSeconds: number; fadeInSeconds: number; fadeOutSeconds: number }), creator: 'webmcp' })),
    },
    {
      name: 'commit_master',
      title: 'Prepare the selected master',
      description: 'Stage one take for a release-quality local 24-bit 48 kHz WAV render. This never downloads automatically; the user must click Download in Champagne.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: stateVersion,
          takeId: { type: 'string', minLength: 1, maxLength: 64, description: 'Existing mastering take ID.' },
        },
        required: ['expectedStateVersion', 'takeId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute: async (input) => call((api) => api.commitMaster({ ...(input as { expectedStateVersion: number; takeId: string }), creator: 'webmcp' })),
    },
  ];

  try {
    for (const tool of tools) await modelContext.registerTool(tool);
    onAvailability(true);
  } catch {
    onAvailability(false);
  }

  return () => {
    for (const tool of tools) {
      try { void modelContext.unregisterTool?.(tool.name); } catch { /* Older implementations may not unregister. */ }
    }
  };
}
