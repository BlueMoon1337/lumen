import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useMedia } from '../media';
import { useStore } from '../store';

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
 * sound). Clearing it fades the sound out rather than cutting it off; a track that ends clears it.
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
      onEnded={() => useStore.getState().clearLayers(['audio'])}
      hidden
    />
  );
}
