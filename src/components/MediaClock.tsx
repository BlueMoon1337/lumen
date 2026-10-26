import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useMedia } from '../media';
import { useStore } from '../store';

/** Where the live video is, for the transport. */
export const useMediaStatus = create<{ time: number; duration: number }>(() => ({ time: 0, duration: 0 }));

/**
 * Keeps time for the video on the Media layer in the operator window: a silent copy that
 * starts, pauses and seeks with the screens, so the transport can show where it is and Lumen
 * knows when it ends (to stop, clear or play the next, as the video is set to). Showing the
 * Stage preview, or no preview, doesn't stop it.
 */
export function MediaClock() {
  const mediaId = useStore((s) => s.live.mediaId);
  const item = useStore((s) => s.media.find((m) => m.id === s.live.mediaId && m.kind === 'video'));
  const paused = useStore((s) => s.live.mediaPaused);
  const restart = useStore((s) => s.live.mediaRestart);
  const seek = useStore((s) => s.live.mediaSeek);
  const media = useMedia(item ? mediaId : null);
  const ref = useRef<HTMLVideoElement>(null);
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
    if (!media) useMediaStatus.setState({ time: 0, duration: 0 });
  }, [media]);

  const report = () => {
    const v = ref.current;
    if (v) useMediaStatus.setState({ time: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : 0 });
  };

  return (
    <video
      ref={ref}
      className="media-clock"
      src={media?.url}
      muted
      playsInline
      preload="auto"
      loop={(item?.playback ?? 'loop') === 'loop'}
      onTimeUpdate={report}
      onLoadedMetadata={report}
      onEnded={() => useStore.getState().mediaEnded()}
      hidden
    />
  );
}
