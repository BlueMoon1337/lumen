import { DEFAULT_APP_ICON } from './appIcons';
import { getSequence } from './lyrics';
import { adjacentPlaylistItem, type AppState } from './store';
import { copyrightLine, resolveTheme, slideTheme, toFrameBackground } from './theme';
import { effectiveTransition, mediaTransitionOf, transitionDuration } from './transitions';
import { screenLook } from './looks';
import { countdownFade } from './countdowns';
import { slideWords } from './slideshows';
import { layoutFor } from './stageLayouts';
import type { FrameBackground, OutputFrame, Presentation, SequenceEntry, SlidePicture } from './types';

const label = (p: Presentation, groupName: string) => `${p.title} · ${groupName}`;

/** Derives what the outputs should show from the operator's state. */
export function buildFrame(s: AppState): OutputFrame {
  const ref = s.live.slide;
  const p = ref ? s.presentations[ref.presentationId] : undefined;
  const seq = p ? getSequence(p) : [];
  const entry = ref ? seq[ref.index] : undefined;
  const theme = slideTheme(resolveTheme(s, p), p, entry?.slide);

  let next: { text: string; label: string; notes?: string; presentation: Presentation; entry: SequenceEntry } | null = null;
  if (p && ref && entry) {
    const following = seq[ref.index + 1];
    if (following) {
      next = {
        text: slideWords(following.slide),
        label: label(p, following.group.name),
        notes: following.slide.notes,
        presentation: p,
        entry: following,
      };
    } else if (s.settings.advanceAcrossItems) {
      const item = adjacentPlaylistItem(s, ref.playlistItemId, 1);
      const np = item && s.presentations[item.presentationId];
      const first = np ? getSequence(np)[0] : undefined;
      if (np && first)
        next = {
          text: slideWords(first.slide),
          label: label(np, first.group.name),
          notes: first.slide.notes,
          presentation: np,
          entry: first,
        };
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
          background: entry.slide.background,
          picture: entry.slide.source?.picture,
        }
      : null;
  // Media from the media bin replaces slide backgrounds; so does a camera, which shows underneath.
  const loops = (id: string) => (s.media.find((m) => m.id === id)?.playback ?? 'loop') === 'loop';
  // Theme and slide background videos loop unless the video says otherwise.
  const withLoop = (bg: FrameBackground | null): FrameBackground | null => (bg?.kind === 'media' ? { ...bg, loop: loops(bg.mediaId) } : bg);
  const background: FrameBackground | null = s.live.mediaId
    ? {
        key: `m:${s.live.mediaId}:${s.live.mediaRestart}`,
        kind: 'media',
        mediaId: s.live.mediaId,
        paused: s.live.mediaPaused,
        live: true,
        loop: loops(s.live.mediaId),
        seek: s.live.mediaSeek,
        // A countdown's sound fades away as it ends (src/countdowns.ts).
        ...(s.media.find((m) => m.id === s.live.mediaId)?.countdown && countdownFade(s.settings).videos
          ? { fadeOut: countdownFade(s.settings).seconds }
          : {}),
      }
    : slide && entry && !s.live.videoInput
      ? withLoop(toFrameBackground(entry.slide.background ?? theme.background))
      : null;

  // The Announcements layer: its own slide, theme and background, over the slides.
  const aRef = s.live.announcement;
  const ap = aRef ? s.presentations[aRef.presentationId] : undefined;
  const aEntry = ap && aRef ? getSequence(ap)[aRef.index] : undefined;
  const aTheme = ap && aEntry ? slideTheme(resolveTheme(s, ap), ap, aEntry.slide) : undefined;
  const announcement =
    ap && aEntry && aTheme && aRef
      ? {
          key: `${ap.id}:${aRef.index}`,
          text: aEntry.slide.text,
          caption: aEntry.slide.caption,
          theme: aTheme,
          background: withLoop(toFrameBackground(aEntry.slide.background ?? aTheme.background)),
          picture: aEntry.slide.source?.picture,
        }
      : null;

  // Show Slide on Stage Screens Only: the stage shows that slide (and the one after it) instead.
  const sRef = s.live.stageSlide;
  const sp = sRef ? s.presentations[sRef.presentationId] : undefined;
  const sSeq = sp ? getSequence(sp) : [];
  const sEntry = sRef ? sSeq[sRef.index] : undefined;
  const sNext = sRef ? sSeq[sRef.index + 1] : undefined;
  const picture = (q: Presentation, e: SequenceEntry | undefined): SlidePicture | null =>
    e
      ? {
          text: e.slide.text,
          caption: e.slide.caption,
          theme: slideTheme(resolveTheme(s, q), q, e.slide),
          background: e.slide.background,
          media: e.slide.media,
          picture: e.slide.source?.picture,
        }
      : null;
  const stage =
    sp && sEntry
      ? {
          title: sp.title,
          current: slideWords(sEntry.slide),
          currentLabel: label(sp, sEntry.group.name),
          next: sNext ? slideWords(sNext.slide) : null,
          nextLabel: sNext ? label(sp, sNext.group.name) : null,
          notes: sEntry.slide.notes ?? null,
          nextNotes: sNext?.slide.notes ?? null,
          currentSlide: picture(sp, sEntry),
          nextSlide: picture(sp, sNext),
        }
      : {
          title: p?.title ?? null,
          current: entry ? slideWords(entry.slide) : null,
          currentLabel: p && entry ? label(p, entry.group.name) : null,
          next: next?.text ?? null,
          nextLabel: next?.label ?? null,
          notes: entry?.slide.notes ?? null,
          nextNotes: next?.notes ?? null,
          currentSlide: p ? picture(p, entry) : null,
          nextSlide: next ? picture(next.presentation, next.entry) : null,
        };

  const fadeMs = s.settings.lookFadeMs ?? 1000;
  const looks = Object.fromEntries(
    s.screens.screens.filter((sc) => sc.kind === 'audience').map((sc) => [sc.id, screenLook(s.liveLook, sc.id, s.themes, fadeMs)]),
  );
  const stageLayouts = Object.fromEntries(
    s.screens.screens.filter((sc) => sc.kind === 'stage').map((sc) => [sc.id, layoutFor(sc, s.stageLayouts)]),
  );

  return {
    slide,
    background,
    message: message ? { key: message.id, text: message.text } : null,
    announcement,
    videoInput: s.live.videoInput ? { deviceId: s.live.videoInput.deviceId } : null,
    logoMediaId: s.live.logo ? (s.settings.logoMediaId ?? null) : null,
    transition: effectiveTransition(s.settings, p, entry?.slide),
    mediaTransition: mediaTransitionOf(s.settings),
    announcementTransition: effectiveTransition(s.settings, ap, aEntry?.slide),
    fadeMs: transitionDuration(s.settings.transition),
    fonts: s.fonts,
    appIcon: s.settings.appIcon ?? DEFAULT_APP_ICON,
    screens: s.screens,
    screenTools: s.screenTools,
    timer: s.timer,
    stage: { ...stage, message: s.live.stageMessage },
    looks,
    stageLayouts,
  };
}
