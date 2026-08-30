'use client';

import { useEffect, useRef } from 'react';

import { clamp, type TrimSettings } from '@/lib/studio';

type DragTarget = 'trimStart' | 'trimEnd' | 'fadeIn' | 'fadeOut' | 'scrub';

interface WaveformEditorProps {
  waveform: number[];
  duration: number;
  currentTime: number;
  trim: TrimSettings;
  mastered: boolean;
  onSeek: (seconds: number) => void;
  onTrimChange: (trim: TrimSettings) => void;
}

export function WaveformEditor({
  waveform,
  duration,
  currentTime,
  trim,
  mastered,
  onSeek,
  onTrimChange,
}: WaveformEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragTarget | null>(null);
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
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, 'rgba(255,255,255,0.018)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.08)');
      context.fillStyle = gradient;
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

      const startX = duration > 0 ? (trim.startSeconds / duration) * width : 0;
      const endX = duration > 0 ? (trim.endSeconds / duration) * width : width;
      const fadeInX = duration > 0 ? ((trim.startSeconds + trim.fadeInSeconds) / duration) * width : startX;
      const fadeOutX = duration > 0 ? ((trim.endSeconds - trim.fadeOutSeconds) / duration) * width : endX;
      const center = height / 2;
      const barWidth = Math.max(1, width / Math.max(1, waveform.length) - 1.2);

      waveform.forEach((peak, index) => {
        const x = (index / Math.max(1, waveform.length - 1)) * width;
        const amplitude = Math.max(1.2, peak * (height * 0.36));
        const inSelection = x >= startX && x <= endX;
        context.fillStyle = mastered
          ? inSelection ? 'rgba(220,185,97,0.88)' : 'rgba(126,103,53,0.32)'
          : inSelection ? 'rgba(142,144,153,0.78)' : 'rgba(84,85,92,0.26)';
        context.beginPath();
        context.roundRect(x, center - amplitude, barWidth, amplitude * 2, Math.min(barWidth, 2));
        context.fill();
      });

      context.fillStyle = 'rgba(0,0,0,0.48)';
      context.fillRect(0, 0, Math.max(0, startX), height);
      context.fillRect(endX, 0, Math.max(0, width - endX), height);

      context.fillStyle = mastered ? 'rgba(217,179,89,0.026)' : 'rgba(122,125,133,0.025)';
      context.fillRect(startX, 0, Math.max(0, endX - startX), height);
      context.strokeStyle = mastered ? 'rgba(217,179,89,0.6)' : 'rgba(142,144,153,0.55)';
      context.strokeRect(startX + 0.5, 0.5, Math.max(1, endX - startX - 1), height - 1);

      if (trim.fadeInSeconds > 0.005) {
        context.strokeStyle = 'rgba(196,198,205,0.48)';
        context.beginPath();
        context.moveTo(startX, height);
        context.quadraticCurveTo(startX + (fadeInX - startX) * 0.3, height * 0.18, fadeInX, height * 0.15);
        context.stroke();
      }
      if (trim.fadeOutSeconds > 0.005) {
        context.strokeStyle = 'rgba(196,198,205,0.48)';
        context.beginPath();
        context.moveTo(fadeOutX, height * 0.15);
        context.quadraticCurveTo(fadeOutX + (endX - fadeOutX) * 0.7, height * 0.18, endX, height);
        context.stroke();
      }

      const drawHandle = (x: number, label: string, primary: boolean) => {
        context.fillStyle = primary ? '#d9b359' : 'rgba(218,218,224,0.7)';
        context.fillRect(x - 1, 0, primary ? 2 : 1, height);
        context.fillStyle = primary ? '#d9b359' : '#6d6d76';
        const boxWidth = primary ? 28 : 34;
        const boxX = clamp(x - boxWidth / 2, 2, width - boxWidth - 2);
        context.beginPath();
        context.roundRect(boxX, primary ? height - 18 : 4, boxWidth, 14, 4);
        context.fill();
        context.fillStyle = primary ? '#17130b' : '#eeeef2';
        context.font = '700 7px ui-monospace, monospace';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(label, boxX + boxWidth / 2, primary ? height - 11 : 11);
      };
      drawHandle(startX, 'CUT', true);
      drawHandle(endX, 'CUT', true);
      if (trim.fadeInSeconds > 0.005) drawHandle(fadeInX, 'FADE IN', false);
      if (trim.fadeOutSeconds > 0.005) drawHandle(fadeOutX, 'FADE OUT', false);

      const playheadX = duration > 0 ? clamp((currentTime / duration) * width, 0, width) : 0;
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

  const updateFromPointer = (event: React.PointerEvent<HTMLCanvasElement>, initial = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const { duration: fullDuration, trim: currentTrim } = propsRef.current;
    if (fullDuration <= 0) return;
    const seconds = (x / rect.width) * fullDuration;
    const toX = (value: number) => (value / fullDuration) * rect.width;

    if (initial) {
      const targets: Array<[DragTarget, number]> = [
        ['trimStart', toX(currentTrim.startSeconds)],
        ['trimEnd', toX(currentTrim.endSeconds)],
        ['fadeIn', toX(currentTrim.startSeconds + currentTrim.fadeInSeconds)],
        ['fadeOut', toX(currentTrim.endSeconds - currentTrim.fadeOutSeconds)],
      ];
      const nearest = targets
        .map(([target, position]) => [target, Math.abs(position - x)] as const)
        .sort((a, b) => a[1] - b[1])[0];
      dragRef.current = nearest && nearest[1] <= 18 ? nearest[0] : 'scrub';
      canvas.setPointerCapture(event.pointerId);
    }

    const target = dragRef.current;
    if (target === 'scrub') {
      propsRef.current.onSeek(clamp(seconds, currentTrim.startSeconds, currentTrim.endSeconds));
      return;
    }

    const next = { ...currentTrim };
    if (target === 'trimStart') next.startSeconds = clamp(seconds, 0, next.endSeconds - 0.2);
    if (target === 'trimEnd') next.endSeconds = clamp(seconds, next.startSeconds + 0.2, fullDuration);
    const selection = next.endSeconds - next.startSeconds;
    if (target === 'fadeIn') next.fadeInSeconds = clamp(seconds - next.startSeconds, 0, selection * 0.45);
    if (target === 'fadeOut') next.fadeOutSeconds = clamp(next.endSeconds - seconds, 0, selection * 0.45);
    next.fadeInSeconds = clamp(next.fadeInSeconds, 0, selection * 0.45);
    next.fadeOutSeconds = clamp(next.fadeOutSeconds, 0, selection * 0.45);
    propsRef.current.onTrimChange(next);
  };

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full touch-none rounded-[13px] outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
      onPointerDown={(event) => updateFromPointer(event, true)}
      onPointerMove={(event) => {
        if (dragRef.current) updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        canvasRef.current?.releasePointerCapture(event.pointerId);
        dragRef.current = null;
      }}
      onPointerCancel={() => { dragRef.current = null; }}
      role="application"
      tabIndex={0}
      aria-label="Audio waveform. Drag the gold cut handles, gray fade handles, or scrub the playhead."
    />
  );
}
