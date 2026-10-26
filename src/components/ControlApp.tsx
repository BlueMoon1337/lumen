import { useCallback, useEffect, useState } from 'react';
import { registerFonts } from '../fonts';
import { startFrameSync } from '../liveFrame';
import { dismiss, useNotices } from '../notices';
import { setScreensEnabled, startScreenManager } from '../outputs';
import { useStore } from '../store';
import { isTypingTarget } from '../util';
import { ScriptureDialog, SettingsDialog } from './Dialogs';
import { EditView } from './EditView';
import { LivePanel } from './LivePanel';
import { MediaContent, MediaSidebar } from './MediaBin';
import { ReflowView } from './ReflowView';
import { ScreenConfigDialog } from './ScreenConfig';
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

const toggleScreens = (kind: 'audience' | 'stage') => {
  const { screens } = useStore.getState();
  setScreensEnabled(kind, !(kind === 'audience' ? screens.audienceEnabled : screens.stageEnabled));
};

/**
 * The Screens menu (ProPresenter's ⌘1, ⌘2 and ⌥⌘1). The desktop app's menu
 * handles the keys itself; in a browser they're caught here, where Chrome may
 * keep ⌘1/⌘2 for switching tabs.
 */
function useScreenCommands(configure: () => void) {
  useEffect(() => {
    const run = (command: string) => {
      if (command === 'toggle-audience') toggleScreens('audience');
      else if (command === 'toggle-stage') toggleScreens('stage');
      else if (command === 'configure-screens') configure();
      else if (command === 'identify-screens') {
        const s = useStore.getState();
        s.setScreenTools({ identify: !s.screenTools.identify });
      }
    };
    const bridge = window.lumenDesktop;
    if (bridge) return bridge.onMenu(run);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      // e.code, because ⌥1 types "¡" on a Mac.
      const keys: Record<string, string> = e.altKey
        ? { Digit1: 'configure-screens' }
        : { Digit1: 'toggle-audience', Digit2: 'toggle-stage' };
      const command = keys[e.code];
      if (!command) return;
      e.preventDefault();
      run(command);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [configure]);
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
  const [dialog, setDialog] = useState<'scripture' | 'settings' | 'screens' | null>(null);
  const mode = useStore((s) => s.mode);
  const showMediaBin = useStore((s) => s.showMediaBin);
  const editingTheme = useStore((s) => s.editingThemeId);

  const fonts = useStore((s) => s.fonts);

  useEffect(() => startFrameSync(), []);
  useEffect(() => startScreenManager(), []);
  const openScreens = useCallback(() => setDialog('screens'), []);
  useScreenCommands(openScreens);
  useEffect(() => {
    void registerFonts(fonts);
  }, [fonts]);
  useShortcuts(dialog === null && !editingTheme);

  return (
    <div className={`app mode-${mode} ${mode === 'show' && !showMediaBin ? 'no-media' : ''}`}>
      <Toolbar onBible={() => setDialog('scripture')} onSettings={() => setDialog('settings')} onScreens={openScreens} />
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
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} onScreens={openScreens} />}
      {dialog === 'screens' && <ScreenConfigDialog onClose={() => setDialog(null)} />}
      {editingTheme && <ThemeEditorDialog />}
      <Notices />
    </div>
  );
}
