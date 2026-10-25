import { useEffect, useState } from 'react';
import { startFrameSync } from '../liveFrame';
import { closeOutput, openOutput, useOpenOutputs, type OutputKind } from '../outputs';
import { useStore } from '../store';
import { isTypingTarget } from '../util';
import { BottomPanel, ThemeEditorDialog } from './BottomPanel';
import { ScriptureDialog, SettingsDialog } from './Dialogs';
import { LibraryPanel, PlaylistPanel } from './Library';
import { LivePanel } from './LivePanel';
import { PresentationPanel } from './PresentationPanel';
import { Icon } from './ui';

function useShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useStore.getState();
      const actions: Record<string, () => void> = {
        ArrowRight: s.next,
        ArrowDown: s.next,
        PageDown: s.next,
        ' ': s.next,
        ArrowLeft: s.prev,
        ArrowUp: s.prev,
        PageUp: s.prev,
        F1: s.clearAll,
        F2: s.clearSlide,
        F3: s.clearMedia,
        F4: () => s.showMessage(null),
        F6: s.toggleLogo,
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      } else if (/^[a-z]$/i.test(e.key) && !e.shiftKey && s.centerMode === 'show') {
        s.jumpToGroup(e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

function OutputToggle({ kind, label, open }: { kind: OutputKind; label: string; open: boolean }) {
  const display = useStore((s) => (kind === 'audience' ? s.settings.audienceDisplay : s.settings.stageDisplay));
  return (
    <button
      className={`btn output-toggle ${open ? 'on' : ''}`}
      onClick={() => (open ? closeOutput(kind) : openOutput(kind, display))}
      title={open ? `Close the ${label.toLowerCase()} window` : `Open the ${label.toLowerCase()} window`}
    >
      <span className="status-dot" />
      <Icon name="monitor" size={14} />
      {label}
    </button>
  );
}

export default function ControlApp() {
  const [dialog, setDialog] = useState<'scripture' | 'settings' | null>(null);
  const editingTheme = useStore((s) => s.editingThemeId);
  const outputs = useOpenOutputs();

  useEffect(() => startFrameSync(), []);
  useShortcuts(dialog === null && !editingTheme);

  const newSong = () => {
    const s = useStore.getState();
    const id = s.createPresentation({ title: 'Untitled Song' });
    s.select(id);
    s.setUI({ centerMode: 'edit' });
  };

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <img src="./icon.svg" alt="" width={22} height={22} />
          Lumen
        </div>
        <button className="btn" onClick={newSong}>
          <Icon name="music" size={14} /> New song
        </button>
        <button className="btn" onClick={() => setDialog('scripture')}>
          <Icon name="book" size={14} /> Scripture
        </button>
        <div className="toolbar-spacer" />
        <OutputToggle kind="audience" label="Audience" open={outputs.audience} />
        <OutputToggle kind="stage" label="Stage" open={outputs.stage} />
        <button className="icon-btn" onClick={() => setDialog('settings')} title="Settings" aria-label="Settings">
          <Icon name="gear" size={18} />
        </button>
      </header>
      <aside className="left">
        <LibraryPanel />
        <PlaylistPanel />
      </aside>
      <main className="center">
        <PresentationPanel />
      </main>
      <section className="bottom">
        <BottomPanel />
      </section>
      <aside className="right">
        <LivePanel />
      </aside>
      {dialog === 'scripture' && <ScriptureDialog onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {editingTheme && <ThemeEditorDialog />}
    </div>
  );
}
