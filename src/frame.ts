import { useEffect, useState } from 'react';
import { getSequence } from './lyrics';
import { defaultThemes } from './seed';
import { adjacentPlaylistItem, type AppState } from './store';
import type { FrameBackground, OutputFrame, Presentation, Theme } from './types';

export function resolveTheme(s: Pick<AppState, 'themes' | 'settings'>, p?: Presentation): Theme {
  return (
    s.themes.find((t) => t.id === p?.themeId) ?? s.themes.find((t) => t.id === s.settings.defaultThemeId) ?? s.themes[0] ?? defaultThemes[0]
  );
}

function themeBackground(theme: Theme): FrameBackground | null {
  const bg = theme.background;
  switch (bg.type) {
    case 'color':
      return { key: `c:${bg.color}`, kind: 'color', color: bg.color };
    case 'gradient':
      return { key: `g:${bg.color}:${bg.color2}`, kind: 'gradient', color: bg.color, color2: bg.color2 };
    case 'media':
      return bg.mediaId ? { key: `m:${bg.mediaId}`, kind: 'media', mediaId: bg.mediaId } : null;
    default:
      return null;
  }
}

const label = (p: Presentation, groupName: string) => `${p.title} · ${groupName}`;

/** Derives what the outputs should show from the operator's state. */
export function buildFrame(s: AppState): OutputFrame {
  const ref = s.live.slide;
  const p = ref ? s.presentations[ref.presentationId] : undefined;
  const seq = p ? getSequence(p) : [];
  const entry = ref ? seq[ref.index] : undefined;
  const theme = resolveTheme(s, p);

  let next: { text: string; label: string } | null = null;
  if (p && ref && entry) {
    const following = seq[ref.index + 1];
    if (following) {
      next = { text: following.slide.text, label: label(p, following.group.name) };
    } else if (s.settings.advanceAcrossItems) {
      const item = adjacentPlaylistItem(s, ref.playlistItemId, 1);
      const np = item && s.presentations[item.presentationId];
      const first = np ? getSequence(np)[0] : undefined;
      if (np && first) next = { text: first.slide.text, label: label(np, first.group.name) };
    }
  }

  const message = s.messages.find((m) => m.id === s.live.messageId);
  const slide = p && entry && ref ? { key: `${p.id}:${ref.index}`, text: entry.slide.text, caption: entry.slide.caption, theme } : null;
  const background: FrameBackground | null = s.live.mediaId
    ? { key: `m:${s.live.mediaId}`, kind: 'media', mediaId: s.live.mediaId }
    : slide
      ? themeBackground(theme)
      : null;

  return {
    slide,
    background,
    message: message ? { key: message.id, text: message.text } : null,
    logoMediaId: s.live.logo ? (s.settings.logoMediaId ?? null) : null,
    transitionMs: s.settings.transitionMs,
    timer: s.timer,
    stage: {
      title: p?.title ?? null,
      current: entry ? entry.slide.text : null,
      currentLabel: p && entry ? label(p, entry.group.name) : null,
      next: next?.text ?? null,
      nextLabel: next?.label ?? null,
      notes: entry?.slide.notes ?? null,
      message: s.live.stageMessage,
    },
  };
}

// ---- Cross-window sync -------------------------------------------------

const CHANNEL = 'lumen-output';

type ChannelMessage = { type: 'frame'; frame: OutputFrame } | { type: 'hello' };

/** Control window: answers new output windows and pushes every change. */
export function startBroadcasting(getFrame: () => OutputFrame) {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent<ChannelMessage>) => {
    if (e.data?.type === 'hello') channel.postMessage({ type: 'frame', frame: getFrame() } satisfies ChannelMessage);
  };
  return {
    send: (frame: OutputFrame) => channel.postMessage({ type: 'frame', frame } satisfies ChannelMessage),
    close: () => channel.close(),
  };
}

/** Output windows: the latest frame from the control window. */
export function useRemoteFrame(): OutputFrame | null {
  const [frame, setFrame] = useState<OutputFrame | null>(null);
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent<ChannelMessage>) => {
      if (e.data?.type === 'frame') setFrame(e.data.frame);
    };
    channel.postMessage({ type: 'hello' } satisfies ChannelMessage);
    return () => channel.close();
  }, []);
  return frame;
}

/** Re-renders every `ms` so clocks and countdowns stay current. */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function timerRemaining(t: OutputFrame['timer'], now: number): number {
  return t.running && t.endsAt != null ? t.endsAt - now : t.remainingMs;
}
