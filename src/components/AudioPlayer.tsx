import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { countdownFade, countdownVolume } from '../countdowns';
import { useMedia } from '../media';
import { useStore } from '../store';
import { liveVideoElement } from './MediaClock';

/** Where the playing audio is, for the transport. */
export const useAudioStatus = create<{ time: number; duration: number }>(() => ({ time: 0, duration: 0 }));

let element: HTMLAudioElement | null = null;
/** The Audio layer's element: the capture records its sound. */
export const audioElement = () => element;

export function seekAudio(seconds: number) {
  if (element && Number.isFinite(seconds)) element.currentTime = Math.max(0, seconds);
}

const FADE_MS = 600;

/**
 * Plays the Audio layer on this computer, as ProPresenter does (outputs only play a video's own
 * sound). Clearing it fades the sound out rather than cutting it off; a track that ends plays the
 * next one in its audio playlist, or clears it.
 */
export function AudioPlayer() {
  const audioId = useStore((s) => s.live.audioId);
  const paused = useStore((s) => s.live.audioPaused);
  const restart = useStore((s) => s.live.audioRestart);
  // The track loaded, kept while it fades out after being cleared.
  const [playing, setPlaying] = useState<string | null>(audioId);
  const loop = useStore((s) => !!s.media.find((m) => m.id === playing)?.loop);
  const media = useMedia(playing);
  const ref = useRef<HTMLAudioElement>(null);
  const fade = useRef<number | null>(null);

  useEffect(() => {
    element = ref.current;
    return () => {
      element = null;
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (fade.current) clearInterval(fade.current);
    fade.current = null;
    if (audioId) {
      if (el) el.volume = 1;
      setPlaying(audioId);
      return;
    }
    if (!el || el.paused) {
      setPlaying(null);
      return;
    }
    const start = el.volume;
    const began = performance.now();
    fade.current = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - began) / FADE_MS);
      el.volume = start * (1 - t);
      if (t >= 1) {
        if (fade.current) clearInterval(fade.current);
        fade.current = null;
        el.pause();
        setPlaying(null);
      }
    }, 30);
  }, [audioId]);

  // Countdown Fade: a countdown video on the Media layer, or the Timers tab's countdown, takes the
  // music down over its last seconds, and when it's over the Audio layer clears. If the countdown
  // goes (or the timer is paused or reset) before its end, the music comes back up.
  const fadeSettings = useStore(useShallow((s) => countdownFade(s.settings)));
  const videoCountdown = useStore((s) => fadeSettings.videos && !!s.media.find((m) => m.id === s.live.mediaId)?.countdown);
  const timerRunning = useStore((s) => fadeSettings.timer && s.timer.running && s.timer.endsAt !== null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !audioId) return;
    if ((!videoCountdown && !timerRunning) || fadeSettings.seconds <= 0) {
      if (!fade.current) el.volume = 1;
      return;
    }
    const tick = window.setInterval(() => {
      if (fade.current) return;
      const left: number[] = [];
      // A countdown that's already over (a video holding its last frame, a timer running into overtime)
      // leaves music started after it alone.
      const v = videoCountdown ? liveVideoElement() : null;
      if (v && !v.ended && Number.isFinite(v.duration) && v.duration > 0) left.push(v.duration - v.currentTime);
      const endsAt = timerRunning ? useStore.getState().timer.endsAt : null;
      if (endsAt !== null && endsAt - Date.now() > -1000) left.push((endsAt - Date.now()) / 1000);
      if (!left.length) return;
      const remaining = Math.min(...left);
      el.volume = countdownVolume(remaining, fadeSettings.seconds);
      if (remaining <= 0.1) useStore.getState().clearLayers(['audio']);
    }, 50);
    return () => window.clearInterval(tick);
  }, [videoCountdown, timerRunning, audioId, fadeSettings.seconds]);

  // A new track, or the same one again, starts from the top.
  useEffect(() => {
    const el = ref.current;
    if (!el || !media || !audioId) return;
    el.currentTime = 0;
    if (!useStore.getState().live.audioPaused) void el.play().catch(() => {});
  }, [media, restart, audioId]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !media || !audioId) return;
    if (paused) el.pause();
    else void el.play().catch(() => {});
  }, [paused, media, audioId]);

  const report = () => {
    const el = ref.current;
    if (el) useAudioStatus.setState({ time: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : 0 });
  };

  return (
    <audio
      ref={ref}
      src={media?.url}
      loop={loop}
      preload="auto"
      onTimeUpdate={report}
      onLoadedMetadata={report}
      onEnded={() => useStore.getState().audioEnded()}
      hidden
    />
  );
}
