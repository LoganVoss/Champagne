'use client';

import {
  Activity,
  ArrowUp,
  AudioWaveform,
  Bot,
  Bolt,
  Cable,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Diamond,
  Download,
  Eye,
  Flame,
  Info,
  Music2,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';

import { WaveformEditor } from '@/components/waveform-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import {
  analyzeAudioBuffer,
  decodeAudioFile,
  encodeMasterWav24,
  makeWaveform,
  parabolicFadeGain,
  renderMasteringTake,
} from '@/lib/audio-engine';
import {
  clamp,
  DEFAULT_MODIFIERS,
  formatTime,
  interpretBrief,
  interpretStudioPrompt,
  makeId,
  makePlanHash,
  sanitizePresetName,
  STYLE_IDS,
  STYLE_RECIPES,
  type ActivityReceipt,
  type AudioAnalysis,
  type Creator,
  type InterpretedBrief,
  type MasteringIntent,
  type MasteringModifiers,
  type MasterRevision,
  type StudioPhase,
  type StyleId,
  type TrimSettings,
} from '@/lib/studio';
import { registerChampagneTools, type StudioCommandApi } from '@/lib/webmcp';

interface TrackRuntime {
  name: string;
  sourceKey: string;
  buffer: AudioBuffer;
  waveform: number[];
  analysis: AudioAnalysis;
  demoIndex: number | null;
}

interface PlaybackRuntime {
  context: AudioContext;
  source: AudioBufferSourceNode;
  gain: GainNode;
  offset: number;
  startedAt: number;
  baseGain: number;
  speedRate: number;
}

interface PreparedDownload {
  url: string;
  fileName: string;
  stateVersion: number;
  takeId: string | null;
}

const styleIcons = {
  full_power: Bolt,
  warm_presence: Flame,
  modern_crisp: Diamond,
  dominant: Activity,
} satisfies Record<StyleId, typeof Bolt>;

const afterPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const runViewTransition = async (update: () => void, waitForFinish = false) => {
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  const startViewTransition = (
    document as Document & {
      startViewTransition?: (callback: () => void) => {
        updateCallbackDone: Promise<void>;
        finished: Promise<void>;
      };
    }
  ).startViewTransition;

  if (!startViewTransition || reducedMotion) {
    update();
    return;
  }

  let updated = false;
  try {
    const transition = startViewTransition.call(document, () => {
      flushSync(update);
      updated = true;
    });
    await (waitForFinish ? transition.finished : transition.updateCallbackDone);
  } catch {
    if (!updated) update();
  }
};
const PROMPT_SUGGESTIONS = [
  'Create a vibrant, electric, and powerful master. Trim the first second and the last second. Fade the start and finish for two seconds on each side. Increase track speed by 10%.',
  'Create a polished master with smooth highs, tight lows, and lots of air. Trim the first two seconds and the last two seconds. Fade in the first second and fade out the last second.',
  'Create a warm master with crisp highs, vibrant lows, and a punchy feel. Cut the first two seconds and fade out the last two seconds.',
  'Create a modern pop master with high energy. Fade in the first two seconds and fade out the last two seconds.',
  'Create a classic, punchy, dominant, and strong master. Cut the first five seconds and the last five seconds.',
  'Create a relaxing, calm, and fluid master with a long five-second fade at each end.',
  'Create a wide, cinematic master with clear vocals and controlled bass. Trim the first second, fade out the final three seconds, and slow the track by 5%.',
  'Make this radio-ready: bright, punchy, and balanced. Cut two seconds from both ends and fade each side for one second.',
  'Create a dark, intimate master with warm mids and soft highs. Fade in over four seconds and fade out over four seconds.',
  'Give this a clean festival master with tight subs, wide energy, and smooth transients. Trim one second from each end and increase speed by 5%.',
];
const DEMO_TRACKS = [
  {
    name: 'Motorcycle',
    path: '/motorcycle-demo.m4a',
    fileName: 'Motorcycle.m4a',
    type: 'audio/mp4',
    sourceKey: 'motorcycle-demo-v1',
  },
  {
    name: 'Interstellar',
    path: '/audio/demo/interstellar.m4a',
    fileName: 'Interstellar.m4a',
    type: 'audio/mp4',
    sourceKey: 'interstellar-demo-v1',
  },
  {
    name: 'Fire',
    path: '/audio/demo/fire.m4a',
    fileName: 'Fire.m4a',
    type: 'audio/mp4',
    sourceKey: 'fire-demo-v1',
  },
  {
    name: 'Light Beam',
    path: '/audio/demo/light-beam.m4a',
    fileName: 'Light Beam.m4a',
    type: 'audio/mp4',
    sourceKey: 'light-beam-demo-v1',
  },
  {
    name: 'Another Night Alone',
    path: '/audio/demo/another-night-alone.m4a',
    fileName: 'Another Night Alone.m4a',
    type: 'audio/mp4',
    sourceKey: 'another-night-alone-demo-v1',
  },
] as const;

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function safeDownloadName(name: string, styleName: string): string {
  const base =
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .trim() || 'track';
  const style =
    styleName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 36) || 'custom';
  return `${base}_champagne_${style}.wav`;
}

