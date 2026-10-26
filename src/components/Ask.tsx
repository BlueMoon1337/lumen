import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

/**
 * Lumen's own confirm, prompt and alert boxes. The Mac app's web view has none of the
 * browser's (there `confirm()` always answers no, so nothing could be deleted), so every
 * question the app asks goes through these.
 */

export interface AskOptions {
  title: string;
  message?: string;
  /** The button that says yes: "Delete", "Replace"… */
  confirmLabel?: string;
  /** A red button, for something that throws work away. */
  danger?: boolean;
}

export interface PromptOptions extends AskOptions {
  defaultValue?: string;
  placeholder?: string;
}

interface Pending extends PromptOptions {
  kind: 'confirm' | 'prompt' | 'alert';
  seq: number;
  /** The text typed for a prompt, "" for yes to a confirm or OK to an alert, null for Cancel. */
  resolve: (answer: string | null) => void;
}

const useAsk = create<{ pending: Pending | null }>(() => ({ pending: null }));
let seq = 0;

function ask(kind: Pending['kind'], options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    // A new question cancels one left open.
    useAsk.getState().pending?.resolve(null);
    useAsk.setState({ pending: { ...options, kind, seq: ++seq, resolve } });
  });
}

/** Asks a yes-or-no question; true for yes. */
export const confirmDialog = (options: AskOptions) => ask('confirm', options).then((a) => a !== null);

/** Asks for a line of text; null when cancelled. */
export const promptDialog = (options: PromptOptions) => ask('prompt', options);

/** Tells the operator something that needs an OK. */
export const alertDialog = (options: AskOptions) => ask('alert', options).then(() => undefined);

/** Asks, then does it if the answer is yes. */
export function confirmThen(options: AskOptions, action: () => void) {
  void confirmDialog(options).then((yes) => yes && action());
}

/** Whether a question is open (keys belong to it, not to the slide shortcuts). */
export const isAsking = () => !!useAsk.getState().pending;

/** Renders the open question. Mount once, in the control window. */
export function AskHost() {
  const pending = useAsk((s) => s.pending);
  return pending ? <AskBox key={pending.seq} ask={pending} /> : null;
}

function AskBox({ ask }: { ask: Pending }) {
  const [value, setValue] = useState(ask.defaultValue ?? '');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const answer = (a: string | null) => {
    if (useAsk.getState().pending === ask) useAsk.setState({ pending: null });
    ask.resolve(a);
  };
  const ok = () => {
    if (ask.kind !== 'prompt') return answer('');
    if (value.trim()) answer(value.trim());
  };

  useEffect(() => {
    if (ask.kind !== 'prompt') confirmRef.current?.focus();
    // Escape and Return answer, wherever the focus is; the window's other keys wait.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(ask.kind === 'alert' ? '' : null);
      else if (e.key === 'Enter' && !e.isComposing) ok();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div
      className="dialog-backdrop ask-backdrop"
      // Keep the focus in the box, and keep keys from reaching the window's shortcuts.
      onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}
      onKeyDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={`dialog ask ${ask.kind}`} role="alertdialog" aria-modal="true" aria-label={ask.title}>
        <div className="dialog-body">
          <h2 className="ask-title">{ask.title}</h2>
          {ask.message && <p className="ask-message">{ask.message}</p>}
          {ask.kind === 'prompt' && (
            <input
              autoFocus
              value={value}
              placeholder={ask.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.target.select()}
              aria-label={ask.title}
            />
          )}
          <div className="dialog-actions">
            {ask.kind !== 'alert' && (
              <button className="btn" onClick={() => answer(null)}>
                Cancel
              </button>
            )}
            <button
              ref={confirmRef}
              className={`btn ${ask.danger ? 'destructive' : 'primary'}`}
              disabled={ask.kind === 'prompt' && !value.trim()}
              onClick={ok}
            >
              {ask.confirmLabel ?? 'OK'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
