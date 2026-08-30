'use client';

import {
  Activity,
  ArrowDownToLine,
  ArrowUp,
  AudioWaveform,
  Bot,
  Bolt,
  Cable,
  Check,
  ChevronRight,
  Diamond,
  Download,
  Eye,
  Flame,
  GitBranch,
  Headphones,
  Info,
  Loader2,
  LockKeyhole,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  WandSparkles,
  WifiOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { WaveformEditor } from '@/components/waveform-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  analyzeAudioBuffer,
  createDemoTrack,
  decodeAudioFile,
  encodeMasterWav24,
  makeWaveform,
  renderMasteringTake,
} from '@/lib/audio-engine';
import {
  clamp,
  dbToGain,
  DEFAULT_MODIFIERS,
  formatTime,
  interpretBrief,
  makeId,
  makePlanHash,
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
}

interface PlaybackRuntime {
  context: AudioContext;
  source: AudioBufferSourceNode;
  gain: GainNode;
  offset: number;
  startedAt: number;
  baseGain: number;
}

const styleIcons = {
  full_power: Bolt,
  warm_presence: Flame,
  modern_crisp: Diamond,
  dominant: Activity,
} satisfies Record<StyleId, typeof Bolt>;

const afterPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function safeDownloadName(name: string, style: StyleId): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'track';
  return `${base}_champagne_${style}.wav`;
}

