'use client';

import { useEffect, useRef } from 'react';

import { parabolicFadeGain } from '@/lib/audio-engine';
import { clamp, type TrimSettings } from '@/lib/studio';

type DragTarget = 'trimStart' | 'trimEnd' | 'fadeIn' | 'fadeOut' | 'scrub';
type FadeDragAxis = 'horizontal' | 'vertical';

interface DragState {
  target: DragTarget;
  startX: number;
  startY: number;
  startTrim: TrimSettings;
  axis: FadeDragAxis | null;
}

interface WaveformEditorProps {
  waveform: number[];
  duration: number;
  currentTime: number;
  trim: TrimSettings;
  mastered: boolean;
  onSeek: (seconds: number) => void;
  onTrimChange: (trim: TrimSettings) => void;
  onEditCommit?: () => void;
}

function handlePositions(trim: TrimSettings, duration: number, width: number) {
  const startX = duration > 0 ? (trim.startSeconds / duration) * width : 0;
  const endX = duration > 0 ? (trim.endSeconds / duration) * width : width;
  const selectionWidth = Math.max(1, endX - startX);
  const seededGap = Math.min(32, selectionWidth * 0.23);
  const fadeInActualX =
    duration > 0
      ? ((trim.startSeconds + trim.fadeInSeconds) / duration) * width
      : startX;
  const fadeOutActualX =
    duration > 0
      ? ((trim.endSeconds - trim.fadeOutSeconds) / duration) * width
      : endX;
  const fadeInX =
    trim.fadeInSeconds > 0.001 ? fadeInActualX : startX + seededGap;
  const fadeOutX =
    trim.fadeOutSeconds > 0.001 ? fadeOutActualX : endX - seededGap;
  return { startX, endX, fadeInX, fadeOutX };
}

