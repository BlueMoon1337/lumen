import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { countdownFade, countdownVolume, songCrossfade } from '../countdowns';
import { useMedia } from '../media';
import { nextAudio, useStore } from '../store';
import { liveVideoElement } from './MediaClock';

/** Where the playing audio is, for the transport. */
export const useAudioStatus = create<{ time: number; duration: number }>(() => ({ time: 0, duration: 0 }));

let element: HTMLAudioElement | null = null;
/** The Audio layer's element (the track playing now): the capture records its sound. */
export const audioElement = () => element;

export function seekAudio(seconds: number) {
  if (element && Number.isFinite(seconds)) element.currentTime = Math.max(0, seconds);
}

const FADE_MS = 600;

/** Two tracks crossfade at equal power, so the sound doesn't dip in the middle. */
const fadeIn = (t: number) => Math.sin((t * Math.PI) / 2);
const fadeOut = (t: number) => Math.cos((t * Math.PI) / 2);

/**
 * Plays the Audio layer on this computer, as ProPresenter does (outputs only play a video's own
 * sound). Clearing it fades the sound out rather than cutting it off; a track that ends plays the
 * next one in its audio playlist, or clears it.
 *
 * There are two players, so that with Crossfade Songs on, a track fades into the next: a playlist's
 * next track starts that many seconds before the end of the one playing, and a track started while
 * another plays fades in as the other fades out.
 */
