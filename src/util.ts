export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function formatDuration(ms: number): string {
  const negative = ms < 0;
  const total = Math.ceil(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

export function formatClock(date = new Date()): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Parses "5", "5:30" or "1:05:30" into milliseconds. */
export function parseDuration(text: string): number | null {
  const parts = text
    .trim()
    .split(':')
    .map((p) => Number(p));
  if (!parts.length || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  const seconds = parts.reduce((acc, p) => acc * 60 + p, 0) * (parts.length === 1 ? 60 : 1);
  return seconds * 1000;
}

/** Next epoch ms at which the wall clock reads "HH:MM". */
export function nextOccurrence(hhmm: string, now = Date.now()): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(now);
  d.setHours(h || 0, m || 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
