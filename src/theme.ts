import { defaultThemes } from './seed';
import type { FrameBackground, Presentation, Settings, Slide, TextStyle, Theme, ThemeBackground } from './types';

export function resolveTheme(s: { themes: Theme[]; settings: Settings }, p?: Presentation): Theme {
  return (
    s.themes.find((t) => t.id === p?.themeId) ?? s.themes.find((t) => t.id === s.settings.defaultThemeId) ?? s.themes[0] ?? defaultThemes[0]
  );
}

/** Theme, then presentation formatting, then slide formatting. Returns `theme` itself when nothing overrides it. */
export function applyStyles(theme: Theme, ...styles: (TextStyle | undefined)[]): Theme {
  let out = theme;
  for (const style of styles) {
    if (!style) continue;
    for (const [k, v] of Object.entries(style)) {
      if (v === undefined) continue;
      if (out === theme) out = { ...theme };
      (out as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export function slideTheme(theme: Theme, p: Presentation | undefined, slide: Slide | undefined): Theme {
  return applyStyles(theme, p?.style, slide?.style);
}

export function toFrameBackground(bg: ThemeBackground): FrameBackground | null {
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

/** The CCLI-style credit line shown when a presentation has "Show on screen" turned on. */
export function copyrightLine(p: Presentation, settings: Settings): string {
  const credit = [p.title, p.author || p.artist].filter(Boolean).join(' — ');
  const rights = p.copyright || [p.year && `© ${p.year}`, p.publisher].filter(Boolean).join(' ');
  return [credit, rights, p.ccli && `CCLI Song # ${p.ccli}`, settings.ccliLicense && `CCLI License # ${settings.ccliLicense}`]
    .filter(Boolean)
    .join(' · ');
}

/** Readable label text on a group color. */
export function inkFor(hex: string): string {
  const m = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return '#fff';
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#3a3a3a' : '#fff';
}

export const FONT_CHOICES = [
  { label: 'Helvetica / Arial', value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: 'System UI', value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet', value: '"Trebuchet MS", sans-serif' },
  { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
  { label: 'Courier', value: '"Courier New", Courier, monospace' },
];

export const fontLabel = (value: string) => FONT_CHOICES.find((f) => f.value === value)?.label ?? value.split(',')[0].replace(/"/g, '');
