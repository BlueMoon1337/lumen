import { useCallback, useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { applyAppIcon } from '../appIcons';
import { registerFonts } from '../fonts';
import { installHistory, runHistoryCommand, useHistory } from '../history';
import { startFrameSync } from '../liveFrame';
import { deleteUnusedBlobs } from '../media';
import { dismiss, useNotices } from '../notices';
import { setScreensEnabled, startScreenManager } from '../outputs';
import { useStore } from '../store';
import { isTypingTarget } from '../util';
import { AudioPlayer } from './AudioPlayer';
import { BibleView } from './BibleView';
import { ClearGroupsDialog } from './ClearGroups';
import { MediaClock } from './MediaClock';
import { ContextMenuHost } from './ContextMenu';
import { LabelsDialog, SettingsDialog } from './Dialogs';
import { EditView, findSlide } from './EditView';
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
      // Clearing works from every mode; slide navigation only in Show,
      // where Edit's arrow keys nudge the selected text box instead.
      const clears: Record<string, () => void> = {
        F1: s.clearAll,
        F2: s.clearSlide,
        F3: s.clearMedia,
        F4: () => s.showMessage(null),
        F5: () => s.clearLayers(['audio']),
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

/**
 * Edit mode's slide shortcuts, as in ProPresenter: ⌥⌘C / ⌥⌘V copy and paste the selected
 * slide's text style; ⌘X, ⌘C, ⌘V and ⌘D cut, copy, paste and duplicate the slide.
 */
function useEditShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.mode !== 'edit' || !(e.metaKey || e.ctrlKey) || e.shiftKey || isTypingTarget(e.target)) return;
      // Leave ⌘C alone when there's text selected to copy.
      if (!window.getSelection()?.isCollapsed) return;
      const p = s.selectedPresentationId ? s.presentations[s.selectedPresentationId] : undefined;
      const found = p && findSlide(p, s.editSlideId);
      if (!p || !found) return;
      const id = found.slide.id;
      // e.code, because ⌥C types "ç" on a Mac.
      const actions: Record<string, () => void> = e.altKey
        ? { KeyC: () => s.copyTextStyle(p.id, id), KeyV: () => s.pasteTextStyle(p.id, { slideId: id }) }
        : {
            KeyC: () => s.copySlides(p.id, [id]),
            KeyX: () => s.cutSlides(p.id, [id]),
            KeyV: () => {
              const pasted = s.pasteSlides(p.id, id);
              if (pasted) s.openEditor(pasted);
            },
            KeyD: () => {
              const copy = s.duplicateSlide(p.id, id);
              if (copy) s.openEditor(copy);
            },
          };
      const action = actions[e.code];
      if (!action) return;
      e.preventDefault();
      action();
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
  useAutoAdvance();
  useEffect(() => startScreenManager(), []);
  const openScreens = useCallback(() => setDialog('screens'), [setDialog]);
  useScreenCommands(openScreens);
  useEffect(() => {
    void registerFonts(fonts);
  }, [fonts]);
  useEffect(() => {
    if (appIcon) applyAppIcon(appIcon);
  }, [appIcon]);
  useShortcuts(dialog === null && !editingTheme && !!appIcon);
  useEditShortcuts(dialog === null && !editingTheme && !!appIcon);
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
      {dialog === 'labels' && <LabelsDialog onClose={() => setDialog(null)} />}
      {dialog === 'clearGroups' && <ClearGroupsDialog onClose={() => setDialog(null)} />}
      {editingTheme && <ThemeEditorDialog />}
      {!appIcon && <WelcomeDialog />}
      <Notices />
      <ContextMenuHost />
      <AudioPlayer />
      <MediaClock />
    </div>
  );
}
