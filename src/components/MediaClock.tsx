import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useMedia } from '../media';
import { useStore } from '../store';
import { countdownFade, countdownVolume } from '../countdowns';
import type { VideoClock } from '../types';

/** Where the live video is, for the transport. */
export const useMediaStatus = create<{ time: number; duration: number }>(() => ({ time: 0, duration: 0 }));

/**
 * When the live video ends, for stage layouts' Video Countdown: its end time while it plays, or
 * the time left while paused. Changes only when the video starts, stops, seeks or loops, so the
 * screens count down by themselves.
 */
export const useVideoClock = create<VideoClock>(() => ({ endsAt: null, remainingMs: null, endedAt: null }));

/**
 * The live video's clock: an audio player of the video's file, which plays its sound without
 * decoding its picture (the screens and the preview already decode it; a 4K countdown decoded a
 * third time stuttered as it faded out). The capture records its sound.
 */
let liveVideo: HTMLMediaElement | null = null;
export const liveVideoElement = () => liveVideo;

/**
 * Keeps time for the video on the Media layer in the operator window: a copy that starts, pauses
 * and seeks with the screens, so the transport can show where it is and Lumen knows when it ends
 * (to stop, clear or play the next, as the video is set to). It plays the video's sound, from this
 * computer, as the Audio layer does (the screens are silent: a projector window, never clicked,
 * may not be let play sound). Showing the Stage preview, or no preview, doesn't stop it.
 */
export function MediaClock() {
  const mediaId = useStore((s) => s.live.mediaId);
  const item = useStore((s) => s.media.find((m) => m.id === s.live.mediaId && m.kind === 'video'));
  const paused = useStore((s) => s.live.mediaPaused);
  const restart = useStore((s) => s.live.mediaRestart);
  const seek = useStore((s) => s.live.mediaSeek);
  const media = useMedia(item ? mediaId : null);
  const ref = useRef<HTMLAudioElement>(null);
  const seen = useRef(seek.n);

  useEffect(() => {
    const v = ref.current;
    if (!v || !media) return;
    v.currentTime = 0;
    seen.current = useStore.getState().live.mediaSeek.n;
    if (!useStore.getState().live.mediaPaused) void v.play().catch(() => {});
  }, [media, restart]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !media) return;
    if (paused) v.pause();
    else void v.play().catch(() => {});
  }, [paused, media]);

  useEffect(() => {
    const v = ref.current;
    if (!v || seek.n === seen.current) return;
    seen.current = seek.n;
    v.currentTime = seek.to;
  }, [seek]);

  useEffect(() => {
    if (media) return;
    useMediaStatus.setState({ time: 0, duration: 0 });
    // Cleared (the Logo button, a clear, another layer taking over): stop it. Taking its src away
    // isn't enough, as a video keeps playing what it loaded, and this copy plays the sound.
    const v = ref.current;
    if (v) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
  }, [media]);

  const report = () => {
    const v = ref.current;
    if (v) useMediaStatus.setState({ time: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : 0 });
  };
  const clock = () => {
    const v = ref.current;
    const left = v && media && Number.isFinite(v.duration) ? Math.max(0, (v.duration - v.currentTime) * 1000) : null;
    const next =
      left === null
        ? { endsAt: null, remainingMs: null }
        : v && !v.paused
          ? { endsAt: Math.round(Date.now() + left), remainingMs: null }
          : { endsAt: null, remainingMs: Math.round(left) };
    // Holding the last frame after it ended (a countdown) is still ended.
    if (v?.ended && next.endsAt === null) return;
    const now = useVideoClock.getState();
    // Within half a second is the same end: no need to send the screens a new frame.
    if (next.endsAt !== null && now.endsAt !== null && Math.abs(next.endsAt - now.endsAt) < 500) return;
    if (next.endsAt === now.endsAt && next.remainingMs === now.remainingMs && now.endedAt == null) return;
    useVideoClock.setState({ ...next, endedAt: null });
  };

  // A countdown's sound goes down with it over its last seconds (Countdown Fade's videos switch).
  const fadeOut = useStore((s) => (item?.countdown && countdownFade(s.settings).videos ? countdownFade(s.settings).seconds : 0));
  useEffect(() => {
    const v = ref.current;
    if (!v || !fadeOut || !media) return;
    const tick = window.setInterval(() => {
      if (Number.isFinite(v.duration) && v.duration > 0) v.volume = countdownVolume(v.duration - v.currentTime, fadeOut);
    }, 50);
    return () => {
      window.clearInterval(tick);
      v.volume = 1;
    };
  }, [fadeOut, media]);

  useEffect(() => {
    liveVideo = ref.current;
    return () => {
      liveVideo = null;
    };
  }, []);

  useEffect(() => {
    if (!media) useVideoClock.setState({ endsAt: null, remainingMs: null });
  }, [media]);

  return (
    <audio
      // Files from Documents ▸ Lumen come through the asset protocol; the capture records this sound.
      crossOrigin="anonymous"
      ref={ref}
      className="media-clock"
      src={media?.url}
      preload="auto"
      loop={(item?.playback ?? 'loop') === 'loop'}
      onTimeUpdate={report}
      onLoadedMetadata={() => (report(), clock())}
      onPlaying={clock}
      onPause={clock}
      onSeeked={clock}
      onRateChange={clock}
      onEnded={() => {
        useVideoClock.setState({ endsAt: null, remainingMs: 0, endedAt: Date.now() });
        useStore.getState().mediaEnded();
      }}
      hidden
    />
  );
}
