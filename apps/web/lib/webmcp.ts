import type { MutableRefObject } from 'react';

import {
  DEFAULT_MODIFIERS,
  type MasteringModifiers,
  type StyleId,
} from '@/lib/studio';

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
  execute: (
    input: unknown,
    context?: ToolExecutionContext,
  ) => Promise<unknown> | unknown;
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
    modifiers?: MasteringModifiers;
    customName?: string;
    matchedDirections?: string[];
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
    constraint:
      | 'preserve_transients'
      | 'keep_dynamic'
      | 'avoid_harshness'
      | 'none';
    creator: 'webmcp';
    prompt: string;
    signal?: AbortSignal;
  }) => Promise<unknown>;
  stageComparison: (input: {
    expectedStateVersion: number;
    takeIds: string[];
    creator: 'webmcp';
  }) => Promise<unknown>;
  setTrimFades: (input: {
    expectedStateVersion: number;
    startSeconds: number;
    endSeconds: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
    fadeInCurve?: number;
    fadeOutCurve?: number;
    creator: 'webmcp';
  }) => Promise<unknown>;
  setTrackSpeed: (input: {
    expectedStateVersion: number;
    speedPercent: number;
    creator: 'webmcp';
  }) => Promise<unknown>;
  commitMaster: (input: {
    expectedStateVersion: number;
    takeId: string;
    creator: 'webmcp';
  }) => Promise<unknown>;
  downloadMaster: (input: {
    expectedStateVersion?: number;
    takeId?: string;
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

  const call = <T>(
    method: (api: StudioCommandApi) => T,
  ): T | { ok: false; code: string; message: string } => {
    const api = apiRef.current;
    if (!api)
      return {
        ok: false,
        code: 'STUDIO_NOT_READY',
        message: 'The Champagne studio is still starting.',
      };
    return method(api);
  };

  const tools: ModelContextTool[] = [
    {
      name: 'get_studio_state',
      title: 'Read Champagne studio state',
      description:
        'Read the current local track status, rendered styles, active style, version, and valid next actions. Does not expose audio, waveform samples, or the local filename.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async () => call((api) => api.getState()),
    },
    {
      name: 'analyze_track',
      title: 'Analyze the loaded track',
      description:
        'Measure the loaded track locally and return compact objective level, peak, crest-factor, duration, and headroom findings. No audio leaves the page.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async (_input, context) =>
        call((api) => api.analyzeTrack(context?.signal)),
    },
    {
      name: 'create_mastering_take',
      title: 'Create a custom mastering style',
      description:
        'Use only when the user requests mastering or sonic changes. Create and locally render one reversible custom Champagne style from a safe baseline plus small, bounded musical adjustments. If the same request also includes cuts, fades, or speed, call those tools afterward in that order and pass each newly returned stateVersion into the next action.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: stateVersion,
          baseStyle: {
            type: 'string',
            enum: styleEnum,
            description: 'Tested Champagne mastering style.',
          },
          priorities: {
            type: 'array',
            maxItems: 5,
            items: {
              type: 'string',
              enum: [
                'loudness',
                'punch',
                'warmth',
                'clarity',
                'dynamic_range',
                'low_end',
                'presence',
                'air',
                'width',
                'glue',
                'density',
                'smoothness',
              ],
            },
          },
          constraints: {
            type: 'array',
            maxItems: 4,
            items: { type: 'string', enum: constraintEnum },
          },
          intensity: {
            type: 'number',
            minimum: -1,
            maximum: 1,
            description: 'Bounded relative intensity from -1 to 1.',
          },
          styleName: {
            type: 'string',
            minLength: 1,
            maxLength: 48,
            description: 'Short user-facing name for this custom style.',
          },
          brief: {
            type: 'string',
            minLength: 1,
            maxLength: 240,
            description: 'Concise musical direction being implemented.',
          },
          adjustments: {
            type: 'object',
            properties: {
              warmth: { type: 'number', minimum: -1, maximum: 1 },
              brightness: { type: 'number', minimum: -1, maximum: 1 },
              punch: { type: 'number', minimum: -1, maximum: 1 },
              dynamics: { type: 'number', minimum: -1, maximum: 1 },
              lowEnd: { type: 'number', minimum: -1, maximum: 1 },
              presence: { type: 'number', minimum: -1, maximum: 1 },
              air: { type: 'number', minimum: -1, maximum: 1 },
              width: { type: 'number', minimum: -1, maximum: 1 },
              glue: { type: 'number', minimum: -1, maximum: 1 },
              density: { type: 'number', minimum: -1, maximum: 1 },
              smoothness: { type: 'number', minimum: -1, maximum: 1 },
            },
            additionalProperties: false,
          },
        },
        required: [
          'expectedStateVersion',
          'baseStyle',
          'priorities',
          'constraints',
          'styleName',
          'brief',
        ],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input, context) => {
        const value = input as {
          expectedStateVersion: number;
          baseStyle: StyleId;
          priorities: string[];
          constraints: string[];
          intensity?: number;
          styleName: string;
          brief: string;
          adjustments?: Partial<MasteringModifiers>;
        };
        const modifiers = {
          ...DEFAULT_MODIFIERS,
          ...value.adjustments,
          intensity: value.intensity ?? 0,
        };
        return call((api) =>
          api.createTake({
            expectedStateVersion: value.expectedStateVersion,
            baseStyle: value.baseStyle,
            priorities: value.priorities,
            constraints: value.constraints,
            modifiers,
            customName: value.styleName,
            matchedDirections: [value.styleName],
            creator: 'webmcp',
            prompt: value.brief,
            signal: context?.signal,
          }),
        );
      },
    },
    {
      name: 'refine_mastering_take',
      title: 'Refine a custom style',
      description:
        'Create a reversible child style with one bounded semantic change. The source remains intact and the new result becomes the active audible master.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: stateVersion,
          sourceTakeId: {
            type: 'string',
            minLength: 1,
            maxLength: 64,
            description: 'Existing rendered style ID.',
          },
          dimension: {
            type: 'string',
            enum: [
              'intensity',
              'warmth',
              'brightness',
              'punch',
              'dynamics',
              'lowEnd',
              'presence',
              'air',
              'width',
              'glue',
              'density',
              'smoothness',
            ],
          },
          direction: { type: 'string', enum: ['increase', 'decrease'] },
          amount: { type: 'string', enum: ['small', 'medium'] },
          brief: { type: 'string', minLength: 1, maxLength: 180 },
        },
        required: [
          'expectedStateVersion',
          'sourceTakeId',
          'dimension',
          'direction',
          'amount',
          'brief',
        ],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input, context) => {
        const value = input as {
          expectedStateVersion: number;
          sourceTakeId: string;
          dimension: keyof MasteringModifiers;
          direction: 'increase' | 'decrease';
          amount: 'small' | 'medium';
          brief: string;
        };
        return call((api) =>
          api.refineTake({
            ...value,
            creator: 'webmcp',
            prompt: value.brief,
            signal: context?.signal,
          }),
        );
      },
    },
    {
      name: 'create_variations',
      title: 'Create three mastering directions',
      description:
        'Create up to three sibling mastering styles in one transaction and select the first result. Use this for contrasting warm, open, and club-loud directions.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: stateVersion,
          styles: {
            type: 'array',
            minItems: 2,
            maxItems: 3,
            uniqueItems: true,
            items: { type: 'string', enum: styleEnum },
          },
          constraint: {
            type: 'string',
            enum: [
              'preserve_transients',
              'keep_dynamic',
              'avoid_harshness',
              'none',
            ],
          },
        },
        required: ['expectedStateVersion', 'styles', 'constraint'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input, context) => {
        const value = input as {
          expectedStateVersion: number;
          styles: StyleId[];
          constraint:
            | 'preserve_transients'
            | 'keep_dynamic'
            | 'avoid_harshness'
            | 'none';
        };
        return call((api) =>
          api.createVariations({
            ...value,
            creator: 'webmcp',
            prompt: 'Variation set directed through ChatGPT',
            signal: context?.signal,
          }),
        );
      },
    },
    {
      name: 'stage_comparison',
      title: 'Stage a mastering comparison',
      description:
        'Group two or three rendered custom styles for comparison and select the first. This does not alter any rendered audio.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: stateVersion,
          takeIds: {
            type: 'array',
            minItems: 2,
            maxItems: 3,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
        required: ['expectedStateVersion', 'takeIds'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      execute: async (input) =>
        call((api) =>
          api.stageComparison({
            ...(input as { expectedStateVersion: number; takeIds: string[] }),
            creator: 'webmcp',
          }),
        ),
    },
    {
      name: 'set_trim_fades',
      title: 'Set trim and fades',
      description:
        'Use for every cut, trim, fade-in, or fade-out instruction, including when it appears inside a mastering request. Update the non-destructive keep region and fade lengths while preserving the selected master. Values are validated against the loaded track duration; after a prior action, use that action’s returned stateVersion.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: stateVersion,
          startSeconds: { type: 'number', minimum: 0 },
          endSeconds: { type: 'number', exclusiveMinimum: 0 },
          fadeInSeconds: { type: 'number', minimum: 0, maximum: 30 },
          fadeOutSeconds: { type: 'number', minimum: 0, maximum: 30 },
          fadeInCurve: {
            type: 'number',
            minimum: -1,
            maximum: 1,
            description: 'Fade-in curvature; -1 broad, +1 sharp.',
          },
          fadeOutCurve: {
            type: 'number',
            minimum: -1,
            maximum: 1,
            description: 'Fade-out curvature; -1 broad, +1 sharp.',
          },
        },
        required: [
          'expectedStateVersion',
          'startSeconds',
          'endSeconds',
          'fadeInSeconds',
          'fadeOutSeconds',
        ],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      execute: async (input) =>
        call((api) =>
          api.setTrimFades({
            ...(input as {
              expectedStateVersion: number;
              startSeconds: number;
              endSeconds: number;
              fadeInSeconds: number;
              fadeOutSeconds: number;
              fadeInCurve?: number;
              fadeOutCurve?: number;
            }),
            creator: 'webmcp',
          }),
        ),
    },
    {
      name: 'commit_master',
      title: 'Prepare the selected master',
      description:
        'Select one rendered style as the current release-quality local 24-bit 48 kHz WAV. The person saves it with the visible Download WAV button.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: stateVersion,
          takeId: {
            type: 'string',
            minLength: 1,
            maxLength: 64,
            description: 'Existing rendered style ID.',
          },
        },
        required: ['expectedStateVersion', 'takeId'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      execute: async (input) =>
        call((api) =>
          api.commitMaster({
            ...(input as { expectedStateVersion: number; takeId: string }),
            creator: 'webmcp',
          }),
        ),
    },
    {
      name: 'set_track_speed',
      title: 'Set playback and export speed',
      description:
        'Use for every speed instruction, including when it appears inside a mastering request. Set the current track speed from 50% to 150%; the change is heard immediately, updates the visible percentage and slider, and is baked into the next WAV export. 100% restores normal speed. After a prior action, use that action’s returned stateVersion.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: stateVersion,
          speedPercent: {
            type: 'number',
            minimum: 50,
            maximum: 150,
            description:
              'Absolute track speed. For example, 135 is 35% faster and 75 is three-quarters speed.',
          },
        },
        required: ['expectedStateVersion', 'speedPercent'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      execute: async (input) =>
        call((api) =>
          api.setTrackSpeed({
            ...(input as {
              expectedStateVersion: number;
              speedPercent: number;
            }),
            creator: 'webmcp',
          }),
        ),
    },
    {
      name: 'download_master',
      title: 'Prepare the current track for download',
      description:
        'This helper can prepare the selected current master as a local 24-bit 48 kHz WAV, but it cannot complete a browser download. Do not suggest it as part of a workflow. The person should click the visible Download WAV button to save. Call this only when the user explicitly asks Champagne to prepare the WAV first, and never claim the file downloaded automatically. The version is optional and a stale version will not block preparation.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedStateVersion: {
            ...stateVersion,
            description:
              'Optional version returned by get_studio_state or the prior action. A stale value does not block an explicit download.',
          },
          takeId: {
            type: 'string',
            minLength: 1,
            maxLength: 64,
            description:
              'Optional rendered style ID. Omit it to download the current selected master.',
          },
        },
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      execute: async (input) =>
        call((api) =>
          api.downloadMaster({
            ...(input as { expectedStateVersion?: number; takeId?: string }),
            creator: 'webmcp',
          }),
        ),
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
      try {
        void modelContext.unregisterTool?.(tool.name);
      } catch {
        /* Older implementations may not unregister. */
      }
    }
  };
}