export function ChampagneStudio() {
  const [track, setTrack] = useState<TrackRuntime | null>(null);
  const [phase, setPhase] = useState<StudioPhase>('empty');
  const [revisions, setRevisions] = useState<MasterRevision[]>([]);
  const [activeRevisionId, setActiveRevisionId] = useState<string | null>(null);
  const [monitorMastered, setMonitorMastered] = useState(true);
  const [trim, setTrim] = useState<TrimSettings>({ startSeconds: 0, endSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0 });
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [brief, setBrief] = useState('');
  const [intentDisplay, setIntentDisplay] = useState<InterpretedBrief | null>(null);
  const [activity, setActivity] = useState<ActivityReceipt[]>([]);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStatus, setRenderStatus] = useState('');
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [loudnessMatched, setLoudnessMatched] = useState(true);
  const [stateVersion, setStateVersion] = useState(0);
  const [webmcpAvailable, setWebmcpAvailable] = useState(false);
  const [webmcpInvoked, setWebmcpInvoked] = useState(false);
  const [agentPaused, setAgentPaused] = useState(false);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [exportReadyId, setExportReadyId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isDropTargeted, setIsDropTargeted] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackRef = useRef<PlaybackRuntime | null>(null);
  const renderBusyRef = useRef(false);
  const stateVersionRef = useRef(0);
  const apiRef = useRef<StudioCommandApi | null>(null);
  const runtimeRef = useRef({
    track,
    phase,
    revisions,
    activeRevisionId,
    monitorMastered,
    trim,
    comparisonIds,
    loudnessMatched,
    agentPaused,
  });
  runtimeRef.current = {
    track,
    phase,
    revisions,
    activeRevisionId,
    monitorMastered,
    trim,
    comparisonIds,
    loudnessMatched,
    agentPaused,
  };

  const activeRevision = revisions.find((revision) => revision.id === activeRevisionId) ?? null;
  const activeWaveform = monitorMastered && activeRevision ? activeRevision.waveform : track?.waveform ?? [];

  const bumpStateVersion = useCallback(() => {
    const next = stateVersionRef.current + 1;
    stateVersionRef.current = next;
    setStateVersion(next);
    return next;
  }, []);

  const addReceipt = useCallback((receipt: Omit<ActivityReceipt, 'id' | 'time'>) => {
    setActivity((current) => [{ ...receipt, id: makeId('receipt'), time: Date.now() }, ...current].slice(0, 24));
  }, []);

  const stopPlayback = useCallback((preserveTime = true) => {
    const playback = playbackRef.current;
    if (playback) {
      if (preserveTime) {
        const elapsed = playback.context.currentTime - playback.startedAt;
        setCurrentTime(clamp(playback.offset + elapsed, 0, runtimeRef.current.track?.buffer.duration ?? 0));
      }
      const now = playback.context.currentTime;
      playback.gain.gain.cancelScheduledValues(now);
      playback.gain.gain.setValueAtTime(playback.gain.gain.value, now);
      playback.gain.gain.linearRampToValueAtTime(0, now + 0.012);
      try { playback.source.stop(now + 0.014); } catch { /* Source may have ended. */ }
    }
    playbackRef.current = null;
    setIsPlaying(false);
  }, []);

  const monitorGainFor = useCallback((analysis: AudioAnalysis) => {
    if (!runtimeRef.current.loudnessMatched || runtimeRef.current.comparisonIds.length < 2) return 1;
    return dbToGain(clamp(-18 - analysis.rmsDbfs, -6, 6));
  }, []);

  const getMonitoredSource = useCallback(() => {
    const snapshot = runtimeRef.current;
    if (!snapshot.track) return null;
    if (snapshot.monitorMastered && snapshot.activeRevisionId) {
      const revision = snapshot.revisions.find((candidate) => candidate.id === snapshot.activeRevisionId);
      if (revision) return { buffer: revision.buffer, analysis: revision.analysis };
    }
    return { buffer: snapshot.track.buffer, analysis: snapshot.track.analysis };
  }, []);

  const startPlayback = useCallback(async (offset = currentTime, sourceOverride?: { buffer: AudioBuffer; analysis: AudioAnalysis }) => {
    const monitored = sourceOverride ?? getMonitoredSource();
    if (!monitored) return;
    const AudioContextConstructor = window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
      try { old.source.stop(now + 0.014); } catch { /* Ignore already-ended nodes. */ }
    }

    const source = context.createBufferSource();
    source.buffer = monitored.buffer;
    const gain = context.createGain();
    const baseGain = monitorGainFor(monitored.analysis);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(baseGain, now + 0.012);
    source.connect(gain);
    gain.connect(context.destination);
    const { trim: liveTrim } = runtimeRef.current;
    const safeOffset = clamp(offset < liveTrim.startSeconds || offset >= liveTrim.endSeconds ? liveTrim.startSeconds : offset, 0, Math.max(0, monitored.buffer.duration - 0.01));
    source.start(now, safeOffset);
    playbackRef.current = { context, source, gain, offset: safeOffset, startedAt: now, baseGain };
    setCurrentTime(safeOffset);
    setIsPlaying(true);
  }, [currentTime, getMonitoredSource, monitorGainFor]);

  const seekTo = useCallback((seconds: number) => {
    const next = clamp(seconds, runtimeRef.current.trim.startSeconds, runtimeRef.current.trim.endSeconds);
    setCurrentTime(next);
    if (playbackRef.current) void startPlayback(next);
  }, [startPlayback]);

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    const update = () => {
      const playback = playbackRef.current;
      if (!playback) return;
      const now = playback.offset + playback.context.currentTime - playback.startedAt;
      const liveTrim = runtimeRef.current.trim;
      if (now >= liveTrim.endSeconds - 0.012) {
        setCurrentTime(liveTrim.endSeconds);
        stopPlayback(false);
        return;
      }
      let fade = 1;
      if (liveTrim.fadeInSeconds > 0.001 && now < liveTrim.startSeconds + liveTrim.fadeInSeconds) {
        const x = clamp((now - liveTrim.startSeconds) / liveTrim.fadeInSeconds, 0, 1);
        fade = (x * (4 - x)) / 3;
      } else if (liveTrim.fadeOutSeconds > 0.001 && now > liveTrim.endSeconds - liveTrim.fadeOutSeconds) {
        const x = clamp((liveTrim.endSeconds - now) / liveTrim.fadeOutSeconds, 0, 1);
        fade = (x * (4 - x)) / 3;
      }
      playback.gain.gain.setTargetAtTime(playback.baseGain * fade, playback.context.currentTime, 0.006);
      setCurrentTime(now);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, stopPlayback]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      if (!runtimeRef.current.track) return;
      if (playbackRef.current) stopPlayback();
      else void startPlayback();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [startPlayback, stopPlayback]);

  useEffect(() => () => {
    stopPlayback(false);
    void audioContextRef.current?.close();
  }, [stopPlayback]);

  const markWebMCP = useCallback((action: string) => {
    setWebmcpInvoked(true);
    addReceipt({ creator: 'webmcp', title: 'ChatGPT action received', detail: action });
  }, [addReceipt]);

  const validateMutation = useCallback((expected: number, creator: Creator) => {
    if (creator === 'webmcp' && runtimeRef.current.agentPaused) {
      return { ok: false as const, code: 'AGENT_PAUSED', message: 'ChatGPT control is paused in Champagne.' };
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
    if (!runtimeRef.current.track) return { ok: false as const, code: 'NO_TRACK', message: 'Load a track in Champagne first.' };
    if (renderBusyRef.current) return { ok: false as const, code: 'RENDER_BUSY', message: 'A local preview render is already in progress.' };
    return null;
  }, []);

  const loadDecodedTrack = useCallback(async (name: string, sourceKey: string, buffer: AudioBuffer) => {
    stopPlayback(false);
    setPhase('analyzing');
    setRenderStatus('Reading the signal');
    setRenderProgress(18);
    setNotice(null);
    setRevisions([]);
    setActiveRevisionId(null);
    setComparisonIds([]);
    setExportReadyId(null);
    setCurrentTime(0);
    setMonitorMastered(false);
    await afterPaint();

    const analysis = analyzeAudioBuffer(buffer);
    const waveform = makeWaveform(buffer);
    const loaded: TrackRuntime = { name, sourceKey, buffer, waveform, analysis };
    setTrack(loaded);
    setTrim({ startSeconds: 0, endSeconds: buffer.duration, fadeInSeconds: 0, fadeOutSeconds: 0 });
    setRenderProgress(100);
    setRenderStatus('Ready for direction');
    setPhase('ready');
    bumpStateVersion();
    addReceipt({ creator: 'manual', title: 'Track analyzed locally', detail: `${formatTime(buffer.duration)} · ${Math.round(buffer.sampleRate / 100) / 10} kHz · ${buffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}` });
    await afterPaint();
  }, [addReceipt, bumpStateVersion, stopPlayback]);

  const loadFile = useCallback(async (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['wav', 'wave', 'aiff', 'aif', 'mp3', 'm4a', 'flac', 'caf'].includes(extension ?? '') && !file.type.startsWith('audio/')) {
      setNotice('That file does not look like a supported audio format. Try WAV, AIFF, MP3, M4A, or FLAC.');
      return;
    }
    try {
      setPhase('analyzing');
      setRenderStatus('Decoding locally');
      setRenderProgress(8);
      const buffer = await decodeAudioFile(file);
      await loadDecodedTrack(file.name, `${file.size}-${file.lastModified}`, buffer);
    } catch (error) {
      setPhase('empty');
      setTrack(null);
      setNotice(error instanceof Error ? `Champagne could not decode this file: ${error.message}` : 'Champagne could not decode this file.');
    }
  }, [loadDecodedTrack]);

  const loadDemo = useCallback(async () => {
    const buffer = createDemoTrack();
    await loadDecodedTrack('Champagne Demo Loop.wav', 'champagne-demo-loop-v1', buffer);
  }, [loadDecodedTrack]);

  const makeModifiers = (input: { intensity?: number; priorities: string[]; constraints: string[] }) => {
    const modifiers = { ...DEFAULT_MODIFIERS, intensity: clamp(input.intensity ?? 0, -1, 1) };
    if (input.priorities.includes('punch')) modifiers.punch = 0.3;
    if (input.priorities.includes('warmth')) modifiers.warmth = 0.25;
    if (input.priorities.includes('clarity')) modifiers.brightness = 0.2;
    if (input.priorities.includes('dynamic_range')) modifiers.dynamics = 0.45;
    if (input.constraints.some((constraint) => constraint.includes('preserve_transients'))) modifiers.punch = Math.max(0.35, modifiers.punch);
    if (input.constraints.some((constraint) => constraint.includes('keep_dynamic'))) modifiers.dynamics = Math.max(0.5, modifiers.dynamics);
    if (input.constraints.some((constraint) => constraint.includes('avoid_harshness'))) modifiers.brightness = Math.min(modifiers.brightness, -0.12);
    return modifiers;
  };

  const createTakeCommand = useCallback(async (input: {
    expectedStateVersion: number;
    baseStyle: StyleId;
    priorities: string[];
    constraints: string[];
    intensity?: number;
    modifiers?: MasteringModifiers;
    parentId?: string;
    creator: Creator;
    prompt: string;
    signal?: AbortSignal;
  }) => {
    const invalid = validateMutation(input.expectedStateVersion, input.creator);
    if (invalid) return invalid;
    if (!STYLE_IDS.includes(input.baseStyle)) return { ok: false, code: 'INVALID_STYLE', message: 'Choose one of Champagne’s four tested styles.' };
    const snapshot = runtimeRef.current;
    const sourceTrack = snapshot.track!;
    const startingVersion = stateVersionRef.current;
    renderBusyRef.current = true;
    if (input.creator === 'webmcp') markWebMCP(`Creating a ${STYLE_RECIPES[input.baseStyle].name} take`);
    setPhase('rendering');
    setRenderStatus('Compiling the Champagne plan');
    setRenderProgress(16);
    setMonitorMastered(true);

    const modifiers = input.modifiers ?? makeModifiers(input);
    const intent: MasteringIntent = {
      style: input.baseStyle,
      priorities: input.priorities,
      constraints: input.constraints,
      modifiers,
    };
    setIntentDisplay({ mode: input.parentId ? 'refine' : 'create', style: input.baseStyle, priorities: input.priorities, constraints: input.constraints, modifiers });
    await afterPaint();
    setRenderStatus('Rendering locally');
    setRenderProgress(52);

    try {
      const buffer = await renderMasteringTake(sourceTrack.buffer, input.baseStyle, modifiers, input.signal);
      if (startingVersion !== stateVersionRef.current) return { ok: false, code: 'STALE_STATE', message: 'The project changed while the preview was rendering.' };
      const currentRevisions = runtimeRef.current.revisions;
      const parent = input.parentId ? currentRevisions.find((revision) => revision.id === input.parentId) : undefined;
      const rootCount = currentRevisions.filter((revision) => !revision.parentId).length;
      const childCount = parent ? currentRevisions.filter((revision) => revision.parentId === parent.id).length : 0;
      const label = parent ? `${parent.label}${childCount + 2}` : String.fromCharCode(65 + Math.min(25, rootCount));
      const revision: MasterRevision = {
        id: makeId('take'),
        label,
        parentId: parent?.id,
        style: input.baseStyle,
        creator: input.creator,
        createdAt: Date.now(),
        prompt: input.prompt,
        intent,
        buffer,
        waveform: makeWaveform(buffer),
        analysis: analyzeAudioBuffer(buffer),
        summary: STYLE_RECIPES[input.baseStyle].summary,
        planHash: makePlanHash(input.baseStyle, modifiers, sourceTrack.sourceKey),
      };
      setRevisions((current) => [...current, revision]);
      setActiveRevisionId(revision.id);
      setComparisonIds((current) => current.length ? [...new Set([...current, revision.id])].slice(-3) : [revision.id]);
      setExportReadyId(null);
      setRenderStatus('Take ready');
      setRenderProgress(100);
      setPhase('preview_ready');
      const nextVersion = bumpStateVersion();
      addReceipt({ creator: input.creator, title: `Take ${label} created`, detail: `${STYLE_RECIPES[input.baseStyle].name} · ${input.priorities.join(' + ') || 'balanced direction'}`, revisionId: revision.id });
      if (playbackRef.current) void startPlayback(currentTime, { buffer, analysis: revision.analysis });
      await afterPaint();
      return {
        ok: true,
        commandId: makeId('cmd'),
        stateVersion: nextVersion,
        takeId: revision.id,
        takeLabel: label,
        summary: `Created audible Take ${label} with ${STYLE_RECIPES[input.baseStyle].name}.`,
        changed: { style: input.baseStyle, priorities: input.priorities, constraints: input.constraints },
        nextActions: ['refine_mastering_take', 'stage_comparison', 'commit_master'],
      };
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      setPhase(runtimeRef.current.revisions.length ? 'preview_ready' : 'ready');
      setNotice(cancelled ? 'The local render was cancelled.' : 'Champagne could not render this take.');
      return { ok: false, code: cancelled ? 'CANCELLED' : 'RENDER_FAILED', message: cancelled ? 'The local render was cancelled.' : 'The local render failed.' };
    } finally {
      renderBusyRef.current = false;
    }
  }, [addReceipt, bumpStateVersion, currentTime, markWebMCP, startPlayback, validateMutation]);

  const refineTakeCommand = useCallback(async (input: {
    expectedStateVersion: number;
    sourceTakeId: string;
    dimension: keyof MasteringModifiers;
    direction: 'increase' | 'decrease';
    amount: 'small' | 'medium';
    creator: Creator;
    prompt: string;
    signal?: AbortSignal;
  }) => {
    const source = runtimeRef.current.revisions.find((revision) => revision.id === input.sourceTakeId);
    if (!source) return { ok: false, code: 'TAKE_NOT_FOUND', message: 'That mastering take is no longer available.' };
    const delta = (input.amount === 'medium' ? 0.42 : 0.24) * (input.direction === 'increase' ? 1 : -1);
    const modifiers = { ...source.intent.modifiers, [input.dimension]: clamp(source.intent.modifiers[input.dimension] + delta, -1, 1) };
    return createTakeCommand({
      expectedStateVersion: input.expectedStateVersion,
      baseStyle: source.style,
      priorities: source.intent.priorities,
      constraints: source.intent.constraints,
      modifiers,
      parentId: source.id,
      creator: input.creator,
      prompt: input.prompt,
      signal: input.signal,
    });
  }, [createTakeCommand]);

  const createVariationsCommand = useCallback(async (input: {
    expectedStateVersion: number;
    styles: StyleId[];
    constraint: 'preserve_transients' | 'keep_dynamic' | 'avoid_harshness' | 'none';
    creator: Creator;
    prompt: string;
    signal?: AbortSignal;
  }) => {
    const invalid = validateMutation(input.expectedStateVersion, input.creator);
    if (invalid) return invalid;
    const uniqueStyles = [...new Set(input.styles)].filter((style): style is StyleId => STYLE_IDS.includes(style)).slice(0, 3);
    if (uniqueStyles.length < 2) return { ok: false, code: 'INVALID_VARIATIONS', message: 'Choose two or three different Champagne styles.' };
    const snapshot = runtimeRef.current;
    const sourceTrack = snapshot.track!;
    const startingVersion = stateVersionRef.current;
    renderBusyRef.current = true;
    if (input.creator === 'webmcp') markWebMCP(`Creating ${uniqueStyles.length} mastering directions`);
    setPhase('rendering');
    setMonitorMastered(true);
    setRenderStatus('Building the mastering court');
    setRenderProgress(8);
    const constraintList = input.constraint === 'none' ? [] : [input.constraint.replaceAll('_', ' ')];
    setIntentDisplay({ mode: 'variations', style: uniqueStyles[0], styles: uniqueStyles, priorities: ['contrast'], constraints: constraintList, modifiers: { ...DEFAULT_MODIFIERS } });
    await afterPaint();

    try {
      const created: MasterRevision[] = [];
      const currentRoots = snapshot.revisions.filter((revision) => !revision.parentId).length;
      for (let index = 0; index < uniqueStyles.length; index += 1) {
        if (input.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        const style = uniqueStyles[index];
        setRenderStatus(`Rendering ${STYLE_RECIPES[style].name}`);
        setRenderProgress(12 + (index / uniqueStyles.length) * 76);
        const modifiers = makeModifiers({
          priorities: style === 'dominant' ? ['loudness', 'punch'] : style === 'warm_presence' ? ['warmth'] : ['clarity'],
          constraints: constraintList,
        });
        const buffer = await renderMasteringTake(sourceTrack.buffer, style, modifiers, input.signal);
        const label = String.fromCharCode(65 + Math.min(25, currentRoots + index));
        created.push({
          id: makeId('take'),
          label,
          style,
          creator: input.creator,
          createdAt: Date.now() + index,
          prompt: input.prompt,
          intent: { style, priorities: style === 'dominant' ? ['loudness', 'punch'] : style === 'warm_presence' ? ['warmth'] : ['clarity'], constraints: constraintList, modifiers },
          buffer,
          waveform: makeWaveform(buffer),
          analysis: analyzeAudioBuffer(buffer),
          summary: STYLE_RECIPES[style].summary,
          planHash: makePlanHash(style, modifiers, sourceTrack.sourceKey),
        });
      }
      if (startingVersion !== stateVersionRef.current) return { ok: false, code: 'STALE_STATE', message: 'The project changed while the variations were rendering.' };
      setRevisions((current) => [...current, ...created]);
      setComparisonIds(created.map((revision) => revision.id));
      setActiveRevisionId(created[0].id);
      setLoudnessMatched(true);
      runtimeRef.current.comparisonIds = created.map((revision) => revision.id);
      runtimeRef.current.loudnessMatched = true;
      setRenderProgress(100);
      setRenderStatus('A/B/C ready');
      setPhase('preview_ready');
      const nextVersion = bumpStateVersion();
      addReceipt({ creator: input.creator, title: `${created.length} takes ready`, detail: 'Warm, open, and club-loud directions staged for loudness-matched comparison.', revisionId: created[0].id });
      if (playbackRef.current) void startPlayback(currentTime, { buffer: created[0].buffer, analysis: created[0].analysis });
      await afterPaint();
      return {
        ok: true,
        commandId: makeId('cmd'),
        stateVersion: nextVersion,
        takeIds: created.map((revision) => revision.id),
        takeLabels: created.map((revision) => revision.label),
        summary: `Created ${created.length} audible takes and staged the A/B/C deck.`,
        loudnessMatched: true,
        nextActions: ['stage_comparison', 'refine_mastering_take', 'commit_master'],
      };
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      setPhase(snapshot.revisions.length ? 'preview_ready' : 'ready');
      return { ok: false, code: cancelled ? 'CANCELLED' : 'RENDER_FAILED', message: cancelled ? 'The variation render was cancelled.' : 'Champagne could not render the variation set.' };
    } finally {
      renderBusyRef.current = false;
    }
  }, [addReceipt, bumpStateVersion, currentTime, markWebMCP, startPlayback, validateMutation]);

  const stageComparisonCommand = useCallback(async (input: {
    expectedStateVersion: number;
    takeIds: string[];
    loudnessMatched: boolean;
    creator: Creator;
  }) => {
    if (input.creator === 'webmcp' && runtimeRef.current.agentPaused) return { ok: false, code: 'AGENT_PAUSED', message: 'ChatGPT control is paused in Champagne.' };
    if (input.expectedStateVersion !== stateVersionRef.current) return { ok: false, code: 'STALE_STATE', message: 'Call get_studio_state and retry.', currentStateVersion: stateVersionRef.current };
    const unique = [...new Set(input.takeIds)].filter((id) => runtimeRef.current.revisions.some((revision) => revision.id === id)).slice(0, 3);
    if (unique.length < 2) return { ok: false, code: 'TAKE_NOT_FOUND', message: 'Choose two or three available takes.' };
    if (input.creator === 'webmcp') markWebMCP('Staging the live A/B/C deck');
    setComparisonIds(unique);
    setLoudnessMatched(input.loudnessMatched);
    runtimeRef.current.comparisonIds = unique;
    runtimeRef.current.loudnessMatched = input.loudnessMatched;
    setActiveRevisionId(unique[0]);
    setMonitorMastered(true);
    addReceipt({ creator: input.creator, title: 'Comparison staged', detail: `${unique.length} takes · ${input.loudnessMatched ? 'loudness matched' : 'native level'}` });
    const first = runtimeRef.current.revisions.find((revision) => revision.id === unique[0]);
    if (first && playbackRef.current) void startPlayback(currentTime, { buffer: first.buffer, analysis: first.analysis });
    await afterPaint();
    return { ok: true, stateVersion: stateVersionRef.current, comparisonTakeIds: unique, loudnessMatched: input.loudnessMatched, summary: 'The live comparison deck is ready.' };
  }, [addReceipt, currentTime, markWebMCP, startPlayback]);

  const setTrimFadesCommand = useCallback(async (input: {
    expectedStateVersion: number;
    startSeconds: number;
    endSeconds: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
    creator: Creator;
  }) => {
    if (input.creator === 'webmcp' && runtimeRef.current.agentPaused) return { ok: false, code: 'AGENT_PAUSED', message: 'ChatGPT control is paused in Champagne.' };
    if (input.expectedStateVersion !== stateVersionRef.current) return { ok: false, code: 'STALE_STATE', message: 'Call get_studio_state and retry.', currentStateVersion: stateVersionRef.current };
    const duration = runtimeRef.current.track?.buffer.duration;
    if (!duration) return { ok: false, code: 'NO_TRACK', message: 'Load a track first.' };
    const start = clamp(input.startSeconds, 0, duration - 0.2);
    const end = clamp(input.endSeconds, start + 0.2, duration);
    if (![start, end, input.fadeInSeconds, input.fadeOutSeconds].every(Number.isFinite)) return { ok: false, code: 'INVALID_EDIT', message: 'Trim and fade values must be finite numbers.' };
    const selection = end - start;
    const next = {
      startSeconds: start,
      endSeconds: end,
      fadeInSeconds: clamp(input.fadeInSeconds, 0, selection * 0.45),
      fadeOutSeconds: clamp(input.fadeOutSeconds, 0, selection * 0.45),
    };
    if (input.creator === 'webmcp') markWebMCP('Updating trim and fades');
    setTrim(next);
    const nextVersion = bumpStateVersion();
    addReceipt({ creator: input.creator, title: 'Edit region updated', detail: `${formatTime(start)}–${formatTime(end)} · fades ${next.fadeInSeconds.toFixed(2)}s / ${next.fadeOutSeconds.toFixed(2)}s` });
    await afterPaint();
    return { ok: true, stateVersion: nextVersion, trim: next, summary: 'Updated the non-destructive keep region and fades.' };
  }, [addReceipt, bumpStateVersion, markWebMCP]);

  const commitMasterCommand = useCallback(async (input: {
    expectedStateVersion: number;
    takeId: string;
    creator: Creator;
  }) => {
    if (input.creator === 'webmcp' && runtimeRef.current.agentPaused) return { ok: false, code: 'AGENT_PAUSED', message: 'ChatGPT control is paused in Champagne.' };
    if (input.expectedStateVersion !== stateVersionRef.current) return { ok: false, code: 'STALE_STATE', message: 'Call get_studio_state and retry.', currentStateVersion: stateVersionRef.current };
    const revision = runtimeRef.current.revisions.find((candidate) => candidate.id === input.takeId);
    if (!revision) return { ok: false, code: 'TAKE_NOT_FOUND', message: 'That mastering take is not available.' };
    if (input.creator === 'webmcp') markWebMCP(`Preparing Take ${revision.label} for export`);
    setActiveRevisionId(revision.id);
    setMonitorMastered(true);
    setExportReadyId(revision.id);
    setPhase('export_ready');
    const nextVersion = bumpStateVersion();
    addReceipt({ creator: input.creator, title: `Take ${revision.label} selected`, detail: '24-bit / 48 kHz WAV is staged. Download still requires your click.', revisionId: revision.id });
    if (playbackRef.current) void startPlayback(currentTime, { buffer: revision.buffer, analysis: revision.analysis });
    await afterPaint();
    return {
      ok: true,
      stateVersion: nextVersion,
      takeId: revision.id,
      exportReady: true,
      requiresUserAction: true,
      summary: `Take ${revision.label} is ready. The user must click Download in Champagne.`,
    };
  }, [addReceipt, bumpStateVersion, currentTime, markWebMCP, startPlayback]);

  const getStudioState = useCallback(() => {
    const snapshot = runtimeRef.current;
    if (!snapshot.track) {
      return { ok: true, stateVersion: stateVersionRef.current, status: 'empty', takeCount: 0, availableActions: ['load_track_in_ui'], privacy: { audioShared: false } };
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
      activeTakeId: snapshot.activeRevisionId,
      takes: snapshot.revisions.map((revision) => ({ id: revision.id, label: revision.label, style: revision.style, parentId: revision.parentId })),
      availableActions: snapshot.revisions.length
        ? ['create_mastering_take', 'refine_mastering_take', 'create_variations', 'stage_comparison', 'set_trim_fades', 'commit_master']
        : ['analyze_track', 'create_mastering_take', 'create_variations', 'set_trim_fades'],
      privacy: { audioShared: false, filenameShared: false },
    };
  }, []);

  const analyzeTrackCommand = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return { ok: false, code: 'CANCELLED', message: 'Analysis request cancelled.' };
    const analysis = runtimeRef.current.track?.analysis;
    if (!analysis) return { ok: false, code: 'NO_TRACK', message: 'Load a track in Champagne first.' };
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
      nextActions: ['create_mastering_take', 'create_variations'],
    };
  }, [markWebMCP]);

  apiRef.current = {
    getState: getStudioState,
    analyzeTrack: analyzeTrackCommand,
    createTake: (input) => createTakeCommand(input),
    refineTake: (input) => refineTakeCommand(input),
    createVariations: (input) => createVariationsCommand(input),
    stageComparison: (input) => stageComparisonCommand(input),
    setTrimFades: (input) => setTrimFadesCommand(input),
    commitMaster: (input) => commitMasterCommand(input),
  };

  useEffect(() => {
    let cleanup: () => void = () => undefined;
    let cancelled = false;
    void registerChampagneTools(apiRef, (available) => {
      if (!cancelled) setWebmcpAvailable(available);
    }).then((dispose) => {
      if (cancelled) dispose();
      else cleanup = dispose;
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  const selectRevision = useCallback((id: string) => {
    const revision = runtimeRef.current.revisions.find((candidate) => candidate.id === id);
    if (!revision) return;
    setActiveRevisionId(id);
    setMonitorMastered(true);
    setExportReadyId(null);
    if (playbackRef.current) void startPlayback(currentTime, { buffer: revision.buffer, analysis: revision.analysis });
  }, [currentTime, startPlayback]);

  const selectSource = useCallback((mastered: boolean) => {
    setMonitorMastered(mastered);
    const snapshot = runtimeRef.current;
    const selected = mastered && snapshot.activeRevisionId
      ? snapshot.revisions.find((revision) => revision.id === snapshot.activeRevisionId)
      : null;
    if (playbackRef.current && snapshot.track) {
      void startPlayback(currentTime, selected ? { buffer: selected.buffer, analysis: selected.analysis } : { buffer: snapshot.track.buffer, analysis: snapshot.track.analysis });
    }
  }, [currentTime, startPlayback]);

  const updateLoudnessMatch = useCallback((checked: boolean) => {
    setLoudnessMatched(checked);
    runtimeRef.current.loudnessMatched = checked;
    if (playbackRef.current) void startPlayback(currentTime);
  }, [currentTime, startPlayback]);

  const handleTrimChange = useCallback((next: TrimSettings) => {
    setTrim(next);
    setExportReadyId(null);
  }, []);

  const commitManualTrim = useCallback(() => {
    bumpStateVersion();
    addReceipt({ creator: 'manual', title: 'Edit region updated', detail: `${formatTime(trim.startSeconds)}–${formatTime(trim.endSeconds)} · local and reversible` });
  }, [addReceipt, bumpStateVersion, trim]);

  const submitBrief = useCallback(async () => {
    const value = brief.trim();
    if (!track || !value || renderBusyRef.current) return;
    const interpreted = interpretBrief(value, Boolean(activeRevisionId));
    setIntentDisplay(interpreted);
    addReceipt({ creator: 'brief', title: 'Brief understood', detail: interpreted.mode === 'variations' ? 'Three contrasting directions' : `${STYLE_RECIPES[interpreted.style].name} · bounded semantic plan` });
    const expectedStateVersion = stateVersionRef.current;
    if (interpreted.mode === 'variations') {
      await createVariationsCommand({
        expectedStateVersion,
        styles: interpreted.styles ?? ['warm_presence', 'modern_crisp', 'dominant'],
        constraint: interpreted.constraints.includes('preserve transients') ? 'preserve_transients' : interpreted.constraints.includes('keep dynamic') ? 'keep_dynamic' : interpreted.constraints.includes('avoid harshness') ? 'avoid_harshness' : 'none',
        creator: 'brief',
        prompt: value,
      });
    } else if (interpreted.mode === 'refine' && interpreted.refinement && activeRevisionId) {
      const direction = interpreted.refinement.delta >= 0 ? 'increase' : 'decrease';
      await refineTakeCommand({
        expectedStateVersion,
        sourceTakeId: activeRevisionId,
        dimension: interpreted.refinement.dimension,
        direction,
        amount: Math.abs(interpreted.refinement.delta) > 0.35 ? 'medium' : 'small',
        creator: 'brief',
        prompt: value,
      });
    } else {
      await createTakeCommand({
        expectedStateVersion,
        baseStyle: interpreted.style,
        priorities: interpreted.priorities,
        constraints: interpreted.constraints,
        modifiers: interpreted.modifiers,
        creator: 'brief',
        prompt: value,
      });
    }
    setBrief('');
  }, [activeRevisionId, addReceipt, brief, createTakeCommand, createVariationsCommand, refineTakeCommand, track]);

  const handleStyle = useCallback((style: StyleId) => {
    const existing = [...runtimeRef.current.revisions].reverse().find((revision) => revision.style === style && !revision.parentId);
    if (existing) {
      selectRevision(existing.id);
      return;
    }
    void createTakeCommand({
      expectedStateVersion: stateVersionRef.current,
      baseStyle: style,
      priorities: style === 'dominant' ? ['loudness', 'punch'] : style === 'warm_presence' ? ['warmth'] : style === 'modern_crisp' ? ['clarity'] : ['punch', 'loudness'],
      constraints: [],
      creator: 'manual',
      prompt: `Selected ${STYLE_RECIPES[style].name}`,
    });
  }, [createTakeCommand, selectRevision]);

  const handleDownload = useCallback(async () => {
    const revision = runtimeRef.current.revisions.find((candidate) => candidate.id === exportReadyId);
    const sourceTrack = runtimeRef.current.track;
    if (!revision || !sourceTrack) return;
    setIsExporting(true);
    setRenderStatus('Writing 24-bit / 48 kHz WAV');
    try {
      const blob = await encodeMasterWav24(revision.buffer, runtimeRef.current.trim);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = safeDownloadName(sourceTrack.name, revision.style);
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      addReceipt({ creator: 'manual', title: 'Master downloaded', detail: `Take ${revision.label} · 24-bit / 48 kHz WAV`, revisionId: revision.id });
    } catch {
      setNotice('Champagne could not prepare the WAV download.');
    } finally {
      setIsExporting(false);
    }
  }, [addReceipt, exportReadyId]);

  const suggestions = useMemo(() => {
    if (!revisions.length) return ['Make it club-loud, but keep the kick punchy.', 'Warm and intimate without getting muddy.', 'Create three directions: warm, open, and club-loud.'];
    if (revisions.length === 1) return ['A little less bright.', 'Back off the intensity.', 'Make an alternate with more warmth.'];
    return ['Create three contrasting directions.', 'A little less bright.', 'Keep it dynamic and control only the stray peaks.'];
  }, [revisions.length]);

  const agentPayload = useMemo(() => ({
    project: track ? { status: phase, stateVersion, durationSeconds: round(track.analysis.durationSeconds, 2), activeTakeId: activeRevisionId, takeCount: revisions.length } : { status: 'empty', stateVersion },
    analysis: track ? {
      samplePeakDbfs: round(track.analysis.samplePeakDbfs, 2),
      rmsDbfs: round(track.analysis.rmsDbfs, 2),
      crestFactorDb: round(track.analysis.crestFactorDb, 2),
      flags: track.analysis.flags,
    } : null,
    capabilities: { styles: STYLE_IDS, actions: ['analyze', 'create take', 'refine', 'compare', 'trim/fades', 'stage export'] },
    excluded: ['audio bytes', 'waveform samples', 'filename', 'local path'],
  }), [activeRevisionId, phase, revisions.length, stateVersion, track]);

  const connectionLabel = !webmcpAvailable
    ? 'Manual mode'
    : agentPaused
      ? 'ChatGPT paused'
      : webmcpInvoked
        ? 'ChatGPT directing'
        : 'Site tools ready';

  return (
    <main
      className="champagne-shell min-h-screen overflow-hidden text-foreground"
      onDragEnter={(event) => { event.preventDefault(); setIsDropTargeted(true); }}
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

      <header className="studio-header">
        <button className="brand-cluster" type="button" onClick={() => track && setAgentPanelOpen(true)} aria-label="Champagne mastering studio">
          <span className="brand-mark"><AudioWaveform /></span>
          <span>
            <span className="brand-wordmark">CHAMPAGNE</span>
            <span className="brand-subtitle">MASTERING STUDIO</span>
          </span>
        </button>

        <div className="header-statuses">
          <button className={`connection-beacon ${webmcpInvoked && !agentPaused ? 'is-live' : ''}`} type="button" onClick={() => setAgentPanelOpen(true)}>
            {webmcpAvailable ? <Cable /> : <WifiOff />}
            <span>{connectionLabel}</span>
            <span className="connection-dot" />
          </button>
          <button className="privacy-pill" type="button" onClick={() => setAgentPanelOpen(true)}>
            <LockKeyhole /> Audio stays here
          </button>
        </div>

        <div className="header-actions">
          {track && (
            <Button className="subtle-button header-new-track" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Plus /> New track
            </Button>
          )}
          <Button
            className={`export-button ${exportReadyId ? 'is-ready' : ''}`}
            size="lg"
            disabled={!activeRevision || isExporting || phase === 'rendering'}
            onClick={() => {
              if (exportReadyId === activeRevisionId) void handleDownload();
              else if (activeRevisionId) void commitMasterCommand({ expectedStateVersion: stateVersionRef.current, takeId: activeRevisionId, creator: 'manual' });
            }}
          >
            {isExporting ? <Loader2 className="animate-spin" /> : exportReadyId === activeRevisionId ? <Download /> : <ArrowDownToLine />}
            <span className="hidden sm:inline">{isExporting ? 'Preparing…' : exportReadyId === activeRevisionId ? 'Download WAV' : 'Prepare master'}</span>
            <span className="sm:hidden">Export</span>
          </Button>
        </div>
      </header>

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

      {!track ? (
        <section className="empty-studio">
          <div className={`empty-drop surface ${isDropTargeted ? 'is-targeted' : ''}`}>
            {phase === 'analyzing' ? (
              <div className="empty-progress">
                <span className="progress-orbit"><Loader2 className="animate-spin" /></span>
                <p className="eyebrow text-gold">{renderStatus}</p>
                <h1>Reading your track locally</h1>
                <span className="progress-line"><i style={{ width: `${renderProgress}%` }} /></span>
              </div>
            ) : (
              <>
                <span className="drop-icon"><Upload /></span>
                <p className="eyebrow text-gold">LOCAL-FIRST MASTERING</p>
                <h1>Drop a track. Describe the finish.</h1>
                <p className="empty-copy">AI directs. Champagne’s deterministic engine masters. Hear every change, compare every take, and keep the audio on your device.</p>
                <div className="empty-actions">
                  <Button className="gold-primary" size="lg" onClick={() => fileInputRef.current?.click()}><Music2 /> Choose audio file</Button>
                  <Button className="demo-button" variant="outline" size="lg" onClick={() => void loadDemo()}><Play /> Try the demo loop</Button>
                </div>
                <p className="format-copy">WAV · AIFF · MP3 · M4A · FLAC</p>
              </>
            )}
          </div>
          <div className="empty-proof-row">
            <div><ShieldCheck /><span><strong>No upload</strong><small>PCM never leaves the browser</small></span></div>
            <div><GitBranch /><span><strong>Every take is reversible</strong><small>Agent edits branch, never overwrite</small></span></div>
            <div><Headphones /><span><strong>Hear before export</strong><small>A/B/C while the music keeps moving</small></span></div>
          </div>
          {notice && <div className="notice-banner"><Info />{notice}<button onClick={() => setNotice(null)} aria-label="Dismiss"><X /></button></div>}
        </section>
      ) : (
        <div className="studio-layout">
          <section className="studio-main">
            <div className="surface waveform-surface">
              <div className="track-bar">
                <div className="track-identity">
                  <span className="track-check"><Check /></span>
                  <span className="min-w-0">
                    <strong>{track.name}</strong>
                    <small>{formatTime(track.buffer.duration)} · {Math.round(track.buffer.sampleRate / 100) / 10} kHz · {track.buffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}</small>
                  </span>
                </div>
                <div className="track-analysis">
                  <span><small>PEAK</small><strong>{track.analysis.samplePeakDbfs.toFixed(1)} <i>dBFS</i></strong></span>
                  <span><small>CREST</small><strong>{track.analysis.crestFactorDb.toFixed(1)} <i>dB</i></strong></span>
                </div>
              </div>

              <div className="waveform-workspace">
                <div className="waveform-meta">
                  <div>
                    <span className={`source-label ${monitorMastered ? 'is-mastered' : ''}`}>
                      {monitorMastered && activeRevision ? `TAKE ${activeRevision.label} · ${STYLE_RECIPES[activeRevision.style].name}` : 'ORIGINAL'}
                    </span>
                    {activeRevision?.creator === 'webmcp' && <Badge className="agent-origin" variant="outline"><Bot /> ChatGPT</Badge>}
                  </div>
                  <span className="timecode">{formatTime(currentTime - trim.startSeconds)} <i>/</i> {formatTime(trim.endSeconds - trim.startSeconds)}</span>
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
                  />
                  {phase === 'rendering' && (
                    <div className="render-overlay">
                      <span className="render-pulse"><AudioWaveform /></span>
                      <span><strong>{renderStatus}</strong><small>Your audio is being processed on this device</small></span>
                      <b>{Math.round(renderProgress)}%</b>
                    </div>
                  )}
                </div>

                <div className="transport-row">
                  <div className="source-switch">
                    <button className={!monitorMastered ? 'is-active' : ''} type="button" onClick={() => selectSource(false)}><AudioWaveform /> Original</button>
                    <button className={monitorMastered ? 'is-active' : ''} type="button" disabled={!activeRevision} onClick={() => selectSource(true)}><Sparkles /> Mastered</button>
                  </div>
                  <button className="play-button" type="button" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={() => playbackRef.current ? stopPlayback() : void startPlayback()}>
                    {isPlaying ? <Pause className="fill-current" /> : <Play className="fill-current" />}
                  </button>
                  <div className="transport-options">
                    <label><span>Loudness match</span><Switch checked={loudnessMatched} onCheckedChange={updateLoudnessMatch} size="sm" /></label>
                    <button type="button" onClick={commitManualTrim}><SlidersHorizontal /> Commit edit</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="surface brief-surface">
              <div className="brief-header">
                <div className="flex items-center gap-2.5">
                  <span className="brief-icon"><WandSparkles /></span>
                  <span><strong>Mastering Brief</strong><small>Direct the engine in your own words</small></span>
                </div>
                <button className="brief-connection" type="button" onClick={() => setAgentPanelOpen(true)}>
                  <span className={webmcpInvoked && !agentPaused ? 'is-live' : ''} />
                  {webmcpInvoked && !agentPaused ? 'ChatGPT and you share this studio' : 'Local brief · same command bus'}
                </button>
              </div>

              {intentDisplay && (
                <div className="intent-ribbon">
                  <span className="intent-understood"><Check /> UNDERSTOOD</span>
                  {intentDisplay.mode === 'variations' ? (
                    intentDisplay.styles?.map((style) => <b key={style}>{STYLE_RECIPES[style].name.toUpperCase()}</b>)
                  ) : (
                    <b>{STYLE_RECIPES[intentDisplay.style].name.toUpperCase()}</b>
                  )}
                  {intentDisplay.priorities.slice(0, 3).map((priority) => <span key={priority}>{priority.toUpperCase()} ↑</span>)}
                  {intentDisplay.constraints.slice(0, 2).map((constraint) => <span className="is-locked" key={constraint}><LockKeyhole /> {constraint.toUpperCase()}</span>)}
                </div>
              )}

              <div className="suggestion-row">
                {suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => setBrief(suggestion)}>{suggestion.replace(/\.$/, '')}</button>)}
              </div>
              <div className="composer">
                <Textarea
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void submitBrief();
                    }
                  }}
                  className="min-h-[70px] resize-none border-0 bg-transparent px-0 py-0 text-[15px] shadow-none focus-visible:ring-0"
                  placeholder="Try “Make three directions: warm, open, and club-loud. Preserve the transients.”"
                  aria-label="Mastering Brief"
                  disabled={phase === 'rendering'}
                />
                <Button className="send-button" size="icon" aria-label="Create local preview" disabled={!brief.trim() || phase === 'rendering'} onClick={() => void submitBrief()}>
                  {phase === 'rendering' ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                </Button>
              </div>
              <div className="brief-footer">
                <span><LockKeyhole /> Audio never leaves this device</span>
                <span>Enter to direct · Shift+Enter for a new line</span>
              </div>
            </div>

            {revisions.length > 0 && (
              <div className="surface revision-surface">
                <div className="revision-heading">
                  <span><GitBranch /> MASTERING TAKES</span>
                  <div><span>{comparisonIds.length > 1 ? `${comparisonIds.length}-WAY COMPARISON` : 'REVISION GRAPH'}</span><Switch checked={loudnessMatched} onCheckedChange={updateLoudnessMatch} size="sm" /></div>
                </div>
                <div className="revision-rail">
                  <button className={!monitorMastered ? 'revision-card is-active is-original' : 'revision-card is-original'} type="button" onClick={() => selectSource(false)}>
                    <span className="revision-letter">O</span><span><strong>Original</strong><small>Immutable source</small></span>
                  </button>
                  <span className="rail-line" />
                  {revisions.map((revision) => {
                    const Icon = styleIcons[revision.style];
                    const compared = comparisonIds.includes(revision.id);
                    return (
                      <button className={`revision-card ${activeRevisionId === revision.id && monitorMastered ? 'is-active' : ''} ${compared ? 'is-compared' : ''}`} key={revision.id} type="button" onClick={() => selectRevision(revision.id)}>
                        <span className="revision-letter">{revision.label}</span>
                        <span className="revision-copy"><strong>{STYLE_RECIPES[revision.style].name}</strong><small>{revision.parentId ? 'Child take' : revision.creator === 'webmcp' ? 'ChatGPT take' : revision.creator === 'brief' ? 'Brief take' : 'Manual take'}</small></span>
                        <Icon className="revision-style-icon" />
                        {compared && <span className="compare-dot" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {notice && <div className="notice-banner"><Info />{notice}<button onClick={() => setNotice(null)} aria-label="Dismiss"><X /></button></div>}
          </section>

          <aside className="studio-sidebar">
            <div className="surface sidebar-card styles-card">
              <div className="sidebar-heading"><span>MASTERING STYLE</span><small>FOUR SIGNATURES</small></div>
              <div className="styles-list">
                {STYLE_IDS.map((style) => {
                  const recipe = STYLE_RECIPES[style];
                  const Icon = styleIcons[style];
                  const readyRevision = [...revisions].reverse().find((revision) => revision.style === style && !revision.parentId);
                  const selected = activeRevision?.style === style && monitorMastered;
                  return (
                    <button className={`style-row ${selected ? 'is-selected' : ''}`} key={style} type="button" disabled={phase === 'rendering'} onClick={() => handleStyle(style)}>
                      <span className="style-glyph"><Icon /></span>
                      <span className="min-w-0 flex-1 text-left"><strong>{recipe.name}</strong><small>{recipe.subtitle}</small></span>
                      {readyRevision ? <span className="ready-mark"><Check /></span> : <ChevronRight className="style-chevron" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="surface sidebar-card change-card">
              <div className="sidebar-heading">
                <span>{activeRevision ? 'CHANGE SET' : 'LOCAL ANALYSIS'}</span>
                {activeRevision ? <Badge className="take-badge" variant="outline">TAKE {activeRevision.label}</Badge> : <Badge className="analysis-badge" variant="outline">READY</Badge>}
              </div>
              {activeRevision ? (
                <>
                  <div className="change-origin">
                    <span className={`origin-icon ${activeRevision.creator === 'webmcp' ? 'is-agent' : ''}`}>{activeRevision.creator === 'webmcp' ? <Bot /> : activeRevision.creator === 'brief' ? <WandSparkles /> : <SlidersHorizontal />}</span>
                    <span><strong>{activeRevision.creator === 'webmcp' ? 'Directed by ChatGPT' : activeRevision.creator === 'brief' ? 'Created from your brief' : 'Selected manually'}</strong><small>{activeRevision.prompt}</small></span>
                  </div>
                  <div className="change-list">
                    <div><span>Base style</span><strong>{STYLE_RECIPES[activeRevision.style].name}</strong></div>
                    <div><span>Priorities</span><strong>{activeRevision.intent.priorities.join(' + ') || 'Balanced'}</strong></div>
                    <div><span>Constraints</span><strong>{activeRevision.intent.constraints.join(' + ') || 'Champagne safeguards'}</strong></div>
                  </div>
                  <div className="metric-strip">
                    <div><span>TARGET</span><strong>{STYLE_RECIPES[activeRevision.style].targetLufs.toFixed(1)}</strong><small>LUFS</small></div>
                    <div><span>CEILING</span><strong>{STYLE_RECIPES[activeRevision.style].ceilingDbtp.toFixed(1)}</strong><small>dBTP</small></div>
                  </div>
                  <p className="take-summary">{activeRevision.summary}</p>
                  <div className="quick-refine">
                    <button type="button" onClick={() => { setBrief('A little less bright.'); }}>Less bright</button>
                    <button type="button" onClick={() => { setBrief('Make this warmer.'); }}>Warmer</button>
                    <button type="button" onClick={() => { setBrief('Back off the intensity.'); }}>Less intense</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="analysis-grid">
                    <div><span>SAMPLE PEAK</span><strong>{track.analysis.samplePeakDbfs.toFixed(1)}</strong><small>dBFS</small></div>
                    <div><span>RMS LEVEL</span><strong>{track.analysis.rmsDbfs.toFixed(1)}</strong><small>dBFS</small></div>
                    <div><span>CREST FACTOR</span><strong>{track.analysis.crestFactorDb.toFixed(1)}</strong><small>dB</small></div>
                    <div><span>HEADROOM</span><strong>{track.analysis.headroomDb.toFixed(1)}</strong><small>dB</small></div>
                  </div>
                  <div className="analysis-flags">{track.analysis.flags.map((flag) => <span key={flag}><Check />{flag.replaceAll('_', ' ')}</span>)}</div>
                  <p className="take-summary">Choose a signature or write a Mastering Brief. Champagne will render an audible, reversible take.</p>
                </>
              )}
            </div>

            <button className="agent-card surface" type="button" onClick={() => setAgentPanelOpen(true)}>
              <span className={`agent-card-icon ${webmcpInvoked && !agentPaused ? 'is-live' : ''}`}><Bot /></span>
              <span><strong>{connectionLabel}</strong><small>{webmcpAvailable ? webmcpInvoked ? 'Every agent action appears here before export.' : 'Ask ChatGPT to create, refine, compare, trim, or stage a master.' : 'Open this site in ChatGPT’s browser to expose site tools.'}</small></span>
              <ChevronRight />
            </button>

            {activity.length > 0 && (
              <div className="surface sidebar-card activity-card">
                <div className="sidebar-heading"><span>RECENT ACTIVITY</span><button type="button" onClick={() => setAgentPanelOpen(true)}><MoreHorizontal /></button></div>
                <div className="activity-list">
                  {activity.slice(0, 4).map((receipt) => (
                    <div key={receipt.id}><span className={`activity-dot is-${receipt.creator}`} />
                      <span><strong>{receipt.title}</strong><small>{receipt.detail}</small></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      <Sheet open={agentPanelOpen} onOpenChange={setAgentPanelOpen}>
        <SheetContent className="agent-sheet w-[min(440px,94vw)] border-white/10 bg-[#101015]/98 sm:max-w-[440px]">
          <SheetHeader className="border-b border-white/[0.07] px-6 py-5">
            <div className="mb-3 flex items-center gap-3">
              <span className={`sheet-agent-icon ${webmcpInvoked && !agentPaused ? 'is-live' : ''}`}><Bot /></span>
              <div>
                <SheetTitle className="text-[16px]">Control with ChatGPT</SheetTitle>
                <SheetDescription className="mt-0.5 text-xs">The agent and you work on the same live studio.</SheetDescription>
              </div>
            </div>
            <div className={`sheet-connection ${webmcpAvailable ? 'is-ready' : ''}`}>
              <span className="connection-dot" />
              <span><strong>{connectionLabel}</strong><small>{webmcpAvailable ? 'Eight Champagne actions are registered on this top-level page.' : 'Site tools are unavailable in this browser. The local brief and manual controls still work.'}</small></span>
            </div>
          </SheetHeader>
          <div className="agent-sheet-scroll">
            <section className="sheet-section">
              <div className="sheet-section-heading"><span>SESSION CONTROL</span><Switch checked={!agentPaused} onCheckedChange={(checked) => setAgentPaused(!checked)} /></div>
              <p>Allow ChatGPT to analyze, create previews, refine takes, stage comparisons, and edit trim/fades. Download always requires your click.</p>
            </section>
            <section className="sheet-section">
              <div className="sheet-section-heading"><span>TRY THIS IN CHATGPT</span><Cable /></div>
              <blockquote>“Make three directions: warm, open, and club-loud. Preserve the transients, then stage them for comparison.”</blockquote>
              <ol>
                <li><b>1</b><span>Load a track here. Audio stays local.</span></li>
                <li><b>2</b><span>Ask ChatGPT from beside this page.</span></li>
                <li><b>3</b><span>Watch each audible take appear in the studio.</span></li>
              </ol>
            </section>
            <section className="sheet-section">
              <div className="sheet-section-heading"><span>WHAT CHATGPT CAN SEE</span><Eye /></div>
              <pre>{JSON.stringify(agentPayload, null, 2)}</pre>
              <div className="privacy-proof"><ShieldCheck /><span><strong>Audio bytes are excluded by design.</strong><small>No PCM, blobs, waveform arrays, filename, or local path enters a tool result.</small></span></div>
            </section>
            <section className="sheet-section">
              <div className="sheet-section-heading"><span>AVAILABLE ACTIONS</span><Activity /></div>
              <div className="tool-list">
                {['Read studio state', 'Analyze track locally', 'Create a mastering take', 'Refine a take', 'Create three variations', 'Stage A/B/C', 'Set trim and fades', 'Prepare final master'].map((tool) => <span key={tool}><Check />{tool}</span>)}
              </div>
            </section>
            {activity.length > 0 && (
              <section className="sheet-section">
                <div className="sheet-section-heading"><span>ACTION RECEIPTS</span><RotateCcw /></div>
                <div className="sheet-receipts">{activity.map((receipt) => <div key={receipt.id}><span className={`activity-dot is-${receipt.creator}`} /><span><strong>{receipt.title}</strong><small>{receipt.detail}</small></span></div>)}</div>
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