export function WaveformEditor({
  waveform,
  duration,
  currentTime,
  trim,
  mastered,
  onSeek,
  onTrimChange,
  onEditCommit,
}: WaveformEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const propsRef = useRef({ duration, trim, onSeek, onTrimChange });
  propsRef.current = { duration, trim, onSeek, onTrimChange };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      if (
        canvas.width !== Math.round(width * ratio) ||
        canvas.height !== Math.round(height * ratio)
      ) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const background = context.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, 'rgba(255,255,255,0.018)');
      background.addColorStop(1, 'rgba(0,0,0,0.08)');
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      context.strokeStyle = 'rgba(255,255,255,0.035)';
      context.lineWidth = 1;
      for (let line = 1; line < 4; line += 1) {
        const y = (height * line) / 4;
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(width, y + 0.5);
        context.stroke();
      }

      const { startX, endX, fadeInX, fadeOutX } = handlePositions(
        trim,
        duration,
        width,
      );
      const center = height / 2;
      const barWidth = Math.max(1, width / Math.max(1, waveform.length) - 1.2);

      waveform.forEach((peak, index) => {
        const x = (index / Math.max(1, waveform.length - 1)) * width;
        const amplitude = Math.max(1.2, peak * (height * 0.36));
        const inSelection = x >= startX && x <= endX;
        context.fillStyle = mastered
          ? inSelection
            ? 'rgba(220,185,97,0.88)'
            : 'rgba(126,103,53,0.32)'
          : inSelection
            ? 'rgba(142,144,153,0.78)'
            : 'rgba(84,85,92,0.26)';
        context.beginPath();
        context.roundRect(
          x,
          center - amplitude,
          barWidth,
          amplitude * 2,
          Math.min(barWidth, 2),
        );
        context.fill();
      });

      context.fillStyle = 'rgba(0,0,0,0.48)';
      context.fillRect(0, 0, Math.max(0, startX), height);
      context.fillRect(endX, 0, Math.max(0, width - endX), height);
      context.fillStyle = mastered
        ? 'rgba(217,179,89,0.026)'
        : 'rgba(122,125,133,0.025)';
      context.fillRect(startX, 0, Math.max(0, endX - startX), height);
      context.strokeStyle = mastered
        ? 'rgba(217,179,89,0.6)'
        : 'rgba(142,144,153,0.55)';
      context.beginPath();
      context.roundRect(
        startX + 0.5,
        0.5,
        Math.max(1, endX - startX - 1),
        height - 1,
        12,
      );
      context.stroke();

      const drawFadeCurve = (
        fromX: number,
        toX: number,
        curvature: number,
        reversed: boolean,
      ) => {
        const steps = 30;
        context.strokeStyle = 'rgba(205,207,214,0.58)';
        context.lineWidth = 1.15;
        context.setLineDash(
          (trim.fadeInSeconds <= 0.001 && !reversed) ||
            (trim.fadeOutSeconds <= 0.001 && reversed)
            ? [3, 3]
            : [],
        );
        context.beginPath();
        for (let step = 0; step <= steps; step += 1) {
          const progress = step / steps;
          const gain = reversed
            ? parabolicFadeGain(1 - progress, curvature)
            : parabolicFadeGain(progress, curvature);
          const x = fromX + (toX - fromX) * progress;
          const y = height - 7 - gain * (height - 20);
          if (step === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
        context.setLineDash([]);
      };
      drawFadeCurve(startX, fadeInX, trim.fadeInCurve, false);
      drawFadeCurve(fadeOutX, endX, trim.fadeOutCurve, true);

      const drawHandle = (
        x: number,
        label: string,
        primary: boolean,
        active: boolean,
        curve?: number,
      ) => {
        context.fillStyle = primary
          ? '#d9b359'
          : active
            ? '#f0f0f3'
            : 'rgba(195,197,204,0.72)';
        context.fillRect(x - 1, 0, primary ? 2 : 1.25, height);
        context.fillStyle = primary
          ? '#d9b359'
          : active
            ? '#ececf0'
            : '#686971';
        const boxWidth = primary ? 28 : 38;
        const boxX = clamp(x - boxWidth / 2, 2, width - boxWidth - 2);
        const boxY = primary
          ? height - 21
          : clamp(
              4 + ((1 - (curve ?? 1 / 3)) / 2) * (height - 22),
              4,
              height - 18,
            );
        context.beginPath();
        context.roundRect(boxX, boxY, boxWidth, 14, 4);
        context.fill();
        context.fillStyle = primary
          ? '#17130b'
          : active
            ? '#17171b'
            : '#eeeef2';
        context.font = '700 7px ui-monospace, monospace';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(label, boxX + boxWidth / 2, boxY + 7);
      };

      const activeTarget = dragRef.current?.target;
      drawHandle(startX, 'CUT', true, activeTarget === 'trimStart');
      drawHandle(endX, 'CUT', true, activeTarget === 'trimEnd');
      drawHandle(
        fadeInX,
        'FADE IN',
        false,
        activeTarget === 'fadeIn',
        trim.fadeInCurve,
      );
      drawHandle(
        fadeOutX,
        'FADE OUT',
        false,
        activeTarget === 'fadeOut',
        trim.fadeOutCurve,
      );

      if (
        dragRef.current?.axis === 'vertical' &&
        (activeTarget === 'fadeIn' || activeTarget === 'fadeOut')
      ) {
        const curve =
          activeTarget === 'fadeIn' ? trim.fadeInCurve : trim.fadeOutCurve;
        const x = activeTarget === 'fadeIn' ? fadeInX : fadeOutX;
        const label = `CURVE ${curve >= 0 ? '+' : ''}${Math.round(curve * 100)}`;
        context.fillStyle = 'rgba(12,12,16,.88)';
        context.beginPath();
        context.roundRect(clamp(x - 34, 4, width - 72), 25, 68, 18, 6);
        context.fill();
        context.fillStyle = '#d8d8de';
        context.font = '700 7px ui-monospace, monospace';
        context.fillText(label, clamp(x, 38, width - 38), 34);
      }

      const playheadX =
        duration > 0 ? clamp((currentTime / duration) * width, 0, width) : 0;
      context.strokeStyle = '#f5dc94';
      context.lineWidth = 1.25;
      context.shadowColor = 'rgba(245,220,148,0.6)';
      context.shadowBlur = 8;
      context.beginPath();
      context.moveTo(playheadX, 0);
      context.lineTo(playheadX, height);
      context.stroke();
      context.shadowBlur = 0;
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [currentTime, duration, mastered, trim, waveform]);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
      width: rect.width,
      height: rect.height,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const position = pointerPosition(event);
    if (!position || duration <= 0) return;
    const currentTrim = propsRef.current.trim;
    const handles = handlePositions(currentTrim, duration, position.width);
    const targets: Array<[DragTarget, number]> = [
      ['trimStart', handles.startX],
      ['trimEnd', handles.endX],
      ['fadeIn', handles.fadeInX],
      ['fadeOut', handles.fadeOutX],
    ];
    const nearest = targets
      .map(([target, x]) => [target, Math.abs(x - position.x)] as const)
      .sort((a, b) => a[1] - b[1])[0];
    const target: DragTarget =
      nearest && nearest[1] <= 22 ? nearest[0] : 'scrub';
    dragRef.current = {
      target,
      startX: position.x,
      startY: position.y,
      startTrim: { ...currentTrim },
      axis: null,
    };
    canvasRef.current?.setPointerCapture(event.pointerId);
    if (target === 'scrub') {
      const seconds = (position.x / position.width) * duration;
      propsRef.current.onSeek(
        clamp(seconds, currentTrim.startSeconds, currentTrim.endSeconds),
      );
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const position = pointerPosition(event);
    if (!drag || !position || duration <= 0) return;
    const seconds = (position.x / position.width) * duration;
    if (drag.target === 'scrub') {
      propsRef.current.onSeek(
        clamp(seconds, drag.startTrim.startSeconds, drag.startTrim.endSeconds),
      );
      return;
    }

    const next = { ...drag.startTrim };
    if (drag.target === 'trimStart')
      next.startSeconds = clamp(seconds, 0, next.endSeconds - 0.2);
    if (drag.target === 'trimEnd')
      next.endSeconds = clamp(seconds, next.startSeconds + 0.2, duration);
    const selection = next.endSeconds - next.startSeconds;

    if (drag.target === 'fadeIn' || drag.target === 'fadeOut') {
      const dx = position.x - drag.startX;
      const dy = position.y - drag.startY;
      if (!drag.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 4) {
        drag.axis = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
      }
      if (!drag.axis) return;
      if (drag.axis === 'horizontal') {
        const deltaSeconds = (dx / position.width) * duration;
        const positions = handlePositions(
          drag.startTrim,
          duration,
          position.width,
        );
        const seededFadeIn =
          ((positions.fadeInX - positions.startX) / position.width) * duration;
        const seededFadeOut =
          ((positions.endX - positions.fadeOutX) / position.width) * duration;
        if (drag.target === 'fadeIn') {
          const base =
            drag.startTrim.fadeInSeconds > 0.001
              ? drag.startTrim.fadeInSeconds
              : seededFadeIn;
          next.fadeInSeconds = clamp(base + deltaSeconds, 0, selection * 0.45);
        } else {
          const base =
            drag.startTrim.fadeOutSeconds > 0.001
              ? drag.startTrim.fadeOutSeconds
              : seededFadeOut;
          next.fadeOutSeconds = clamp(base - deltaSeconds, 0, selection * 0.45);
        }
      } else {
        const curveDelta = -dy / Math.max(1, position.height * (2 / 3));
        if (drag.target === 'fadeIn')
          next.fadeInCurve = clamp(
            drag.startTrim.fadeInCurve + curveDelta,
            -1,
            1,
          );
        else
          next.fadeOutCurve = clamp(
            drag.startTrim.fadeOutCurve + curveDelta,
            -1,
            1,
          );
      }
    }

    next.fadeInSeconds = clamp(next.fadeInSeconds, 0, selection * 0.45);
    next.fadeOutSeconds = clamp(next.fadeOutSeconds, 0, selection * 0.45);
    propsRef.current.onTrimChange(next);
  };

  const finishDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && drag.target !== 'scrub') onEditCommit?.();
  };

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full touch-none rounded-[13px] outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => {
        finishDrag();
        if (canvasRef.current?.hasPointerCapture(event.pointerId))
          canvasRef.current.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      role="application"
      tabIndex={0}
      aria-label="Audio waveform. Drag gold cut handles. Drag fade handles left or right for duration and up or down for curve."
    />
  );
}
