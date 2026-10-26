import { create } from 'zustand';

export interface Notice {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

let seq = 0;

/** Short messages shown at the bottom of the operator window, e.g. import results. */
export const useNotices = create<{ notices: Notice[] }>(() => ({ notices: [] }));

export function dismiss(id: number) {
  useNotices.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
}

export function notify(text: string, kind: Notice['kind'] = 'info', ms = kind === 'error' ? 9000 : 5000): number {
  const id = ++seq;
  useNotices.setState((s) => ({ notices: [...s.notices, { id, text, kind }] }));
  if (ms > 0) setTimeout(() => dismiss(id), ms);
  return id;
}