export function AudioPlayer() {
  const audioId = useStore((s) => s.live.audioId);
  const paused = useStore((s) => s.live.audioPaused);
  const restart = useStore((s) => s.live.audioRestart);
  const crossfade = useStore(useShallow((s) => songCrossfade(s.settings)));
  // The track in each player (kept while it fades out), and which player is the Audio layer's.
  const [decks, setDecks] = useState<[string | null, string | null]>([audioId, null]);
  const [cur, setCur] = useState(0);
  const decksRef = useRef(decks);
  decksRef.current = decks;
  const curRef = useRef(cur);
  curRef.current = cur;
  const loops = useStore(useShallow((s) => decks.map((id) => !!s.media.find((m) => m.id === id)?.loop)));
  const mediaA = useMedia(decks[0]);
  const mediaB = useMedia(decks[1]);
  const media = [mediaA, mediaB];
  const refs = [useRef<HTMLAudioElement>(null), useRef<HTMLAudioElement>(null)];
  const el = (i: number) => refs[i].current;
  // Volume fades under way, by player; the Audio layer clearing; a crossfade asked for (the
  // playlist's next track coming in early); the player fading in.
  const ramps = useRef(new Map<HTMLAudioElement, number>());
  const clearing = useRef(false);
  const crossNext = useRef(false);
  const incoming = useRef<HTMLAudioElement | null>(null);
  // Seconds to fade the next track in over, once it has loaded.
  const inMs = useRef(0);

  const stopRamp = (a: HTMLAudioElement) => {
    const id = ramps.current.get(a);
    if (id !== undefined) window.clearInterval(id);
    ramps.current.delete(a);
  };
  const ramp = (a: HTMLAudioElement, rising: boolean, ms: number, done?: () => void) => {
    stopRamp(a);
    const start = a.volume;
    const began = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - began) / Math.max(1, ms));
      a.volume = rising ? Math.max(start, fadeIn(t)) : start * fadeOut(t);
      if (t >= 1) {
        stopRamp(a);
        done?.();
      }
    };
    ramps.current.set(a, window.setInterval(step, 30));
    step();
  };
  /** Stops a player and empties it, unless it has become the Audio layer's again. */
  const release = (i: number) => {
    const a = el(i);
    if (a) {
      stopRamp(a);
      a.pause();
    }
    if (i !== curRef.current || clearing.current) setDecks((d) => (i === 0 ? [null, d[1]] : [d[0], null]));
  };

  useEffect(() => {
    element = el(cur);
  });
  useEffect(
    () => () => {
      element = null;
      ramps.current.forEach((id) => window.clearInterval(id));
    },
    [],
  );

  // A new track: in the same player, or, crossfading, in the other one as this one fades out.
  useEffect(() => {
    const i = curRef.current;
    const a = el(i);
    const asked = crossNext.current;
    crossNext.current = false;
    if (!audioId) {
      // Cleared: whatever is playing fades out.
      clearing.current = true;
      let left = 0;
      [0, 1].forEach((j) => {
        const p = el(j);
        if (!p || p.paused) return release(j);
        left++;
        ramp(p, false, FADE_MS, () => {
          release(j);
          if (--left === 0) clearing.current = false;
        });
      });
      if (!left) clearing.current = false;
      return;
    }
    clearing.current = false;
    const { on, seconds } = songCrossfade(useStore.getState().settings);
    const playing = !!a && !a.paused && !!decksRef.current[i];
    if (on && playing && (asked || audioId !== decksRef.current[i])) {
      const o = 1 - i;
      const next = el(o);
      if (next) {
        stopRamp(next);
        next.pause();
        next.volume = 0;
        incoming.current = next;
      }
      const left = Number.isFinite(a.duration) ? (a.duration - a.currentTime) * 1000 : Infinity;
      inMs.current = seconds * 1000;
      ramp(a, false, Math.min(seconds * 1000, left), () => release(i));
      setDecks((d) => (o === 0 ? [audioId, d[1]] : [d[0], audioId]));
      setCur(o);
      return;
    }
    // Otherwise the track plays in this player, at full volume (the other one stops).
    const o = el(1 - i);
    if (o && !o.paused) release(1 - i);
    if (a) {
      stopRamp(a);
      a.volume = 1;
    }
    if (incoming.current === a) incoming.current = null;
    setDecks((d) => (i === 0 ? [audioId, d[1]] : [d[0], audioId]));
  }, [audioId, restart]);

  // Crossfade Songs: the next track in the playlist starts this many seconds before the end.
  useEffect(() => {
    if (!crossfade.on || !audioId || paused) return;
    let asked = false;
    const tick = window.setInterval(() => {
      const a = el(curRef.current);
      if (asked || !a || a.paused || a.loop || clearing.current || !Number.isFinite(a.duration) || a.duration <= 0) return;
      if (a.duration - a.currentTime > crossfade.seconds) return;
      asked = true;
      const s = useStore.getState();
      if (!s.live.audioId || !nextAudio(s, s.live.audioId, s.live.audioFrom, s.live.audioPlayed)) return;
      crossNext.current = true;
      s.audioEnded();
    }, 100);
    return () => window.clearInterval(tick);
  }, [crossfade.on, crossfade.seconds, audioId, restart, paused]);

  // Countdown Fade: a countdown video on the Media layer, or the Timers tab's countdown, takes the
  // music down over its last seconds, and when it's over the Audio layer clears. If the countdown
  // goes (or the timer is paused or reset) before its end, the music comes back up.
  const fadeSettings = useStore(useShallow((s) => countdownFade(s.settings)));
  const videoCountdown = useStore((s) => fadeSettings.videos && !!s.media.find((m) => m.id === s.live.mediaId)?.countdown);
  const timerRunning = useStore((s) => fadeSettings.timer && s.timer.running && s.timer.endsAt !== null);
  useEffect(() => {
    const a = el(cur);
    if (!a || !audioId) return;
    if (!videoCountdown && !timerRunning) {
      if (!clearing.current && !ramps.current.has(a) && incoming.current !== a) a.volume = 1;
      return;
    }
    const tick = window.setInterval(() => {
      if (clearing.current) return;
      const left: number[] = [];
      // A countdown that's already over (a video holding its last frame, a timer running into overtime)
      // leaves music started after it alone.
      const v = videoCountdown ? liveVideoElement() : null;
      if (v && !v.ended && Number.isFinite(v.duration) && v.duration > 0) left.push(v.duration - v.currentTime);
      const endsAt = timerRunning ? useStore.getState().timer.endsAt : null;
      if (endsAt !== null && endsAt - Date.now() > -1000) left.push((endsAt - Date.now()) / 1000);
      if (!left.length) return;
      const remaining = Math.min(...left);
      const p = el(curRef.current);
      if (p && !ramps.current.has(p) && incoming.current !== p) p.volume = countdownVolume(remaining, fadeSettings.seconds);
      if (remaining <= 0.1) useStore.getState().clearLayers(['audio']);
    }, 50);
    return () => window.clearInterval(tick);
  }, [videoCountdown, timerRunning, audioId, cur, fadeSettings.seconds]);

  // A new track, or the same one again, starts from the top (fading in, when it's crossfading).
  const current = media[cur];
  useEffect(() => {
    const a = el(curRef.current);
    // While a crossfade switches players, only the incoming one starts.
    if (!a || !current || !audioId || (incoming.current && incoming.current !== a)) return;
    a.currentTime = 0;
    if (useStore.getState().live.audioPaused) return;
    void a.play().catch(() => {});
    if (incoming.current === a) {
      ramp(a, true, inMs.current, () => {
        if (incoming.current === a) incoming.current = null;
      });
    }
  }, [current, restart, audioId, cur]);

  // Pausing pauses the track; one fading out stops.
  useEffect(() => {
    const a = el(curRef.current);
    if (!a || !current || !audioId) return;
    if (paused) {
      a.pause();
      const o = 1 - curRef.current;
      if (decksRef.current[o]) release(o);
    } else void a.play().catch(() => {});
  }, [paused, current, audioId]);

  const report = () => {
    const a = el(curRef.current);
    if (a) useAudioStatus.setState({ time: a.currentTime, duration: Number.isFinite(a.duration) ? a.duration : 0 });
  };

  return (
    <>
      {[0, 1].map((i) => (
        <audio
          key={i}
          ref={refs[i]}
          src={media[i]?.url}
          loop={i === cur && loops[i]}
          preload="auto"
          onTimeUpdate={() => i === curRef.current && report()}
          onLoadedMetadata={() => i === curRef.current && report()}
          onEnded={() => {
            if (i === curRef.current && decksRef.current[i]) useStore.getState().audioEnded();
            else release(i);
          }}
          hidden
        />
      ))}
    </>
  );
}
