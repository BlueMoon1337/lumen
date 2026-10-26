import { DEFAULT_APP_ICON } from './appIcons';
import { getSequence } from './lyrics';
import { adjacentPlaylistItem, type AppState } from './store';
import { copyrightLine, resolveTheme, slideTheme, toFrameBackground } from './theme';
import { effectiveTransition, transitionDuration } from './transitions';
import type { FrameBackground, OutputFrame, Presentation } from './types';

const label = (p: Presentation, groupName: string) => `${p.title} · ${groupName}`;

/** Derives what the outputs should show from the operator's state. */
export function buildFrame(s: AppState): OutputFrame {
  const ref = s.live.slide;
  const p = ref ? s.presentations[ref.presentationId] : undefined;
  const seq = p ? getSequence(p) : [];
  const entry = ref ? seq[ref.index] : undefined;
  const theme = slideTheme(resolveTheme(s, p), p, entry?.slide);

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
  const showCredit = p?.showCopyright && ref && (ref.index === 0 || ref.index === seq.length - 1);
  const slide =
    p && entry && ref
      ? {
          key: `${p.id}:${ref.index}`,
          text: entry.slide.text,
          caption: entry.slide.caption,
          footer: showCredit ? copyrightLine(p, s.settings) : undefined,
          theme,
        }
      : null;
  const background: FrameBackground | null = s.live.mediaId
    ? { key: `m:${s.live.mediaId}:${s.live.mediaRestart}`, kind: 'media', mediaId: s.live.mediaId, paused: s.live.mediaPaused }
    : slide && entry
      ? toFrameBackground(entry.slide.background ?? theme.background)
      : null;

  return {
    slide,
    background,
    message: message ? { key: message.id, text: message.text } : null,
    logoMediaId: s.live.logo ? (s.settings.logoMediaId ?? null) : null,
    transition: effectiveTransition(s.settings, p, entry?.slide),
    fadeMs: transitionDuration(s.settings.transition),
    fonts: s.fonts,
    appIcon: s.settings.appIcon ?? DEFAULT_APP_ICON,
    screens: s.screens,
    screenTools: s.screenTools,
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
