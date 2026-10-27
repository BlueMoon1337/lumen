import { useCallback, useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { applyAppIcon } from '../appIcons';
import { registerFonts } from '../fonts';
import { installHistory, runHistoryCommand, useHistory } from '../history';
import { startFrameSync } from '../liveFrame';
import { checkForUpdates, startUpdateChecks } from '../updates';
import { deleteUnusedBlobs } from '../media';
import { dismiss, useNotices } from '../notices';
import { startScreenManager } from '../outputs';
import { useStore } from '../store';
import { isTypingTarget } from '../util';
import { AskHost } from './Ask';
import { AudioPlayer } from './AudioPlayer';
import { BibleView } from './BibleView';
import { CaptureDialog } from './CaptureDialog';
import { ClearGroupsDialog } from './ClearGroups';
import { MediaClock } from './MediaClock';
import { ContextMenuHost } from './ContextMenu';
import { LabelsDialog, SettingsDialog } from './Dialogs';
import { useEditKeys, useEditMenuState } from './editCommands';
import { EditView } from './EditView';
import { usePresentationKeys, usePresentationMenu } from './presentationCommands';
import { exportTarget, importFileCommand, newPresentationCommand, runFileCommand } from './fileCommands';
import { ExportThemesDialog, SlideImagesDialog, TextImportDialog } from './FileDialogs';
import { WelcomeDialog } from './IconChooser';
import { LivePanel } from './LivePanel';
import { LooksDialog } from './LooksDialog';
import { MediaContent, MediaSidebar } from './MediaBin';
import { ReflowView } from './ReflowView';
import { ScreenConfigDialog } from './ScreenConfig';
import { useScreensCommands } from './screensCommands';
import { useViewCommands } from './viewCommands';
import { useWindowCommands } from './windowCommands';
import { UpdateDialog } from './UpdateDialog';
import { ShowView } from './ShowView';
import { StageLayoutsEditor } from './StageLayoutsEditor';
import { Sidebar } from './Sidebar';
import { DEFAULT_PANES, setPaneSize, Splitter } from './Splitter';
import { ThemeEditorDialog } from './ThemeEditor';
import { Toolbar } from './Toolbar';

// Record edits for undo from the start, before any view reads the store's actions.
installHistory();

/**
 * ⌘Z undoes, ⇧⌘Z (or Ctrl+Y) redoes. The desktop app's Edit menu handles the keys itself
 * and sends them here; in a text field they undo the typing.
 */
function useUndoKeys() {
  useEffect(() => {
    const bridge = window.lumenDesktop;
    const stopMenu = bridge?.onMenu((command) => {
      if (command === 'undo' || command === 'redo') runHistoryCommand(command);
    });
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || isTypingTarget(e.target)) return;
      const command = e.code === 'KeyZ' ? (e.shiftKey ? 'redo' : 'undo') : e.code === 'KeyY' && !e.shiftKey ? 'redo' : null;
      // The desktop menu has ⌘Z and ⇧⌘Z; Ctrl+Y isn't on it.
      if (!command || (bridge && e.code === 'KeyZ')) return;
      e.preventDefault();
      runHistoryCommand(command);
    };
    window.addEventListener('keydown', onKey);
    // Keep the desktop menu's Undo and Redo named after the next step.
    const name = () => bridge?.setUndoState(useHistory.getState());
    name();
    const stopNames = useHistory.subscribe(name);
    return () => {
      stopMenu?.();
      stopNames();
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}

function useShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useStore.getState();
      // Slide navigation only in Show, where Edit's arrow keys nudge the selected text box instead.
      // (The function keys clear layers: see presentationCommands.ts.)
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
      const action = s.mode === 'show' ? navigation[e.key] : s.mode === 'bible' ? bibleSteps[e.key] : undefined;
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

/**
 * Presentations set to advance by themselves (an announcement loop, say) move on after their
 * time, on whichever layer they're showing. Changing slide by hand starts the time again.
 */
function useAutoAdvance() {
  const slide = useStore((s) => s.live.slide);
  const announcement = useStore((s) => s.live.announcement);
  const slideSeconds = useStore((s) => (s.live.slide ? s.presentations[s.live.slide.presentationId]?.autoAdvance?.seconds : undefined));
  const announcementSeconds = useStore((s) =>
    s.live.announcement ? s.presentations[s.live.announcement.presentationId]?.autoAdvance?.seconds : undefined,
  );
  useEffect(() => {
    if (!slide || !slideSeconds) return;
    const t = setTimeout(() => useStore.getState().advanceLayer('slide'), slideSeconds * 1000);
    return () => clearTimeout(t);
  }, [slide, slideSeconds]);
  useEffect(() => {
    if (!announcement || !announcementSeconds) return;
    const t = setTimeout(() => useStore.getState().advanceLayer('announcement'), announcementSeconds * 1000);
    return () => clearTimeout(t);
  }, [announcement, announcementSeconds]);
}

/**
 * File menu commands. The desktop app's menu sends them (with ⌘N and ⇧⌘I); in a browser those
 * keys are caught here, where the browser lets them through. The desktop menu's Export items
 * follow whether a presentation is selected.
 */
function useFileCommands() {
  useEffect(() => {
    const bridge = window.lumenDesktop;
    if (bridge) {
      const stopMenu = bridge.onMenu((command) => runFileCommand(command));
      let selected: boolean | null = null;
      const sync = () => {
        const now = !!exportTarget();
        if (now !== selected) bridge.setFileState({ presentation: (selected = now) });
      };
      sync();
      const stopSync = useStore.subscribe(sync);
      return () => {
        stopMenu();
        stopSync();
      };
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || isTypingTarget(e.target)) return;
      const action =
        e.code === 'KeyI' && e.shiftKey ? () => void importFileCommand() : e.code === 'KeyN' && !e.shiftKey ? newPresentationCommand : null;
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
  layout: 'show' | 'edit' | 'reflow' | 'layouts';
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
  const dialog = useStore((s) => s.dialog);
  const setDialog = useCallback((d: typeof dialog) => useStore.getState().setUI({ dialog: d }), []);
  const mode = useStore((s) => s.mode);
  const layout = mode === 'bible' ? 'show' : mode;
  const showMediaBin = useStore((s) => s.showMediaBin);
  const editingTheme = useStore((s) => s.editingThemeId);

  const fonts = useStore((s) => s.fonts);
  // Unset until the first-launch welcome, which asks for it.
  const appIcon = useStore((s) => s.settings.appIcon);

  useEffect(() => startFrameSync(), []);
  useEffect(() => {
    // Deleted media keeps its file for Undo until now.
    const { media, fonts } = useStore.getState();
    void deleteUnusedBlobs(new Set([...media.map((m) => m.id), ...fonts.map((f) => f.id)])).catch(() => {});
  }, []);
  useUndoKeys();
  useFileCommands();
  useAutoAdvance();
  useEffect(() => startScreenManager(), []);
  const openScreens = useCallback(() => setDialog('screens'), [setDialog]);
  useScreensCommands();
  useViewCommands();
  useWindowCommands();
  useEffect(() => startUpdateChecks(), []);
  useEffect(
    () =>
      window.lumenDesktop?.onMenu((id) => {
        if (id !== 'check-updates') return;
        setDialog('update');
        void checkForUpdates();
      }),
    [setDialog],
  );
  useEffect(() => {
    void registerFonts(fonts);
  }, [fonts]);
  useEffect(() => {
    if (appIcon) applyAppIcon(appIcon);
  }, [appIcon]);
  useShortcuts(dialog === null && !editingTheme && !!appIcon);
  useEditKeys();
  useEditMenuState();
  usePresentationKeys();
  usePresentationMenu();
  useEffect(() => {
    // The desktop app's web view has its own right-click menu (Reload, Inspect…); Lumen's
    // menus replace it, and text fields keep theirs for copy and paste.
    if (!window.lumenDesktop) return;
    const onMenu = (e: MouseEvent) => !isTypingTarget(e.target) && e.preventDefault();
    window.addEventListener('contextmenu', onMenu);
    return () => window.removeEventListener('contextmenu', onMenu);
  }, []);

  const appRef = useRef<HTMLDivElement>(null);
  const savedPanes = useStore((s) => s.settings.panes);
  const spellcheck = useStore((s) => s.settings.spellcheck !== false);
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
    // Text fields take Check Spelling While Typing from here.
    <div
      ref={appRef}
      className={`app mode-${layout} ${layout === 'show' && !showMediaBin ? 'no-media' : ''}`}
      style={sizes}
      spellCheck={spellcheck}
    >
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
      {mode === 'layouts' && <StageLayoutsEditor />}
      <PaneSplitters app={appRef} layout={layout} media={showMediaBin} />
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} onScreens={openScreens} />}
      {dialog === 'screens' && <ScreenConfigDialog onClose={() => setDialog(null)} />}
      {dialog === 'labels' && <LabelsDialog onClose={() => setDialog(null)} />}
      {dialog === 'update' && <UpdateDialog onClose={() => setDialog(null)} />}
      {dialog === 'capture' && <CaptureDialog onClose={() => setDialog(null)} />}
      {dialog === 'looks' && <LooksDialog onClose={() => setDialog(null)} />}
      {dialog === 'clearGroups' && <ClearGroupsDialog onClose={() => setDialog(null)} />}
      {dialog === 'textImport' && <TextImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'slideImages' && <SlideImagesDialog onClose={() => setDialog(null)} />}
      {dialog === 'exportThemes' && <ExportThemesDialog onClose={() => setDialog(null)} />}
      {editingTheme && <ThemeEditorDialog />}
      {!appIcon && <WelcomeDialog />}
      <Notices />
      <ContextMenuHost />
      <AskHost />
      <AudioPlayer />
      <MediaClock />
    </div>
  );
}
