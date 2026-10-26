import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { applyAppIcon } from '../appIcons';
import { registerFonts } from '../fonts';
import { startFrameSync } from '../liveFrame';
import { dismiss, useNotices } from '../notices';
import { setScreensEnabled, startScreenManager } from '../outputs';
import { useStore } from '../store';
import { isTypingTarget } from '../util';
import { BibleView } from './BibleView';
import { SettingsDialog } from './Dialogs';
import { EditView } from './EditView';
import { WelcomeDialog } from './IconChooser';
import { LivePanel } from './LivePanel';
import { MediaContent, MediaSidebar } from './MediaBin';
import { ReflowView } from './ReflowView';
import { ScreenConfigDialog } from './ScreenConfig';
import { ShowView } from './ShowView';
import { Sidebar } from './Sidebar';
import { DEFAULT_PANES, setPaneSize, Splitter } from './Splitter';
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
      // Bible mode's arrows step through the verse slides on screen.
      const bibleSteps: Record<string, () => void> = {
        ArrowRight: () => s.bibleStep(1),
        ArrowDown: () => s.bibleStep(1),
        PageDown: () => s.bibleStep(1),
        ' ': () => s.bibleStep(1),
        ArrowLeft: () => s.bibleStep(-1),
        ArrowUp: () => s.bibleStep(-1),
        PageUp: () => s.bibleStep(-1),
      };
      const action = clears[e.key] ?? (s.mode === 'show' ? navigation[e.key] : s.mode === 'bible' ? bibleSteps[e.key] : undefined);
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

/**
 * The draggable dividers between the panes. Pane sizes live in CSS variables on the app's grid,
 * so a drag only touches the variable until it's saved.
 */
function PaneSplitters({
  app,
  layout,
  media,
}: {
  app: RefObject<HTMLDivElement | null>;
  layout: 'show' | 'edit' | 'reflow';
  media: boolean;
}) {
  const track = (prop: 'gridTemplateColumns' | 'gridTemplateRows', i: number) =>
    app.current ? parseFloat(getComputedStyle(app.current)[prop].split(' ').at(i) ?? '0') : 0;
  const live = (name: string) => (size: number) => app.current?.style.setProperty(name, `${size}px`);
  const vw = (f: number) => () => window.innerWidth * f;

  if (layout !== 'show')
    return (
      <>
        <Splitter
          axis="x"
          label="Slide list width"
          className="pane-split-outline"
          measure={() => track('gridTemplateColumns', 0)}
          min={160}
          max={vw(0.4)}
          apply={live('--outline-w')}
          commit={(v) => setPaneSize('outline', v)}
          reset={() => setPaneSize('outline', undefined)}
        />
        <Splitter
          axis="x"
          label="Inspector width"
          className="pane-split-inspector"
          invert
          measure={() => track('gridTemplateColumns', -1)}
          min={260}
          max={vw(0.45)}
          apply={live('--inspector-w')}
          commit={(v) => setPaneSize('inspector', v)}
          reset={() => setPaneSize('inspector', undefined)}
        />
      </>
    );
  return (
    <>
      <Splitter
        axis="x"
        label="Library width"
        className="pane-split-side"
        measure={() => track('gridTemplateColumns', 0)}
        min={180}
        max={vw(0.35)}
        apply={live('--side-w')}
        commit={(v) => setPaneSize('side', v)}
        reset={() => setPaneSize('side', undefined)}
      />
      <Splitter
        axis="x"
        label="Live panel width"
        className="pane-split-live"
        invert
        measure={() => track('gridTemplateColumns', -1)}
        min={260}
        max={vw(0.45)}
        apply={live('--live-w')}
        commit={(v) => setPaneSize('live', v)}
        reset={() => setPaneSize('live', undefined)}
      />
      {media && (
        <Splitter
          axis="y"
          label="Media bin height"
          className="pane-split-media"
          invert
          measure={() => track('gridTemplateRows', -1)}
          min={120}
          max={() => window.innerHeight * 0.6}
          apply={live('--media-h')}
          commit={(v) => setPaneSize('media', v)}
          reset={() => setPaneSize('media', undefined)}
        />
      )}
    </>
  );
}

export default function ControlApp() {
  const [dialog, setDialog] = useState<'settings' | 'screens' | null>(null);
  const mode = useStore((s) => s.mode);
  const layout = mode === 'bible' ? 'show' : mode;
  const showMediaBin = useStore((s) => s.showMediaBin);
  const editingTheme = useStore((s) => s.editingThemeId);

  const fonts = useStore((s) => s.fonts);
  // Unset until the first-launch welcome, which asks for it.
  const appIcon = useStore((s) => s.settings.appIcon);

  useEffect(() => startFrameSync(), []);
  useEffect(() => startScreenManager(), []);
  const openScreens = useCallback(() => setDialog('screens'), []);
  useScreenCommands(openScreens);
  useEffect(() => {
    void registerFonts(fonts);
  }, [fonts]);
  useEffect(() => {
    if (appIcon) applyAppIcon(appIcon);
  }, [appIcon]);
  useShortcuts(dialog === null && !editingTheme && !!appIcon);

  const appRef = useRef<HTMLDivElement>(null);
  const savedPanes = useStore((s) => s.settings.panes);
  const panes = { ...DEFAULT_PANES, ...savedPanes };
  const sizes = {
    '--side-w': `${panes.side}px`,
    '--live-w': `${panes.live}px`,
    '--media-h': `${panes.media}px`,
    '--outline-w': `${panes.outline}px`,
    '--inspector-w': `${panes.inspector}px`,
  } as CSSProperties;

  return (
    // Bible mode has Show mode's layout, with the Bible in place of the slides.
    <div ref={appRef} className={`app mode-${layout} ${layout === 'show' && !showMediaBin ? 'no-media' : ''}`} style={sizes}>
      <Toolbar onSettings={() => setDialog('settings')} onScreens={openScreens} />
      {layout === 'show' && (
        <>
          <Sidebar />
          <main className="center">{mode === 'bible' ? <BibleView /> : <ShowView />}</main>
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
      <PaneSplitters app={appRef} layout={layout} media={showMediaBin} />
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} onScreens={openScreens} />}
      {dialog === 'screens' && <ScreenConfigDialog onClose={() => setDialog(null)} />}
      {editingTheme && <ThemeEditorDialog />}
      {!appIcon && <WelcomeDialog />}
      <Notices />
    </div>
  );
}