export function ChampagneStudio() {
  const [track, setTrack] = useState<TrackRuntime | null>(null);
  const [phase, setPhase] = useState<StudioPhase>('empty');
  const [revisions, setRevisions] = useState<MasterRevision[]>([]);
  const [activeRevisionId, setActiveRevisionId] = useState<string | null>(null);
  const [monitorMastered, setMonitorMastered] = useState(true);
  const [trim, setTrim] = useState<TrimSettings>({
    startSeconds: 0,
    endSeconds: 0,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
    fadeInCurve: 1 / 3,
    fadeOutCurve: 1 / 3,
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [speedPercent, setSpeedPercent] = useState(100);
  const [speedEnabled, setSpeedEnabled] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [brief, setBrief] = useState('');
  const [, setIntentDisplay] = useState<InterpretedBrief | null>(null);
  const [, setActivity] = useState<ActivityReceipt[]>([]);
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [copiedSuggestionIndex, setCopiedSuggestionIndex] = useState<
    number | null
  >(null);
  const [stateVersion, setStateVersion] = useState(0);
  const [webmcpAvailable, setWebmcpAvailable] = useState(false);
  const [webmcpResolved, setWebmcpResolved] = useState(false);
  const [webmcpInvoked, setWebmcpInvoked] = useState(false);
  const [agentPaused, setAgentPaused] = useState(false);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [, setExportReadyId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isDropTargeted, setIsDropTargeted] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const downloadAnchorRef = useRef<HTMLAnchorElement>(null);
  const preparedDownloadRef = useRef<PreparedDownload | null>(null);
  const composerFieldRef = useRef<HTMLDivElement>(null);
  const composerSuggestionTextRef = useRef<HTMLSpanElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackRef = useRef<PlaybackRuntime | null>(null);
  const renderBusyRef = useRef(false);
  const exportBusyRef = useRef(false);
  const loadRequestRef = useRef(0);
  const committedSpeedRef = useRef(100);
  const stateVersionRef = useRef(0);
  const apiRef = useRef<StudioCommandApi | null>(null);
  const runtimeRef = useRef({
    track,
    phase,
    revisions,
    activeRevisionId,
    monitorMastered,
    trim,
    speedPercent,
    speedEnabled,
    comparisonIds,
    agentPaused,
  });
  runtimeRef.current = {
    track,
    phase,
    revisions,
    activeRevisionId,
    monitorMastered,
    trim,
    speedPercent,
    speedEnabled,
    comparisonIds,
    agentPaused,
  };

  const activeRevision =
    revisions.find((revision) => revision.id === activeRevisionId) ?? null;
  const activeWaveform =
    monitorMastered && activeRevision
      ? activeRevision.waveform
      : (track?.waveform ?? []);
  const isLoadingView = phase === 'analyzing' && !track;
  const isStudioBusy =
    Boolean(track) && (phase === 'analyzing' || phase === 'rendering');
  const studioView = isLoadingView ? 'loading' : track ? 'studio' : 'selection';
  const manualMode = webmcpResolved && !webmcpAvailable;

  const bumpStateVersion = useCallback(() => {
    const next = stateVersionRef.current + 1;
    stateVersionRef.current = next;
    setStateVersion(next);
    return next;
  }, []);

  const copyCurrentSuggestion = useCallback(async () => {
    const suggestion = PROMPT_SUGGESTIONS[suggestionIndex];

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(suggestion);
      } else {
        const focusedElement = document.activeElement as HTMLElement | null;
        const textarea = document.createElement('textarea');
        textarea.value = suggestion;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);

        try {
          textarea.focus();
          textarea.select();
          const executeCopy = (
            document as unknown as {
              execCommand(command: string): boolean;
            }
          ).execCommand.bind(document);
          if (!executeCopy('copy')) {
            throw new Error('Copy command was unavailable.');
          }
        } finally {
          textarea.remove();
          focusedElement?.focus();
        }
      }

      setCopiedSuggestionIndex(suggestionIndex);
    } catch {
      setNotice(
        'Champagne could not copy that prompt. Please copy it manually.',
      );
    }
  }, [suggestionIndex]);

  const addReceipt = useCallback(
    (receipt: Omit<ActivityReceipt, 'id' | 'time'>) => {
      setActivity((current) =>
        [
          { ...receipt, id: makeId('receipt'), time: Date.now() },
          ...current,
        ].slice(0, 24),
      );
    },
    [],
  );

  const stopPlayback = useCallback((preserveTime = true) => {
    const playback = playbackRef.current;
    if (playback) {
      if (preserveTime) {
        const elapsed = playback.context.currentTime - playback.startedAt;
        setCurrentTime(
          clamp(
            playback.offset + elapsed * playback.speedRate,
            0,
            runtimeRef.current.track?.buffer.duration ?? 0,
          ),
        );
      }
      const now = playback.context.currentTime;
      playback.gain.gain.cancelScheduledValues(now);
      playback.gain.gain.setValueAtTime(playback.gain.gain.value, now);
      playback.gain.gain.linearRampToValueAtTime(0, now + 0.012);
      try {
        playback.source.stop(now + 0.014);
      } catch {
        /* Source may have ended. */
      }
    }
    playbackRef.current = null;
    setIsPlaying(false);
  }, []);

  const getMonitoredSource = useCallback(() => {
    const snapshot = runtimeRef.current;
    if (!snapshot.track) return null;
    if (snapshot.monitorMastered && snapshot.activeRevisionId) {
      const revision = snapshot.revisions.find(
        (candidate) => candidate.id === snapshot.activeRevisionId,
      );
      if (revision)
        return { buffer: revision.buffer, analysis: revision.analysis };
    }
    return { buffer: snapshot.track.buffer, analysis: snapshot.track.analysis };
  }, []);

  const startPlayback = useCallback(
    async (
      offset = currentTime,
      sourceOverride?: { buffer: AudioBuffer; analysis: AudioAnalysis },
    ) => {
      const monitored = sourceOverride ?? getMonitoredSource();
      if (!monitored) return;
      const AudioContextConstructor =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextConstructor) {
        setNotice('Web Audio playback is unavailable in this browser.');
        return;
      }
      const context = audioContextRef.current ?? new AudioContextConstructor();
      audioContextRef.current = context;
      if (context.state === 'suspended') await context.resume();

      const old = playbackRef.current;
      const now = context.currentTime;
      if (old) {
        old.gain.gain.cancelScheduledValues(now);
        old.gain.gain.setValueAtTime(old.gain.gain.value, now);
        old.gain.gain.linearRampToValueAtTime(0, now + 0.012);
        try {
          old.source.stop(now + 0.014);
        } catch {
          /* Ignore already-ended nodes. */
        }
      }

      const source = context.createBufferSource();
      source.buffer = monitored.buffer;
      const speedRate = runtimeRef.current.speedPercent / 100;
      source.playbackRate.setValueAtTime(speedRate, now);
      const gain = context.createGain();
      const baseGain = 1;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(baseGain, now + 0.012);
      source.connect(gain);
      gain.connect(context.destination);
      const { trim: liveTrim } = runtimeRef.current;
      const safeOffset = clamp(
        offset < liveTrim.startSeconds || offset >= liveTrim.endSeconds
          ? liveTrim.startSeconds
          : offset,
        0,
        Math.max(0, monitored.buffer.duration - 0.01),
      );
      source.start(now, safeOffset);
      playbackRef.current = {
        context,
        source,
        gain,
        offset: safeOffset,
        startedAt: now,
        baseGain,
        speedRate,
      };
      setCurrentTime(safeOffset);
      setIsPlaying(true);
    },
    [currentTime, getMonitoredSource],
  );

  const seekTo = useCallback(
    (seconds: number) => {
      const next = clamp(
        seconds,
        runtimeRef.current.trim.startSeconds,
        runtimeRef.current.trim.endSeconds,
      );
      setCurrentTime(next);
      if (playbackRef.current) void startPlayback(next);
    },
    [startPlayback],
  );

  const applyPlaybackSpeed = useCallback(
    (requestedPercent: number, enabled = true) => {
      const nextPercent = round(clamp(requestedPercent, 50, 150), 1);
      const nextEnabled = enabled && nextPercent !== 100;
      const nextRate = nextPercent / 100;
      const playback = playbackRef.current;
      if (playback) {
        const now = playback.context.currentTime;
        const position = clamp(
          playback.offset + (now - playback.startedAt) * playback.speedRate,
          runtimeRef.current.trim.startSeconds,
          runtimeRef.current.trim.endSeconds,
        );
        playback.source.playbackRate.cancelScheduledValues(now);
        playback.source.playbackRate.setValueAtTime(nextRate, now);
        playback.offset = position;
        playback.startedAt = now;
        playback.speedRate = nextRate;
        setCurrentTime(position);
      }
      runtimeRef.current.speedPercent = nextPercent;
      runtimeRef.current.speedEnabled = nextEnabled;
      setSpeedPercent(nextPercent);
      setSpeedEnabled(nextEnabled);
      setExportReadyId(null);
      return nextPercent;
    },
    [],
  );

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    const update = () => {
      const playback = playbackRef.current;
      if (!playback) return;
      const now =
        playback.offset +
        (playback.context.currentTime - playback.startedAt) *
          playback.speedRate;
      const liveTrim = runtimeRef.current.trim;
      if (now >= liveTrim.endSeconds - 0.012) {
        setCurrentTime(liveTrim.endSeconds);
        stopPlayback(false);
        return;
      }
      let fade = 1;
      if (
        liveTrim.fadeInSeconds > 0.001 &&
        now < liveTrim.startSeconds + liveTrim.fadeInSeconds
      ) {
        const x = clamp(
          (now - liveTrim.startSeconds) / liveTrim.fadeInSeconds,
          0,
          1,
        );
        fade = parabolicFadeGain(x, liveTrim.fadeInCurve);
      } else if (
        liveTrim.fadeOutSeconds > 0.001 &&
        now > liveTrim.endSeconds - liveTrim.fadeOutSeconds
      ) {
        const x = clamp(
          (liveTrim.endSeconds - now) / liveTrim.fadeOutSeconds,
          0,
          1,
        );
        fade = parabolicFadeGain(x, liveTrim.fadeOutCurve);
      }
      playback.gain.gain.setTargetAtTime(
        playback.baseGain * fade,
        playback.context.currentTime,
        0.006,
      );
      setCurrentTime(now);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, stopPlayback]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.code !== 'Space' ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLInputElement
      )
        return;
      event.preventDefault();
      if (!runtimeRef.current.track) return;
      if (playbackRef.current) stopPlayback();
      else void startPlayback();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [startPlayback, stopPlayback]);

  useEffect(
    () => () => {
      stopPlayback(false);
      void audioContextRef.current?.close();
    },
    [stopPlayback],
  );

  useEffect(() => {
    if (
      brief.trim() ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const timer = window.setInterval(() => {
      setCopiedSuggestionIndex(null);
      setSuggestionIndex(
        (current) => (current + 1) % PROMPT_SUGGESTIONS.length,
      );
    }, 7600);
    return () => window.clearInterval(timer);
  }, [brief]);

  useLayoutEffect(() => {
    const field = composerFieldRef.current;
    const suggestion = composerSuggestionTextRef.current;
    if (!field || !suggestion || brief) return;

    const alignEmptyCaret = () => {
      const fieldRect = field.getBoundingClientRect();
      const suggestionRect = suggestion.getBoundingClientRect();
      const start = Math.max(22, suggestionRect.left - fieldRect.left - 2);
      field.style.setProperty('--empty-caret-left', `${start}px`);
    };

    alignEmptyCaret();
    const observer = new ResizeObserver(alignEmptyCaret);
    observer.observe(field);
    observer.observe(suggestion);
    return () => observer.disconnect();
  }, [brief, suggestionIndex, track, webmcpAvailable]);

  const markWebMCP = useCallback(
    (action: string) => {
      setWebmcpInvoked(true);
      addReceipt({
        creator: 'webmcp',
        title: 'ChatGPT action received',
        detail: action,
      });
    },
    [addReceipt],
  );

  const validateMutation = useCallback((expected: number, creator: Creator) => {
    if (creator === 'webmcp' && runtimeRef.current.agentPaused) {
      return {
        ok: false as const,
        code: 'AGENT_PAUSED',
        message: 'ChatGPT control is paused in Champagne.',
      };
    }
    if (expected !== stateVersionRef.current) {
      return {
        ok: false as const,
        code: 'STALE_STATE',
        message: 'The project changed after this action was planned.',
        currentStateVersion: stateVersionRef.current,
        recovery: 'Call get_studio_state and retry with the current version.',
      };
    }
    if (!runtimeRef.current.track)
      return {
        ok: false as const,
        code: 'NO_TRACK',
        message: 'Load a track in Champagne first.',
      };
    if (renderBusyRef.current)
      return {
        ok: false as const,
        code: 'RENDER_BUSY',
        message: 'A local preview render is already in progress.',
      };
    return null;
  }, []);

  const loadDecodedTrack = useCallback(
    async (
      name: string,
      sourceKey: string,
      buffer: AudioBuffer,
      demoIndex: number | null = null,
    ) => {
      const replacingTrack = Boolean(runtimeRef.current.track);
      stopPlayback(false);
      setPhase('analyzing');
      setNotice(null);
      setRevisions([]);
      setActiveRevisionId(null);
      setComparisonIds([]);
      setExportReadyId(null);
      setCurrentTime(0);
      setSpeedPercent(100);
      setSpeedEnabled(false);
      committedSpeedRef.current = 100;
      runtimeRef.current.speedPercent = 100;
      runtimeRef.current.speedEnabled = false;
      setMonitorMastered(false);
      await afterPaint();

      const analysis = analyzeAudioBuffer(buffer);
      const waveform = makeWaveform(buffer);
      const loaded: TrackRuntime = {
        name,
        sourceKey,
        buffer,
        waveform,
        analysis,
        demoIndex,
      };
      const revealTrack = () => {
        setTrack(loaded);
        setTrim({
          startSeconds: 0,
          endSeconds: buffer.duration,
          fadeInSeconds: 0,
          fadeOutSeconds: 0,
          fadeInCurve: 1 / 3,
          fadeOutCurve: 1 / 3,
        });
        setPhase('ready');
      };
      if (replacingTrack) revealTrack();
      else await runViewTransition(revealTrack);
      bumpStateVersion();
      addReceipt({
        creator: 'manual',
        title: 'Track analyzed locally',
        detail: `${formatTime(buffer.duration)} · ${Math.round(buffer.sampleRate / 100) / 10} kHz · ${buffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}`,
      });
      await afterPaint();
    },
    [addReceipt, bumpStateVersion, stopPlayback],
  );

  const loadFile = useCallback(
    async (file: File) => {
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (
        !['wav', 'wave', 'aiff', 'aif', 'mp3', 'm4a', 'flac', 'caf'].includes(
          extension ?? '',
        ) &&
        !file.type.startsWith('audio/')
      ) {
        setNotice(
          'That file does not look like a supported audio format. Try WAV, AIFF, MP3, M4A, or FLAC.',
        );
        return;
      }
      try {
        const requestId = ++loadRequestRef.current;
        const showLoading = () => {
          setAgentPanelOpen(false);
          setPhase('analyzing');
        };
        if (runtimeRef.current.track) showLoading();
        else await runViewTransition(showLoading, true);
        const buffer = await decodeAudioFile(file);
        if (requestId !== loadRequestRef.current) return;
        await loadDecodedTrack(
          file.name,
          `${file.size}-${file.lastModified}`,
          buffer,
        );
      } catch (error) {
        const showError = () => {
          const hasTrack = Boolean(runtimeRef.current.track);
          setPhase(hasTrack ? 'ready' : 'empty');
          if (!hasTrack) setTrack(null);
          setNotice(
            error instanceof Error
              ? `Champagne could not decode this file: ${error.message}`
              : 'Champagne could not decode this file.',
          );
        };
        if (runtimeRef.current.track) showError();
        else await runViewTransition(showError);
      }
    },
    [loadDecodedTrack],
  );

  const loadDemo = useCallback(
    async (requestedIndex = 0) => {
      const demoIndex =
        ((requestedIndex % DEMO_TRACKS.length) + DEMO_TRACKS.length) %
        DEMO_TRACKS.length;
      const demo = DEMO_TRACKS[demoIndex];
      try {
        const requestId = ++loadRequestRef.current;
        const showLoading = () => {
          setAgentPanelOpen(false);
          setPhase('analyzing');
        };
        if (runtimeRef.current.track) showLoading();
        else await runViewTransition(showLoading, true);
        const response = await fetch(demo.path);
        if (!response.ok) throw new Error('The demo track is unavailable.');
        const blob = await response.blob();
        const file = new File([blob], demo.fileName, { type: demo.type });
        const buffer = await decodeAudioFile(file);
        if (requestId !== loadRequestRef.current) return;
        await loadDecodedTrack(demo.name, demo.sourceKey, buffer, demoIndex);
      } catch (error) {
        const showError = () => {
          setPhase(runtimeRef.current.track ? 'ready' : 'empty');
          setNotice(
            error instanceof Error
              ? error.message
              : 'Champagne could not load the demo track.',
          );
        };
        if (runtimeRef.current.track) showError();
        else await runViewTransition(showError);
      }
    },
    [loadDecodedTrack],
  );

  const makeModifiers = (input: {
    intensity?: number;
    priorities: string[];
    constraints: string[];
  }) => {
    const modifiers = {
      ...DEFAULT_MODIFIERS,
      intensity: clamp(input.intensity ?? 0, -1, 1),
    };
    if (input.priorities.includes('punch')) modifiers.punch = 0.3;
    if (input.priorities.includes('warmth')) modifiers.warmth = 0.25;
    if (input.priorities.includes('clarity')) modifiers.brightness = 0.2;
    if (input.priorities.includes('dynamic_range')) modifiers.dynamics = 0.45;
    if (input.priorities.some((priority) => priority.includes('low')))
      modifiers.lowEnd = 0.22;
    if (input.priorities.includes('presence')) modifiers.presence = 0.22;
    if (input.priorities.includes('width')) modifiers.width = 0.3;
    if (
      input.constraints.some((constraint) =>
        constraint.includes('preserve_transients'),
      )
    )
      modifiers.punch = Math.max(0.35, modifiers.punch);
    if (
      input.constraints.some((constraint) =>
        constraint.includes('keep_dynamic'),
      )
    )
      modifiers.dynamics = Math.max(0.5, modifiers.dynamics);
    if (
      input.constraints.some((constraint) =>
        constraint.includes('avoid_harshness'),
      )
    )
      modifiers.smoothness = Math.max(modifiers.smoothness, 0.3);
    return modifiers;
  };

  const createTakeCommand = useCallback(
    async (input: {
      expectedStateVersion: number;
      baseStyle: StyleId;
      priorities: string[];
      constraints: string[];
      intensity?: number;
      modifiers?: MasteringModifiers;
      customName?: string;
      matchedDirections?: string[];
      parentId?: string;
      creator: Creator;
      prompt: string;
      signal?: AbortSignal;
    }) => {
      const invalid = validateMutation(
        input.expectedStateVersion,
        input.creator,
      );
      if (invalid) return invalid;
      if (!STYLE_IDS.includes(input.baseStyle))
        return {
          ok: false,
          code: 'INVALID_STYLE',
          message: 'Choose one of Champagne’s four tested styles.',
        };
      const snapshot = runtimeRef.current;
      const sourceTrack = snapshot.track!;
      const startingVersion = stateVersionRef.current;
      renderBusyRef.current = true;
      if (input.creator === 'webmcp')
        markWebMCP(
          `Creating a custom style from ${STYLE_RECIPES[input.baseStyle].name}`,
        );
      setAgentPanelOpen(false);
      setPhase('rendering');
      setMonitorMastered(true);

      const requestedModifiers = input.modifiers ?? makeModifiers(input);
      const modifiers = { ...DEFAULT_MODIFIERS };
      for (const key of Object.keys(modifiers) as Array<
        keyof MasteringModifiers
      >) {
        const value = requestedModifiers[key];
        modifiers[key] = clamp(Number.isFinite(value) ? value : 0, -1, 1);
      }
      const isManualSignature =
        input.creator === 'manual' && !input.customName && !input.parentId;
      const requestedDisplayName =
        input.customName?.trim() ||
        (input.parentId
          ? 'Refined Style'
          : STYLE_RECIPES[input.baseStyle].name);
      const displayName = (
        isManualSignature
          ? STYLE_RECIPES[input.baseStyle].name
          : sanitizePresetName(requestedDisplayName, input.prompt)
      ).slice(0, 48);
      const intent: MasteringIntent = {
        style: input.baseStyle,
        customName: displayName,
        matchedDirections: input.matchedDirections ?? [],
        priorities: input.priorities,
        constraints: input.constraints,
        modifiers,
      };
      setIntentDisplay({
        mode: input.parentId ? 'refine' : 'create',
        style: input.baseStyle,
        customName: displayName,
        matchedDirections: input.matchedDirections ?? [],
        priorities: input.priorities,
        constraints: input.constraints,
        modifiers,
      });
      await afterPaint();

      try {
        const buffer = await renderMasteringTake(
          sourceTrack.buffer,
          input.baseStyle,
          modifiers,
          input.signal,
        );
        if (startingVersion !== stateVersionRef.current) {
          setPhase(
            runtimeRef.current.revisions.length ? 'preview_ready' : 'ready',
          );
          return {
            ok: false,
            code: 'STALE_STATE',
            message: 'The project changed while the preview was rendering.',
          };
        }
        const currentRevisions = runtimeRef.current.revisions;
        const parent = input.parentId
          ? currentRevisions.find((revision) => revision.id === input.parentId)
          : undefined;
        const changedDimensions = (
          Object.entries(modifiers) as Array<[keyof MasteringModifiers, number]>
        )
          .filter(([, value]) => Math.abs(value) >= 0.08)
          .map(([key]) => key.replace(/([A-Z])/g, ' $1').toLowerCase())
          .slice(0, 5);
        const summary =
          displayName === STYLE_RECIPES[input.baseStyle].name
            ? STYLE_RECIPES[input.baseStyle].summary
            : `${displayName} uses ${STYLE_RECIPES[input.baseStyle].name} as a starting point, then reshapes ${changedDimensions.join(', ') || 'the overall balance'} through bounded Champagne controls.`;
        const revision: MasterRevision = {
          id: makeId('take'),
          displayName,
          parentId: parent?.id,
          style: input.baseStyle,
          creator: input.creator,
          createdAt: Date.now(),
          prompt: input.prompt,
          intent,
          buffer,
          waveform: makeWaveform(buffer),
          analysis: analyzeAudioBuffer(buffer),
          summary,
          planHash: makePlanHash(
            input.baseStyle,
            modifiers,
            sourceTrack.sourceKey,
          ),
        };
        setRevisions((current) => [...current, revision]);
        setActiveRevisionId(revision.id);
        setComparisonIds((current) =>
          current.length
            ? [...new Set([...current, revision.id])].slice(-3)
            : [revision.id],
        );
        setExportReadyId(null);
        setPhase('preview_ready');
        const nextVersion = bumpStateVersion();
        addReceipt({
          creator: input.creator,
          title: `${displayName} created`,
          detail: `${STYLE_RECIPES[input.baseStyle].name} baseline · ${input.priorities.join(' + ') || 'balanced direction'}`,
          revisionId: revision.id,
        });
        if (playbackRef.current)
          void startPlayback(currentTime, {
            buffer,
            analysis: revision.analysis,
          });
        await afterPaint();
        return {
          ok: true,
          commandId: makeId('cmd'),
          stateVersion: nextVersion,
          takeId: revision.id,
          styleName: displayName,
          summary: `Created the audible custom style “${displayName}” from a ${STYLE_RECIPES[input.baseStyle].name} baseline.`,
          changed: {
            style: input.baseStyle,
            priorities: input.priorities,
            constraints: input.constraints,
          },
          nextActions: [
            'refine_mastering_take',
            'stage_comparison',
            'set_trim_fades',
            'set_track_speed',
            'commit_master',
          ],
        };
      } catch (error) {
        const cancelled =
          error instanceof DOMException && error.name === 'AbortError';
        setNotice(
          cancelled
            ? 'The local render was cancelled.'
            : 'Champagne could not render this style.',
        );
        setPhase(
          runtimeRef.current.revisions.length ? 'preview_ready' : 'ready',
        );
        return {
          ok: false,
          code: cancelled ? 'CANCELLED' : 'RENDER_FAILED',
          message: cancelled
            ? 'The local render was cancelled.'
            : 'The local render failed.',
        };
      } finally {
        renderBusyRef.current = false;
      }
    },
    [
      addReceipt,
      bumpStateVersion,
      currentTime,
      markWebMCP,
      startPlayback,
      validateMutation,
    ],
  );

  const refineTakeCommand = useCallback(
    async (input: {
      expectedStateVersion: number;
      sourceTakeId: string;
      dimension: keyof MasteringModifiers;
      direction: 'increase' | 'decrease';
      amount: 'small' | 'medium';
      creator: Creator;
      prompt: string;
      signal?: AbortSignal;
    }) => {
      const source = runtimeRef.current.revisions.find(
        (revision) => revision.id === input.sourceTakeId,
      );
      if (!source)
        return {
          ok: false,
          code: 'TAKE_NOT_FOUND',
          message: 'That mastering style is no longer available.',
        };
      const delta =
        (input.amount === 'medium' ? 0.42 : 0.24) *
        (input.direction === 'increase' ? 1 : -1);
      const modifiers = {
        ...source.intent.modifiers,
        [input.dimension]: clamp(
          source.intent.modifiers[input.dimension] + delta,
          -1,
          1,
        ),
      };
      const dimensionLabel = input.dimension.replace(/([A-Z])/g, ' $1').trim();
      const refinementName = `${source.displayName} · ${input.direction === 'increase' ? 'More' : 'Less'} ${dimensionLabel}`;
      return createTakeCommand({
        expectedStateVersion: input.expectedStateVersion,
        baseStyle: source.style,
        priorities: source.intent.priorities,
        constraints: source.intent.constraints,
        modifiers,
        customName: refinementName,
        matchedDirections: source.intent.matchedDirections,
        parentId: source.id,
        creator: input.creator,
        prompt: input.prompt,
        signal: input.signal,
      });
    },
    [createTakeCommand],
  );

  const createVariationsCommand = useCallback(
    async (input: {
      expectedStateVersion: number;
      styles: StyleId[];
      constraint:
        | 'preserve_transients'
        | 'keep_dynamic'
        | 'avoid_harshness'
        | 'none';
      creator: Creator;
      prompt: string;
      signal?: AbortSignal;
    }) => {
      const invalid = validateMutation(
        input.expectedStateVersion,
        input.creator,
      );
      if (invalid) return invalid;
      const uniqueStyles = [...new Set(input.styles)]
        .filter((style): style is StyleId => STYLE_IDS.includes(style))
        .slice(0, 3);
      if (uniqueStyles.length < 2)
        return {
          ok: false,
          code: 'INVALID_VARIATIONS',
          message: 'Choose two or three different Champagne styles.',
        };
      const snapshot = runtimeRef.current;
      const sourceTrack = snapshot.track!;
      const startingVersion = stateVersionRef.current;
      renderBusyRef.current = true;
      if (input.creator === 'webmcp')
        markWebMCP(`Creating ${uniqueStyles.length} mastering directions`);
      setAgentPanelOpen(false);
      setPhase('rendering');
      setMonitorMastered(true);
      const constraintList =
        input.constraint === 'none'
          ? []
          : [input.constraint.replaceAll('_', ' ')];
      setIntentDisplay({
        mode: 'variations',
        style: uniqueStyles[0],
        styles: uniqueStyles,
        customName: 'Three Directions',
        matchedDirections: [],
        priorities: ['contrast'],
        constraints: constraintList,
        modifiers: { ...DEFAULT_MODIFIERS },
      });
      await afterPaint();

      try {
        const created: MasterRevision[] = [];
        for (let index = 0; index < uniqueStyles.length; index += 1) {
          if (input.signal?.aborted)
            throw new DOMException('Cancelled', 'AbortError');
          const style = uniqueStyles[index];
          const modifiers = makeModifiers({
            priorities:
              style === 'dominant'
                ? ['loudness', 'punch']
                : style === 'warm_presence'
                  ? ['warmth']
                  : ['clarity'],
            constraints: constraintList,
          });
          const buffer = await renderMasteringTake(
            sourceTrack.buffer,
            style,
            modifiers,
            input.signal,
          );
          const displayName =
            style === 'warm_presence'
              ? 'Analog Glow'
              : style === 'modern_crisp'
                ? 'Open Air'
                : style === 'dominant'
                  ? 'Club Impact'
                  : 'Forward Punch';
          created.push({
            id: makeId('take'),
            displayName,
            style,
            creator: input.creator,
            createdAt: Date.now() + index,
            prompt: input.prompt,
            intent: {
              style,
              customName: displayName,
              matchedDirections: [displayName],
              priorities:
                style === 'dominant'
                  ? ['loudness', 'punch']
                  : style === 'warm_presence'
                    ? ['warmth']
                    : ['clarity'],
              constraints: constraintList,
              modifiers,
            },
            buffer,
            waveform: makeWaveform(buffer),
            analysis: analyzeAudioBuffer(buffer),
            summary: STYLE_RECIPES[style].summary,
            planHash: makePlanHash(style, modifiers, sourceTrack.sourceKey),
          });
        }
        if (startingVersion !== stateVersionRef.current) {
          setPhase(
            runtimeRef.current.revisions.length ? 'preview_ready' : 'ready',
          );
          return {
            ok: false,
            code: 'STALE_STATE',
            message: 'The project changed while the variations were rendering.',
          };
        }
        setRevisions((current) => [...current, ...created]);
        setComparisonIds(created.map((revision) => revision.id));
        setActiveRevisionId(created[0].id);
        runtimeRef.current.comparisonIds = created.map(
          (revision) => revision.id,
        );
        setPhase('preview_ready');
        const nextVersion = bumpStateVersion();
        addReceipt({
          creator: input.creator,
          title: `${created.length} custom styles ready`,
          detail: 'Warm, open, and club-loud directions are ready to audition.',
          revisionId: created[0].id,
        });
        if (playbackRef.current)
          void startPlayback(currentTime, {
            buffer: created[0].buffer,
            analysis: created[0].analysis,
          });
        await afterPaint();
        return {
          ok: true,
          commandId: makeId('cmd'),
          stateVersion: nextVersion,
          takeIds: created.map((revision) => revision.id),
          styleNames: created.map((revision) => revision.displayName),
          summary: `Created ${created.length} audible custom styles and selected the first direction.`,
          nextActions: [
            'stage_comparison',
            'refine_mastering_take',
            'set_trim_fades',
            'set_track_speed',
            'commit_master',
          ],
        };
      } catch (error) {
        const cancelled =
          error instanceof DOMException && error.name === 'AbortError';
        setPhase(snapshot.revisions.length ? 'preview_ready' : 'ready');
        return {
          ok: false,
          code: cancelled ? 'CANCELLED' : 'RENDER_FAILED',
          message: cancelled
            ? 'The variation render was cancelled.'
            : 'Champagne could not render the variation set.',
        };
      } finally {
        renderBusyRef.current = false;
      }
    },
    [
      addReceipt,
      bumpStateVersion,
      currentTime,
      markWebMCP,
      startPlayback,
      validateMutation,
    ],
  );

  const stageComparisonCommand = useCallback(
    async (input: {
      expectedStateVersion: number;
      takeIds: string[];
      creator: Creator;
    }) => {
      if (input.creator === 'webmcp' && runtimeRef.current.agentPaused)
        return {
          ok: false,
          code: 'AGENT_PAUSED',
          message: 'ChatGPT control is paused in Champagne.',
        };
      if (input.expectedStateVersion !== stateVersionRef.current)
        return {
          ok: false,
          code: 'STALE_STATE',
          message: 'Call get_studio_state and retry.',
          currentStateVersion: stateVersionRef.current,
        };
      const unique = [...new Set(input.takeIds)]
        .filter((id) =>
          runtimeRef.current.revisions.some((revision) => revision.id === id),
        )
        .slice(0, 3);
      if (unique.length < 2)
        return {
          ok: false,
          code: 'TAKE_NOT_FOUND',
          message: 'Choose two or three available styles.',
        };
      if (input.creator === 'webmcp') markWebMCP('Staging custom styles');
      setComparisonIds(unique);
      runtimeRef.current.comparisonIds = unique;
      setActiveRevisionId(unique[0]);
      setMonitorMastered(true);
      addReceipt({
        creator: input.creator,
        title: 'Styles staged',
        detail: `${unique.length} custom styles are grouped and the first is active.`,
      });
      const first = runtimeRef.current.revisions.find(
        (revision) => revision.id === unique[0],
      );
      if (first && playbackRef.current)
        void startPlayback(currentTime, {
          buffer: first.buffer,
          analysis: first.analysis,
        });
      await afterPaint();
      return {
        ok: true,
        stateVersion: stateVersionRef.current,
        comparisonTakeIds: unique,
        summary:
          'The requested custom styles are grouped and the first is active.',
      };
    },
    [addReceipt, currentTime, markWebMCP, startPlayback],
  );

  const setTrimFadesCommand = useCallback(
    async (input: {
      expectedStateVersion: number;
      startSeconds: number;
      endSeconds: number;
      fadeInSeconds: number;
      fadeOutSeconds: number;
      fadeInCurve?: number;
      fadeOutCurve?: number;
      creator: Creator;
    }) => {
      if (input.creator === 'webmcp' && runtimeRef.current.agentPaused)
        return {
          ok: false,
          code: 'AGENT_PAUSED',
          message: 'ChatGPT control is paused in Champagne.',
        };
      if (input.expectedStateVersion !== stateVersionRef.current)
        return {
          ok: false,
          code: 'STALE_STATE',
          message: 'Call get_studio_state and retry.',
          currentStateVersion: stateVersionRef.current,
        };
      const duration = runtimeRef.current.track?.buffer.duration;
      if (!duration)
        return { ok: false, code: 'NO_TRACK', message: 'Load a track first.' };
      const start = clamp(input.startSeconds, 0, duration - 0.2);
      const end = clamp(input.endSeconds, start + 0.2, duration);
      if (
        ![
          start,
          end,
          input.fadeInSeconds,
          input.fadeOutSeconds,
          input.fadeInCurve ?? 0,
          input.fadeOutCurve ?? 0,
        ].every(Number.isFinite)
      )
        return {
          ok: false,
          code: 'INVALID_EDIT',
          message: 'Trim, fade, and curve values must be finite numbers.',
        };
      const selection = end - start;
      const next = {
        startSeconds: start,
        endSeconds: end,
        fadeInSeconds: clamp(input.fadeInSeconds, 0, selection * 0.45),
        fadeOutSeconds: clamp(input.fadeOutSeconds, 0, selection * 0.45),
        fadeInCurve: clamp(
          input.fadeInCurve ?? runtimeRef.current.trim.fadeInCurve,
          -1,
          1,
        ),
        fadeOutCurve: clamp(
          input.fadeOutCurve ?? runtimeRef.current.trim.fadeOutCurve,
          -1,
          1,
        ),
      };
      if (input.creator === 'webmcp') markWebMCP('Updating trim and fades');
      runtimeRef.current.trim = next;
      setTrim(next);
      const nextVersion = bumpStateVersion();
      addReceipt({
        creator: input.creator,
        title: 'Edit region updated',
        detail: `${formatTime(start)}–${formatTime(end)} · fades ${next.fadeInSeconds.toFixed(2)}s / ${next.fadeOutSeconds.toFixed(2)}s`,
      });
      await afterPaint();
      return {
        ok: true,
        stateVersion: nextVersion,
        trim: next,
        summary: 'Updated the non-destructive keep region and fades.',
      };
    },
    [addReceipt, bumpStateVersion, markWebMCP],
  );

  const setTrackSpeedCommand = useCallback(
    async (input: {
      expectedStateVersion: number;
      speedPercent: number;
      creator: Creator;
    }) => {
      if (input.creator === 'webmcp' && runtimeRef.current.agentPaused)
        return {
          ok: false,
          code: 'AGENT_PAUSED',
          message: 'ChatGPT control is paused in Champagne.',
        };
      if (input.expectedStateVersion !== stateVersionRef.current)
        return {
          ok: false,
          code: 'STALE_STATE',
          message: 'Call get_studio_state and retry.',
          currentStateVersion: stateVersionRef.current,
        };
      if (!runtimeRef.current.track)
        return { ok: false, code: 'NO_TRACK', message: 'Load a track first.' };
      if (
        !Number.isFinite(input.speedPercent) ||
        input.speedPercent < 50 ||
        input.speedPercent > 150
      )
        return {
          ok: false,
          code: 'INVALID_SPEED',
          message: 'Track speed must be a finite percentage from 50 to 150.',
        };
      const nextPercent = applyPlaybackSpeed(
        input.speedPercent,
        input.speedPercent !== 100,
      );
      committedSpeedRef.current = nextPercent;
      if (input.creator === 'webmcp')
        markWebMCP(`Setting track speed to ${nextPercent}%`);
      const nextVersion = bumpStateVersion();
      addReceipt({
        creator: input.creator,
        title: 'Track speed updated',
        detail: `${nextPercent}% · audible now and included in WAV export`,
      });
      await afterPaint();
      return {
        ok: true,
        stateVersion: nextVersion,
        speedPercent: nextPercent,
        summary: `Track speed is now ${nextPercent}%. The current master and edits were preserved.`,
      };
    },
    [addReceipt, applyPlaybackSpeed, bumpStateVersion, markWebMCP],
  );

  const downloadCurrent = useCallback(
    async (input: { creator: Creator; takeId?: string }) => {
      if (exportBusyRef.current)
        return {
          ok: false,
          code: 'EXPORT_BUSY',
          message: 'A WAV download is already being prepared.',
        };
      const sourceTrack = runtimeRef.current.track;
      if (!sourceTrack)
        return { ok: false, code: 'NO_TRACK', message: 'Load a track first.' };
      const revision = input.takeId
        ? runtimeRef.current.revisions.find(
            (candidate) => candidate.id === input.takeId,
          )
        : runtimeRef.current.revisions.find(
            (candidate) => candidate.id === runtimeRef.current.activeRevisionId,
          );
      if (input.takeId && !revision)
        return {
          ok: false,
          code: 'TAKE_NOT_FOUND',
          message: 'That mastering style is not available.',
        };
      const styleName = revision?.displayName ?? 'Original Edit';
      const selectedTakeId = revision?.id ?? null;
      const currentVersion = stateVersionRef.current;
      const prepared = preparedDownloadRef.current;
      const anchor = downloadAnchorRef.current;
      const requiresUserClick = input.creator !== 'manual';
      if (
        prepared &&
        anchor &&
        prepared.stateVersion === currentVersion &&
        prepared.takeId === selectedTakeId
      ) {
        anchor.href = prepared.url;
        anchor.download = prepared.fileName;
        if (!requiresUserClick) anchor.click();
        else setNotice('Your WAV is ready. Click Download WAV to save it.');
        addReceipt({
          creator: input.creator,
          title: requiresUserClick ? 'Download ready' : 'Download initiated',
          detail: `${styleName} · ${runtimeRef.current.speedPercent}% · 24-bit / 48 kHz WAV`,
          revisionId: revision?.id,
        });
        return {
          ok: true,
          downloadReady: true,
          downloadInitiated: !requiresUserClick,
          requiresUserClick,
          fileName: prepared.fileName,
          stateVersion: currentVersion,
          takeId: selectedTakeId,
          speedPercent: runtimeRef.current.speedPercent,
          summary: requiresUserClick
            ? `${styleName} is ready. The user must click Download WAV in the page header to save it.`
            : `${styleName} download initiated without remastering.`,
        };
      }
      exportBusyRef.current = true;
      setIsExporting(true);
      try {
        const blob = await encodeMasterWav24(
          revision?.buffer ?? sourceTrack.buffer,
          runtimeRef.current.trim,
          runtimeRef.current.speedPercent,
        );
        const url = URL.createObjectURL(blob);
        const fileName = safeDownloadName(sourceTrack.name, styleName);
        const previous = preparedDownloadRef.current;
        preparedDownloadRef.current = {
          url,
          fileName,
          stateVersion: currentVersion,
          takeId: selectedTakeId,
        };
        const persistentAnchor = downloadAnchorRef.current;
        if (!persistentAnchor) {
          URL.revokeObjectURL(url);
          preparedDownloadRef.current = previous;
          throw new Error('The local download control is unavailable.');
        }
        persistentAnchor.href = url;
        persistentAnchor.download = fileName;
        if (!requiresUserClick) persistentAnchor.click();
        else setNotice('Your WAV is ready. Click Download WAV to save it.');
        if (previous && previous.url !== url) {
          URL.revokeObjectURL(previous.url);
        }
        addReceipt({
          creator: input.creator,
          title: requiresUserClick ? 'Download ready' : 'Download initiated',
          detail: `${styleName} · ${runtimeRef.current.speedPercent}% · 24-bit / 48 kHz WAV`,
          revisionId: revision?.id,
        });
        return {
          ok: true,
          downloadReady: true,
          downloadInitiated: !requiresUserClick,
          requiresUserClick,
          fileName,
          stateVersion: currentVersion,
          takeId: selectedTakeId,
          speedPercent: runtimeRef.current.speedPercent,
          summary: requiresUserClick
            ? `${styleName} is ready. The user must click Download WAV in the page header to save it.`
            : `${styleName} download initiated without remastering.`,
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Champagne could not create the WAV download.';
        setNotice(message);
        return { ok: false, code: 'EXPORT_FAILED', message };
      } finally {
        exportBusyRef.current = false;
        setIsExporting(false);
      }
    },
    [addReceipt],
  );

  const downloadMasterCommand = useCallback(
    async (input: {
      expectedStateVersion?: number;
      takeId?: string;
      creator: Creator;
    }) => {
      if (input.creator === 'webmcp' && runtimeRef.current.agentPaused)
        return {
          ok: false,
          code: 'AGENT_PAUSED',
          message: 'ChatGPT control is paused in Champagne.',
        };
      if (input.creator === 'webmcp')
        markWebMCP('Preparing the current track for Download WAV');
      return downloadCurrent(input);
    },
    [downloadCurrent, markWebMCP],
  );

  const commitMasterCommand = useCallback(
    async (input: {
      expectedStateVersion: number;
      takeId: string;
      creator: Creator;
    }) => {
      if (input.creator === 'webmcp' && runtimeRef.current.agentPaused)
        return {
          ok: false,
          code: 'AGENT_PAUSED',
          message: 'ChatGPT control is paused in Champagne.',
        };
      if (input.expectedStateVersion !== stateVersionRef.current)
        return {
          ok: false,
          code: 'STALE_STATE',
          message: 'Call get_studio_state and retry.',
          currentStateVersion: stateVersionRef.current,
        };
      const revision = runtimeRef.current.revisions.find(
        (candidate) => candidate.id === input.takeId,
      );
      if (!revision)
        return {
          ok: false,
          code: 'TAKE_NOT_FOUND',
          message: 'That mastering style is not available.',
        };
      if (input.creator === 'webmcp')
        markWebMCP(`Selecting ${revision.displayName} for export`);
      setActiveRevisionId(revision.id);
      setMonitorMastered(true);
      setExportReadyId(revision.id);
      setPhase('export_ready');
      const nextVersion = bumpStateVersion();
      addReceipt({
        creator: input.creator,
        title: `${revision.displayName} selected`,
        detail: '24-bit / 48 kHz WAV is staged for the Download WAV button.',
        revisionId: revision.id,
      });
      if (playbackRef.current)
        void startPlayback(currentTime, {
          buffer: revision.buffer,
          analysis: revision.analysis,
        });
      await afterPaint();
      return {
        ok: true,
        stateVersion: nextVersion,
        takeId: revision.id,
        exportReady: true,
        summary: `${revision.displayName} is ready. The person can save it with the visible Download WAV button.`,
        nextActions: [],
      };
    },
    [addReceipt, bumpStateVersion, currentTime, markWebMCP, startPlayback],
  );

  const getStudioState = useCallback(() => {
    const snapshot = runtimeRef.current;
    if (!snapshot.track) {
      return {
        ok: true,
        stateVersion: stateVersionRef.current,
        status: 'empty',
        styleCount: 0,
        availableActions: ['load_track_in_ui'],
        privacy: { audioShared: false },
      };
    }
    return {
      ok: true,
      stateVersion: stateVersionRef.current,
      status: snapshot.phase,
      track: {
        durationSeconds: round(snapshot.track.analysis.durationSeconds, 2),
        sampleRate: snapshot.track.analysis.sampleRate,
        channels: snapshot.track.analysis.channels,
      },
      activeStyleId: snapshot.activeRevisionId,
      styles: snapshot.revisions.map((revision) => ({
        id: revision.id,
        name: revision.displayName,
        baseline: revision.style,
        parentId: revision.parentId,
      })),
      trim: snapshot.trim,
      speedPercent: snapshot.speedPercent,
      speedEnabled: snapshot.speedEnabled,
      availableActions: snapshot.revisions.length
        ? [
            'create_mastering_take',
            'refine_mastering_take',
            'create_variations',
            'stage_comparison',
            'set_trim_fades',
            'set_track_speed',
            'commit_master',
          ]
        : [
            'analyze_track',
            'create_mastering_take',
            'create_variations',
            'set_trim_fades',
            'set_track_speed',
          ],
      privacy: { audioShared: false, filenameShared: false },
    };
  }, []);

  const analyzeTrackCommand = useCallback(
    async (signal?: AbortSignal) => {
      if (signal?.aborted)
        return {
          ok: false,
          code: 'CANCELLED',
          message: 'Analysis request cancelled.',
        };
      const analysis = runtimeRef.current.track?.analysis;
      if (!analysis)
        return {
          ok: false,
          code: 'NO_TRACK',
          message: 'Load a track in Champagne first.',
        };
      markWebMCP('Reading the local track analysis');
      await afterPaint();
      return {
        ok: true,
        stateVersion: stateVersionRef.current,
        analysis: {
          durationSeconds: round(analysis.durationSeconds, 2),
          samplePeakDbfs: round(analysis.samplePeakDbfs, 2),
          rmsDbfs: round(analysis.rmsDbfs, 2),
          crestFactorDb: round(analysis.crestFactorDb, 2),
          headroomDb: round(analysis.headroomDb, 2),
        },
        flags: analysis.flags,
        audioShared: false,
        nextActions: [
          'create_mastering_take',
          'create_variations',
          'set_trim_fades',
          'set_track_speed',
        ],
      };
    },
    [markWebMCP],
  );

  apiRef.current = {
    getState: getStudioState,
    analyzeTrack: analyzeTrackCommand,
    createTake: (input) => createTakeCommand(input),
    refineTake: (input) => refineTakeCommand(input),
    createVariations: (input) => createVariationsCommand(input),
    stageComparison: (input) => stageComparisonCommand(input),
    setTrimFades: (input) => setTrimFadesCommand(input),
    setTrackSpeed: (input) => setTrackSpeedCommand(input),
    commitMaster: (input) => commitMasterCommand(input),
    downloadMaster: (input) => downloadMasterCommand(input),
  };

  useEffect(() => {
    let cleanup: () => void = () => undefined;
    let cancelled = false;
    void registerChampagneTools(apiRef, (available) => {
      if (!cancelled) {
        setWebmcpAvailable(available);
        setWebmcpResolved(true);
      }
    }).then((dispose) => {
      if (cancelled) dispose();
      else cleanup = dispose;
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    const prepared = preparedDownloadRef.current;
    if (!prepared || prepared.stateVersion === stateVersion) return;
    URL.revokeObjectURL(prepared.url);
    preparedDownloadRef.current = null;
    const anchor = downloadAnchorRef.current;
    if (anchor) {
      anchor.removeAttribute('href');
      anchor.removeAttribute('download');
    }
  }, [stateVersion]);

  useEffect(
    () => () => {
      const prepared = preparedDownloadRef.current;
      if (prepared) URL.revokeObjectURL(prepared.url);
    },
    [],
  );

  const selectRevision = useCallback(
    (id: string) => {
      const revision = runtimeRef.current.revisions.find(
        (candidate) => candidate.id === id,
      );
      if (!revision) return;
      setActiveRevisionId(id);
      setMonitorMastered(true);
      setExportReadyId(null);
      if (playbackRef.current)
        void startPlayback(currentTime, {
          buffer: revision.buffer,
          analysis: revision.analysis,
        });
    },
    [currentTime, startPlayback],
  );

  const selectSource = useCallback(
    (mastered: boolean) => {
      setMonitorMastered(mastered);
      const snapshot = runtimeRef.current;
      const selected =
        mastered && snapshot.activeRevisionId
          ? snapshot.revisions.find(
              (revision) => revision.id === snapshot.activeRevisionId,
            )
          : null;
      if (playbackRef.current && snapshot.track) {
        void startPlayback(
          currentTime,
          selected
            ? { buffer: selected.buffer, analysis: selected.analysis }
            : {
                buffer: snapshot.track.buffer,
                analysis: snapshot.track.analysis,
              },
        );
      }
    },
    [currentTime, startPlayback],
  );

  const handleTrimChange = useCallback((next: TrimSettings) => {
    setTrim(next);
    setExportReadyId(null);
  }, []);

  const commitManualTrim = useCallback(() => {
    bumpStateVersion();
    addReceipt({
      creator: 'manual',
      title: 'Edit region updated',
      detail: `${formatTime(trim.startSeconds)}–${formatTime(trim.endSeconds)} · local and reversible`,
    });
  }, [addReceipt, bumpStateVersion, trim]);

  const commitManualSpeed = useCallback(() => {
    if (committedSpeedRef.current === runtimeRef.current.speedPercent) return;
    committedSpeedRef.current = runtimeRef.current.speedPercent;
    bumpStateVersion();
    addReceipt({
      creator: 'manual',
      title: 'Track speed updated',
      detail: `${runtimeRef.current.speedPercent}% · audible now and included in WAV export`,
    });
  }, [addReceipt, bumpStateVersion]);

  const submitBrief = useCallback(async () => {
    const value = brief.trim();
    if (!track || !value || renderBusyRef.current) return;
    const actions = interpretStudioPrompt(value);
    setNotice(null);
    let masteringResult: unknown = { ok: true };
    if (actions.shouldMaster) {
      const interpreted = interpretBrief(
        actions.masteringText || value,
        Boolean(runtimeRef.current.activeRevisionId),
      );
      setIntentDisplay(interpreted);
      addReceipt({
        creator: 'brief',
        title: 'Direction understood',
        detail:
          interpreted.mode === 'variations'
            ? 'Three contrasting directions'
            : `${interpreted.customName} · ${STYLE_RECIPES[interpreted.style].name} baseline`,
      });
      const expectedStateVersion = stateVersionRef.current;
      if (interpreted.mode === 'variations') {
        masteringResult = await createVariationsCommand({
          expectedStateVersion,
          styles: interpreted.styles ?? [
            'warm_presence',
            'modern_crisp',
            'dominant',
          ],
          constraint: interpreted.constraints.includes('preserve transients')
            ? 'preserve_transients'
            : interpreted.constraints.includes('keep dynamic')
              ? 'keep_dynamic'
              : interpreted.constraints.includes('avoid harshness')
                ? 'avoid_harshness'
                : 'none',
          creator: 'brief',
          prompt: value,
        });
      } else if (
        interpreted.mode === 'refine' &&
        interpreted.refinement &&
        runtimeRef.current.activeRevisionId
      ) {
        const source = runtimeRef.current.revisions.find(
          (revision) => revision.id === runtimeRef.current.activeRevisionId,
        );
        if (source) {
          const mergedModifiers = { ...source.intent.modifiers };
          for (const key of Object.keys(mergedModifiers) as Array<
            keyof MasteringModifiers
          >) {
            mergedModifiers[key] = clamp(
              mergedModifiers[key] + interpreted.modifiers[key],
              -1,
              1,
            );
          }
          masteringResult = await createTakeCommand({
            expectedStateVersion,
            baseStyle: source.style,
            priorities: [
              ...new Set([
                ...source.intent.priorities,
                ...interpreted.priorities,
              ]),
            ],
            constraints: [
              ...new Set([
                ...source.intent.constraints,
                ...interpreted.constraints,
              ]),
            ],
            modifiers: mergedModifiers,
            customName: `${source.displayName} · ${interpreted.refinement.label}`,
            matchedDirections: [
              ...new Set([
                ...source.intent.matchedDirections,
                ...interpreted.matchedDirections,
              ]),
            ],
            parentId: source.id,
            creator: 'brief',
            prompt: value,
          });
        }
      } else {
        masteringResult = await createTakeCommand({
          expectedStateVersion,
          baseStyle: interpreted.style,
          priorities: interpreted.priorities,
          constraints: interpreted.constraints,
          modifiers: interpreted.modifiers,
          customName: interpreted.customName,
          matchedDirections: interpreted.matchedDirections,
          creator: 'brief',
          prompt: value,
        });
      }
    }

    if (
      typeof masteringResult === 'object' &&
      masteringResult !== null &&
      'ok' in masteringResult &&
      masteringResult.ok === false
    ) {
      setBrief('');
      return;
    }

    const hasEdits = Object.values(actions.edits).some((edit) => edit != null);
    if (hasEdits && runtimeRef.current.track) {
      const currentTrim = runtimeRef.current.trim;
      const duration = runtimeRef.current.track.buffer.duration;
      await setTrimFadesCommand({
        expectedStateVersion: stateVersionRef.current,
        startSeconds: actions.edits.cutStartSeconds ?? currentTrim.startSeconds,
        endSeconds:
          actions.edits.cutEndSeconds != null
            ? duration - actions.edits.cutEndSeconds
            : currentTrim.endSeconds,
        fadeInSeconds: actions.edits.fadeInSeconds ?? currentTrim.fadeInSeconds,
        fadeOutSeconds:
          actions.edits.fadeOutSeconds ?? currentTrim.fadeOutSeconds,
        fadeInCurve: currentTrim.fadeInCurve,
        fadeOutCurve: currentTrim.fadeOutCurve,
        creator: 'brief',
      });
    }
    if (actions.speedPercent != null) {
      await setTrackSpeedCommand({
        expectedStateVersion: stateVersionRef.current,
        speedPercent: actions.speedPercent,
        creator: 'brief',
      });
    }
    if (actions.shouldDownload) {
      await downloadMasterCommand({
        expectedStateVersion: stateVersionRef.current,
        creator: 'brief',
      });
    }
    setBrief('');
  }, [
    addReceipt,
    brief,
    createTakeCommand,
    createVariationsCommand,
    downloadMasterCommand,
    setTrackSpeedCommand,
    setTrimFadesCommand,
    track,
  ]);

  const handleStyle = useCallback(
    (style: StyleId) => {
      const existing = [...runtimeRef.current.revisions]
        .reverse()
        .find(
          (revision) =>
            revision.creator === 'manual' &&
            revision.style === style &&
            revision.displayName === STYLE_RECIPES[style].name,
        );
      if (existing) {
        selectRevision(existing.id);
        return;
      }
      void createTakeCommand({
        expectedStateVersion: stateVersionRef.current,
        baseStyle: style,
        priorities:
          style === 'dominant'
            ? ['loudness', 'punch']
            : style === 'warm_presence'
              ? ['warmth']
              : style === 'modern_crisp'
                ? ['clarity']
                : ['punch', 'loudness'],
        constraints: [],
        creator: 'manual',
        prompt: `Selected ${STYLE_RECIPES[style].name}`,
      });
    },
    [createTakeCommand, selectRevision],
  );

  const returnHome = useCallback(() => {
    loadRequestRef.current += 1;
    stopPlayback(false);
    void runViewTransition(() => {
      setTrack(null);
      setPhase('empty');
      setRevisions([]);
      setActiveRevisionId(null);
      setMonitorMastered(false);
      setComparisonIds([]);
      setExportReadyId(null);
      setCurrentTime(0);
      setSpeedPercent(100);
      setSpeedEnabled(false);
      committedSpeedRef.current = 100;
      runtimeRef.current.speedPercent = 100;
      runtimeRef.current.speedEnabled = false;
      setBrief('');
      setIntentDisplay(null);
      setNotice(null);
      setActivity([]);
      setTrim({
        startSeconds: 0,
        endSeconds: 0,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        fadeInCurve: 1 / 3,
        fadeOutCurve: 1 / 3,
      });
      bumpStateVersion();
    });
  }, [bumpStateVersion, stopPlayback]);

  const handleDownload = useCallback(async () => {
    await downloadCurrent({ creator: 'manual' });
  }, [downloadCurrent]);

  const agentPayload = useMemo(
    () => ({
      project: track
        ? {
            status: phase,
            stateVersion,
            durationSeconds: round(track.analysis.durationSeconds, 2),
            activeStyleId: activeRevisionId,
            styleCount: revisions.length,
          }
        : { status: 'empty', stateVersion },
      analysis: track
        ? {
            samplePeakDbfs: round(track.analysis.samplePeakDbfs, 2),
            rmsDbfs: round(track.analysis.rmsDbfs, 2),
            crestFactorDb: round(track.analysis.crestFactorDb, 2),
            flags: track.analysis.flags,
          }
        : null,
      edits: track ? { trim, speedPercent, speedEnabled } : null,
      capabilities: {
        styles: STYLE_IDS,
        actions: [
          'analyze',
          'create style',
          'refine',
          'compare',
          'trim/fades',
          'speed',
          'stage export',
        ],
      },
      excluded: ['audio bytes', 'waveform samples', 'filename', 'local path'],
    }),
    [
      activeRevisionId,
      phase,
      revisions.length,
      speedEnabled,
      speedPercent,
      stateVersion,
      track,
      trim,
    ],
  );

  const connectionLabel = !webmcpAvailable
    ? 'Use ChatGPT'
    : agentPaused
      ? 'ChatGPT paused'
      : webmcpInvoked
        ? 'ChatGPT directing'
        : 'Site tools ready';

  return (
    <main
      className="champagne-shell min-h-screen overflow-hidden text-foreground"
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDropTargeted(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDropTargeted(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDropTargeted(false);
        const file = event.dataTransfer.files[0];
        if (file) void loadFile(file);
      }}
    >
      <div className="ambient ambient-violet" />
      <div className="ambient ambient-gold" />

      <div key={studioView} className={`studio-view studio-view-${studioView}`}>
        {!isLoadingView && (
          <header className="studio-header">
            <button
              className="brand-cluster"
              type="button"
              onClick={returnHome}
              aria-label="Go to Champagne home"
            >
              <span className="brand-mark" aria-hidden="true" />
              <span>
                <span className="brand-wordmark">CHAMPAGNE</span>
                <span className="brand-subtitle">MASTERING STUDIO</span>
              </span>
            </button>

            <button
              className={`header-site-tools ${webmcpInvoked && !agentPaused ? 'is-live' : ''}`}
              type="button"
              onClick={() => setAgentPanelOpen(true)}
            >
              <Cable />
              <span>{connectionLabel}</span>
              <span className="connection-dot" />
            </button>

            <div className="header-actions">
              {track && (
                <Button
                  className="subtle-button header-new-track"
                  variant="outline"
                  size="lg"
                  onClick={returnHome}
                >
                  <Plus /> New track
                </Button>
              )}
              {track && (
                <Button
                  className="export-button"
                  size="lg"
                  disabled={isExporting}
                  onClick={() => void handleDownload()}
                >
                  <Download />
                  <span className="hidden sm:inline">
                    {isExporting ? 'Preparing WAV…' : 'Download WAV'}
                  </span>
                  <span className="sm:hidden">Download</span>
                </Button>
              )}
            </div>
          </header>
        )}

        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept="audio/*,.wav,.wave,.aiff,.aif,.mp3,.m4a,.flac,.caf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadFile(file);
            event.currentTarget.value = '';
          }}
        />
        <a
          ref={downloadAnchorRef}
          className="sr-only"
          href="#download"
          download
          aria-hidden="true"
          tabIndex={-1}
        >
          Prepared Champagne download
        </a>

        {isLoadingView ? (
          <section className="simple-loading" aria-label="Processing audio">
            <span className="simple-loading-bar" aria-hidden="true">
              <i />
            </span>
            <progress className="sr-only" aria-label="Processing audio" />
          </section>
        ) : !track ? (
          <section className="empty-studio">
            <div
              className={`empty-drop surface ${isDropTargeted ? 'is-targeted' : ''}`}
            >
              <h1>Your sound just leveled up.</h1>
              <p className="empty-copy">
                ChatGPT guides the physics behind Champagne&apos;s mastering
                engine. Clock every take, compare original and mastered
                versions, then download your masterpiece.
              </p>
              <p className="chatgpt-start-copy">
                Open Champagne in the ChatGPT app web browser to get started.
              </p>
              <div className="empty-actions">
                <Button
                  className="gold-primary"
                  size="lg"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Music2 /> Select Audio
                </Button>
                <Button
                  className="demo-button"
                  variant="outline"
                  size="lg"
                  onClick={() => void loadDemo()}
                >
                  <Play /> Demo
                </Button>
              </div>
              <p className="format-copy">WAV · AIFF · MP3 · M4A · FLAC</p>
            </div>
            {notice && (
              <div className="notice-banner">
                <Info />
                {notice}
                <button onClick={() => setNotice(null)} aria-label="Dismiss">
                  <X />
                </button>
              </div>
            )}
          </section>
        ) : (
          <div className="studio-layout">
            <section className="studio-main">
              <div className="surface waveform-surface">
                <div className="track-bar">
                  <div className="track-identity">
                    <span className="track-check">
                      <Check />
                    </span>
                    <span className="min-w-0">
                      <strong>{track.name}</strong>
                    </span>
                  </div>
                  {track.demoIndex != null && (
                    <div className="demo-switch" aria-label="Switch Demo Track">
                      <span>Switch Demo Track</span>
                      <button
                        type="button"
                        aria-label="Previous demo track"
                        onClick={() => void loadDemo(track.demoIndex! - 1)}
                      >
                        <ChevronLeft />
                      </button>
                      <button
                        type="button"
                        aria-label="Next demo track"
                        onClick={() => void loadDemo(track.demoIndex! + 1)}
                      >
                        <ChevronRight />
                      </button>
                    </div>
                  )}
                </div>

                <div className="waveform-workspace">
                  <div className="waveform-meta">
                    <div>
                      <span
                        className={`source-label ${monitorMastered ? 'is-mastered' : ''}`}
                      >
                        {monitorMastered && activeRevision
                          ? activeRevision.displayName.toUpperCase()
                          : 'ORIGINAL'}
                      </span>
                      {activeRevision?.creator === 'webmcp' && (
                        <Badge className="agent-origin" variant="outline">
                          <Bot /> ChatGPT
                        </Badge>
                      )}
                    </div>
                    <span className="timecode">
                      {formatTime(
                        (currentTime - trim.startSeconds) /
                          (speedPercent / 100),
                      )}{' '}
                      <i>/</i>{' '}
                      {formatTime(
                        (trim.endSeconds - trim.startSeconds) /
                          (speedPercent / 100),
                      )}
                    </span>
                  </div>

                  <div className="waveform-frame">
                    <WaveformEditor
                      waveform={activeWaveform}
                      duration={track.buffer.duration}
                      currentTime={currentTime}
                      trim={trim}
                      mastered={monitorMastered && Boolean(activeRevision)}
                      onSeek={seekTo}
                      onTrimChange={handleTrimChange}
                      onEditCommit={commitManualTrim}
                    />
                  </div>

                  <div className="transport-row">
                    <div className="source-switch">
                      <button
                        className={!monitorMastered ? 'is-active' : ''}
                        type="button"
                        onClick={() => selectSource(false)}
                      >
                        <AudioWaveform /> Original
                      </button>
                      <button
                        className={monitorMastered ? 'is-active' : ''}
                        type="button"
                        disabled={!activeRevision}
                        onClick={() => selectSource(true)}
                      >
                        <Sparkles /> Mastered
                      </button>
                    </div>
                    <button
                      className="play-button"
                      type="button"
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                      onClick={() =>
                        playbackRef.current
                          ? stopPlayback()
                          : void startPlayback()
                      }
                    >
                      {isPlaying ? (
                        <Pause className="fill-current" />
                      ) : (
                        <Play className="fill-current" />
                      )}
                    </button>
                    <div className="transport-options">
                      <div className="speed-control">
                        <div className="speed-control-head">
                          <span>Track Speed</span>
                        </div>
                        <strong className="speed-value">{speedPercent}%</strong>
                        <div className="speed-slider-wrap">
                          <Slider
                            aria-label="Track speed percentage"
                            min={50}
                            max={150}
                            step={1}
                            value={[speedPercent]}
                            onValueChange={(values) =>
                              applyPlaybackSpeed(
                                typeof values === 'number'
                                  ? values
                                  : (values[0] ?? 100),
                                true,
                              )
                            }
                            onValueCommitted={() => commitManualSpeed()}
                          />
                          <span className="speed-center" aria-hidden="true" />
                        </div>
                      </div>
                    </div>
                  </div>
                  {manualMode && (
                    <div className="track-style-controls transport-style-controls">
                      <fieldset
                        className="track-style-picker"
                        aria-label="Signature mastering styles"
                      >
                        <legend className="sr-only">Signature styles</legend>
                        {STYLE_IDS.map((style) => {
                          const recipe = STYLE_RECIPES[style];
                          const Icon = styleIcons[style];
                          const readyRevision = [...revisions]
                            .reverse()
                            .find(
                              (revision) =>
                                revision.creator === 'manual' &&
                                revision.style === style &&
                                revision.displayName === recipe.name,
                            );
                          const selected =
                            activeRevision?.id === readyRevision?.id &&
                            monitorMastered;
                          return (
                            <button
                              className={`track-style-button ${selected ? 'is-selected' : ''}`}
                              key={style}
                              type="button"
                              aria-pressed={selected}
                              aria-label={`Use ${recipe.name}`}
                              disabled={isStudioBusy}
                              onClick={() => handleStyle(style)}
                            >
                              <span>
                                <Icon />
                              </span>
                              <strong>{recipe.name}</strong>
                            </button>
                          );
                        })}
                      </fieldset>
                    </div>
                  )}
                </div>
              </div>

              <div
                className={`surface brief-surface ${webmcpAvailable ? 'is-chatgpt' : ''}`}
              >
                <div
                  className={`brief-header ${webmcpAvailable ? 'is-chatgpt' : ''}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="brief-icon">
                      <WandSparkles />
                    </span>
                    {!webmcpAvailable && (
                      <span>
                        <strong>Mastering Magic</strong>
                      </span>
                    )}
                  </div>
                  <div className="brief-header-tools">
                    {isStudioBusy && (
                      <output
                        className="studio-busy-indicator"
                        aria-live="polite"
                      >
                        <i aria-hidden="true" />
                        Loading...
                      </output>
                    )}
                    <Dialog>
                      <DialogTrigger
                        render={
                          <button
                            className="mastering-info-button"
                            type="button"
                            aria-label="How Champagne Works with WebMCP"
                          />
                        }
                      >
                        <Info />
                      </DialogTrigger>
                      <DialogContent className="mastering-info-dialog sm:max-w-[560px]">
                        <DialogHeader>
                          <DialogTitle>
                            How Champagne Works with WebMCP
                          </DialogTitle>
                          <DialogDescription>
                            Four proven mastering styles give every request a
                            safe baseline.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="mastering-info-copy">
                          <p>
                            ChatGPT reads your direction, chooses the closest
                            signature, then applies bounded refinements across
                            tone, punch, dynamics, width, density, and
                            smoothness.
                          </p>
                          <p className="mastering-info-close">
                            <strong>
                              Every song needs a slightly different touch.
                            </strong>{' '}
                            That&apos;s where ChatGPT makes the difference.
                          </p>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>

                {webmcpAvailable ? (
                  <div
                    className="chatgpt-prompt-ideas"
                    aria-label="Prompt ideas for ChatGPT"
                  >
                    <h2>Ask ChatGPT</h2>
                    <div className="chatgpt-prompt-content">
                      <p>
                        <span key={suggestionIndex}>
                          {PROMPT_SUGGESTIONS[suggestionIndex]}
                        </span>
                      </p>
                      <button
                        type="button"
                        className="copy-suggestion-button"
                        onClick={() => void copyCurrentSuggestion()}
                      >
                        {copiedSuggestionIndex === suggestionIndex ? (
                          <Check aria-hidden="true" />
                        ) : (
                          <Copy aria-hidden="true" />
                        )}
                        <span aria-live="polite">
                          {copiedSuggestionIndex === suggestionIndex
                            ? 'Copied'
                            : 'Copy prompt'}
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="composer">
                    <div className="composer-field" ref={composerFieldRef}>
                      {!brief && (
                        <div
                          className="composer-suggestion"
                          key={suggestionIndex}
                          aria-hidden="true"
                        >
                          <span ref={composerSuggestionTextRef}>
                            {PROMPT_SUGGESTIONS[suggestionIndex]}
                          </span>
                        </div>
                      )}
                      <Textarea
                        data-empty={!brief}
                        value={brief}
                        onChange={(event) => setBrief(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            void submitBrief();
                          }
                        }}
                        className="min-h-[76px] resize-none border-0 bg-transparent px-10 py-5 text-center font-sans text-[18px] leading-7 shadow-none focus-visible:ring-0"
                        placeholder=""
                        aria-label="Mastering Magic"
                      />
                    </div>
                    <Button
                      className="send-button"
                      size="icon"
                      aria-label="Create local preview"
                      disabled={!brief.trim() || isStudioBusy}
                      onClick={() => void submitBrief()}
                    >
                      <ArrowUp />
                    </Button>
                  </div>
                )}
              </div>

              {notice && (
                <div className="notice-banner">
                  <Info />
                  {notice}
                  <button onClick={() => setNotice(null)} aria-label="Dismiss">
                    <X />
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      <Sheet open={agentPanelOpen} onOpenChange={setAgentPanelOpen}>
        <SheetContent className="agent-sheet w-[min(660px,94vw)] border-white/10 bg-[#101015]/98 sm:max-w-[660px]">
          <SheetHeader className="border-b border-white/[0.07] px-6 py-5">
            <div className="mb-3 flex items-center gap-3">
              <span
                className={`sheet-agent-icon ${webmcpInvoked && !agentPaused ? 'is-live' : ''}`}
              >
                <Bot />
              </span>
              <div>
                <SheetTitle className="text-[16px]">
                  Control with ChatGPT
                </SheetTitle>
                <SheetDescription className="mt-0.5 text-xs">
                  You and agent work together to create magic.
                </SheetDescription>
              </div>
            </div>
            <div
              className={`sheet-connection ${webmcpAvailable ? 'is-ready' : ''}`}
            >
              <span className="connection-dot" />
              <span>
                <strong>{connectionLabel}</strong>
                <small>
                  {webmcpAvailable
                    ? 'Champagne actions are registered on this top-level page.'
                    : 'Site tools are unavailable in this browser. Manual controls remain available.'}
                </small>
              </span>
            </div>
          </SheetHeader>
          <div className="agent-sheet-scroll">
            <section className="sheet-section">
              <div className="sheet-section-heading">
                <span>SESSION CONTROL</span>
                <Switch
                  checked={!agentPaused}
                  onCheckedChange={(checked) => setAgentPaused(!checked)}
                />
              </div>
              <p>
                Allow ChatGPT to analyze, create custom styles, refine the
                selected style, compare options, and control trim, fades, speed,
                and the final mastering direction.
              </p>
            </section>
            <section className="sheet-section">
              <div className="sheet-section-heading">
                <span>TRY THIS IN CHATGPT</span>
                <Cable />
              </div>
              <blockquote>
                Create a vibrant, electric, and powerful master. Trim the first
                and last second, fade both ends for two seconds, and increase
                track speed by 10%.
              </blockquote>
              <ol>
                <li>
                  <b>1</b>
                  <span>Load a track here. Audio stays local.</span>
                </li>
                <li>
                  <b>2</b>
                  <span>Ask ChatGPT from beside this page.</span>
                </li>
                <li>
                  <b>3</b>
                  <span>Hear the magic 🪄</span>
                </li>
                <li>
                  <b>4</b>
                  <span>Click Download WAV when you are ready to save.</span>
                </li>
              </ol>
            </section>
            <section className="sheet-section">
              <div className="sheet-section-heading">
                <span>WHAT CHATGPT CAN SEE</span>
                <Eye />
              </div>
              <pre>{JSON.stringify(agentPayload, null, 2)}</pre>
              <div className="privacy-proof">
                <ShieldCheck />
                <span>
                  <strong>Audio bytes are excluded by design.</strong>
                  <small>
                    No PCM, blobs, waveform arrays, filename, or local path
                    enters a tool result.
                  </small>
                </span>
              </div>
            </section>
            <section className="sheet-section">
              <div className="sheet-section-heading">
                <span>AVAILABLE ACTIONS</span>
                <Activity />
              </div>
              <div className="tool-list">
                {[
                  'Read studio state',
                  'Analyze track locally',
                  'Create a custom style',
                  'Refine a style',
                  'Create three directions',
                  'Stage style options',
                  'Set trim and fades',
                  'Set track speed',
                  'Select final master',
                ].map((tool) => (
                  <span key={tool}>
                    <Check />
                    {tool}
                  </span>
                ))}
              </div>
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
