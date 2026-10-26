import { useEffect, useState } from 'react';
import { startFrameSync } from '../liveFrame';
import { dismiss, useNotices } from '../notices';
import { useStore } from '../store';
import { isTypingTarget } from '../util';
import { ScriptureDialog, SettingsDialog } from './Dialogs';
import { EditView } from './EditView';
import { LivePanel } from './LivePanel';
import { MediaContent, MediaSidebar } from './MediaBin';
import { ReflowView } from './ReflowView';
import { ShowView } from './ShowView';
import { Sidebar } from './Sidebar';
import { ThemeEditorDialog } from './ThemeEditor';
import { Toolbar } from './Toolbar';

function useShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useStore.getState();
      // Clearing works from every mode; slide navigation only in Show,
      // where Edit's arrow keys nudge the selected text box instead.
      const clears: Record<string, () => void> = {
        F1: s.clearAll,
        F2: s.clearSlide,
        F3: s.clearMedia,
        F4: () => s.showMessage(null),
        F6: s.toggleLogo,
      };
      const navigation: Record<string, () => void> = {
        ArrowRight: s.next,
        ArrowDown: s.next,
        PageDown: s.next,
        ' ': s.next,
        ArrowLeft: s.prev,
        ArrowUp: s.prev,
        PageUp: s.prev,
      };
      const action = clears[e.key] ?? (s.mode === 'show' ? navigation[e.key] : undefined);
      if (action) {
        e.preventDefault();
        action();
      } else if (s.mode === 'show' && /^[a-z]$/i.test(e.key) && !e.shiftKey) {
        s.jumpToGroup(e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

function Notices() {
  const notices = useNotices((s) => s.notices);
  if (!notices.length) return null;
  return (
    <div className="notices" role="status">
      {notices.map((n) => (
        <div key={n.id} className={`notice ${n.kind}`} onClick={() => dismiss(n.id)} title="Dismiss">
          {n.text}
        </div>
      ))}
    </div>
  );
}

export default function ControlApp() {
  const [dialog, setDialog] = useState<'scripture' | 'settings' | null>(null);
  const mode = useStore((s) => s.mode);
  const showMediaBin = useStore((s) => s.showMediaBin);
  const editingTheme = useStore((s) => s.editingThemeId);

  useEffect(() => startFrameSync(), []);
  useShortcuts(dialog === null && !editingTheme);

  return (
    <div className={`app mode-${mode} ${mode === 'show' && !showMediaBin ? 'no-media' : ''}`}>
      <Toolbar onBible={() => setDialog('scripture')} onSettings={() => setDialog('settings')} />
      {mode === 'show' && (
        <>
          <Sidebar />
          <main className="center">
            <ShowView />
          </main>
          {showMediaBin && (
            <>
              <MediaSidebar />
              <MediaContent />
            </>
          )}
          <LivePanel />
        </>
      )}
      {mode === 'edit' && <EditView />}
      {mode === 'reflow' && <ReflowView />}
      {dialog === 'scripture' && <ScriptureDialog onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {editingTheme && <ThemeEditorDialog />}
      <Notices />
    </div>
  );
}
