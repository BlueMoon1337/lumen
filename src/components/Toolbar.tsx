import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { IMPORT_ACCEPT, importFiles, newPresentation } from '../commands';
import { setScreensEnabled, syncBrowserWindows, useDisplays } from '../outputs';
import { activeOutputs, hostKey } from '../screens';
import { useStore, type Mode } from '../store';
import { applyStyles, resolveTheme } from '../theme';
import type { ScreenKind, TextStyle, Theme } from '../types';
import { SlidePreview } from './Canvas';
import { FontSelect } from './FontSelect';
import { Icon, IconButton, pickFiles, Popover, type IconName } from './ui';

type PopoverName = 'search' | 'text' | 'theme' | 'more';

function Tool({
  icon,
  label,
  active,
  disabled,
  onClick,
  children,
  glyph,
}: {
  icon?: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children?: ReactNode;
  glyph?: ReactNode;
}) {
  return (
    <div className="tool">
      <button type="button" className={`tool-btn ${active ? 'active' : ''}`} disabled={disabled} onClick={onClick} title={label}>
        <span className="tool-icon">{glyph ?? (icon && <Icon name={icon} size={20} />)}</span>
        <span className="tool-label">{label}</span>
      </button>
      {children}
    </div>
  );
}

/** Audience / Stage: on (green) when that kind's screens are enabled and showing, as in ProPresenter. */
function ScreenTool({ kind, label, onConfigure }: { kind: ScreenKind; label: string; onConfigure: () => void }) {
  const setup = useStore((s) => s.screens);
  const displays = useDisplays((s) => s.displays);
  const openHosts = useDisplays((s) => s.openHosts);
  const enabled = kind === 'audience' ? setup.audienceEnabled : setup.stageEnabled;
  const wanted = activeOutputs(setup, displays).filter((p) => p.kind === kind);
  const showing = wanted.filter((p) => openHosts.includes(hostKey(p))).length;
  const hasScreens = setup.screens.some((x) => x.kind === kind);
  const title = !hasScreens
    ? `No ${label.toLowerCase()} screens. Click to set one up.`
    : `${label}: ${enabled ? `on, ${showing} of ${wanted.length} output${wanted.length === 1 ? '' : 's'} showing` : 'off'}. Right-click to configure.`;
  return (
    <div className="tool" onContextMenu={(e) => (e.preventDefault(), onConfigure())}>
      <button
        type="button"
        className="tool-btn"
        title={title}
        onClick={() => {
          if (!hasScreens) return onConfigure();
          // In a browser, windows the operator closed (or that were blocked) reopen on the next click.
          if (enabled && !window.lumenDesktop && showing < wanted.length) syncBrowserWindows();
          else setScreensEnabled(kind, !enabled);
        }}
      >
        <span className="tool-icon">
          <span className={`screen-ring ${enabled ? (showing < wanted.length ? 'partial' : 'on') : ''}`} />
        </span>
        <span className="tool-label">{label}</span>
      </button>
    </div>
  );
}

export function Toolbar({ onBible, onSettings, onScreens }: { onBible: () => void; onSettings: () => void; onScreens: () => void }) {
  const mode = useStore((s) => s.mode);
  const hasSelection = useStore((s) => !!s.selectedPresentationId && !!s.presentations[s.selectedPresentationId]);
  const showMediaBin = useStore((s) => s.showMediaBin);
  const [pop, setPop] = useState<PopoverName | null>(null);
  const close = useCallback(() => setPop(null), []);
  const toggle = (name: PopoverName) => setPop((p) => (p === name ? null : name));
  const setMode = (m: Mode) => useStore.getState().setUI({ mode: m });
  const macInset = window.lumenDesktop?.platform === 'darwin';

  return (
    <header className={`toolbar ${macInset ? 'mac-inset' : ''}`}>
      <div className="tool-group">
        <Tool icon="search" label="Search" active={pop === 'search'} onClick={() => toggle('search')}>
          <Popover open={pop === 'search'} onClose={close} className="search-pop">
            <SearchPopover onDone={close} />
          </Popover>
        </Tool>
      </div>
      <div className="tool-group">
        <Tool glyph={<span className="tool-glyph">Aa</span>} label="Text" active={pop === 'text'} onClick={() => toggle('text')}>
          <Popover open={pop === 'text'} onClose={close} className="text-pop">
            <TextPopover />
          </Popover>
        </Tool>
        <Tool icon="theme" label="Theme" active={pop === 'theme'} onClick={() => toggle('theme')}>
          <Popover open={pop === 'theme'} onClose={close} className="theme-pop">
            <ThemePopover />
          </Popover>
        </Tool>
      </div>
      <div className="tool-group">
        <Tool icon="play" label="Show" active={mode === 'show'} onClick={() => setMode('show')} />
        <Tool icon="edit" label="Edit" active={mode === 'edit'} disabled={!hasSelection} onClick={() => setMode('edit')} />
        <Tool icon="reflow" label="Reflow" active={mode === 'reflow'} disabled={!hasSelection} onClick={() => setMode('reflow')} />
        <Tool icon="bible" label="Bible" onClick={onBible} />
        <Tool icon="more" label="More" active={pop === 'more'} onClick={() => toggle('more')}>
          <Popover open={pop === 'more'} onClose={close} className="menu-pop">
            <MoreMenu onDone={close} onBible={onBible} onSettings={onSettings} onScreens={onScreens} />
          </Popover>
        </Tool>
      </div>
      <div className="toolbar-spacer" />
      <div className="tool-group">
        <Tool
          icon="image"
          label="Media"
          active={showMediaBin && mode === 'show'}
          onClick={() => useStore.getState().setUI({ showMediaBin: !showMediaBin, mode: 'show' })}
        />
      </div>
      <div className="tool-group">
        <ScreenTool kind="audience" label="Audience" onConfigure={onScreens} />
        <ScreenTool kind="stage" label="Stage" onConfigure={onScreens} />
      </div>
      <div className="tool-group">
        <Tool icon="gear" label="Settings" onClick={onSettings} />
      </div>
    </header>
  );
}

function SearchPopover({ onDone }: { onDone: () => void }) {
  const presentations = useStore((s) => s.presentations);
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: { id: string; title: string; line?: string }[] = [];
    for (const p of Object.values(presentations)) {
      if (p.title.toLowerCase().includes(q)) out.push({ id: p.id, title: p.title });
      else {
        const line = p.groups.flatMap((g) => g.slides.flatMap((s) => s.text.split('\n'))).find((l) => l.toLowerCase().includes(q));
        if (line) out.push({ id: p.id, title: p.title, line });
      }
    }
    return out.sort((a, b) => Number(!!a.line) - Number(!!b.line) || a.title.localeCompare(b.title)).slice(0, 40);
  }, [presentations, query]);

  const open = (id: string) => {
    const s = useStore.getState();
    const p = s.presentations[id];
    s.select(id);
    s.setUI({ sidebar: 'library', libraryCategory: p.category });
    onDone();
  };

  return (
    <>
      <label className="pop-search">
        <Icon name="search" size={14} />
        <input
          autoFocus
          placeholder="Search titles and lyrics"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && results[0] && open(results[0].id)}
        />
      </label>
      <ul className="pop-results">
        {results.map((r) => (
          <li key={r.id}>
            <button onClick={() => open(r.id)}>
              <Icon name="slides" size={14} />
              <span className="pop-result-title">{r.title}</span>
              {r.line && <span className="pop-result-line">{r.line}</span>}
            </button>
          </li>
        ))}
        {query.trim() && results.length === 0 && <li className="pop-empty">No matches</li>}
      </ul>
    </>
  );
}

function TextPopover() {
  const p = useStore((s) => (s.selectedPresentationId ? s.presentations[s.selectedPresentationId] : undefined));
  const themes = useStore((s) => s.themes);
  const settings = useStore((s) => s.settings);
  if (!p) return <p className="pop-empty">Select a presentation to format its text.</p>;

  const eff = applyStyles(resolveTheme({ themes, settings }, p), p.style);
  const set = (patch: TextStyle) => useStore.getState().updatePresentation(p.id, { style: { ...p.style, ...patch } });

  return (
    <div className="text-pop-body">
      <div className="pop-title">Text · {p.title}</div>
      <div className="pop-row">
        <FontSelect value={eff.fontFamily} onChange={(fontFamily) => set({ fontFamily })} />
        <input
          type="number"
          className="num"
          min={12}
          max={300}
          value={eff.fontSize}
          onChange={(e) => set({ fontSize: Number(e.target.value) || 12 })}
          aria-label="Size"
          title="Maximum size"
        />
        <input type="color" value={eff.color} onChange={(e) => set({ color: e.target.value })} aria-label="Color" />
      </div>
      <div className="pop-row">
        <div className="seg">
          <button
            className={eff.fontWeight >= 600 ? 'on' : ''}
            onClick={() => set({ fontWeight: eff.fontWeight >= 600 ? 400 : 700 })}
            title="Bold"
          >
            <b>B</b>
          </button>
          <button className={eff.italic ? 'on' : ''} onClick={() => set({ italic: !eff.italic })} title="Italic">
            <i>I</i>
          </button>
          <button className={eff.uppercase ? 'on' : ''} onClick={() => set({ uppercase: !eff.uppercase })} title="All caps">
            AA
          </button>
        </div>
        <AlignButtons theme={eff} onChange={set} />
      </div>
      <div className="pop-foot">
        <span className="muted">Applies to every slide in this presentation.</span>
        <button
          className="btn small"
          disabled={!p.style}
          onClick={() => useStore.getState().updatePresentation(p.id, { style: undefined })}
        >
          Use theme
        </button>
      </div>
    </div>
  );
}

export function AlignButtons({ theme, onChange }: { theme: Pick<Theme, 'textAlign' | 'verticalAlign'>; onChange: (s: TextStyle) => void }) {
  return (
    <>
      <div className="seg">
        {(['left', 'center', 'right'] as const).map((a) => (
          <button key={a} className={theme.textAlign === a ? 'on' : ''} onClick={() => onChange({ textAlign: a })} title={`Align ${a}`}>
            <Icon name={a === 'left' ? 'alignLeft' : a === 'center' ? 'alignCenter' : 'alignRight'} size={14} />
          </button>
        ))}
      </div>
      <div className="seg">
        {(['top', 'middle', 'bottom'] as const).map((a) => (
          <button
            key={a}
            className={theme.verticalAlign === a ? 'on' : ''}
            onClick={() => onChange({ verticalAlign: a })}
            title={`Align ${a}`}
          >
            <Icon name={a === 'top' ? 'alignTop' : a === 'middle' ? 'alignMiddle' : 'alignBottom'} size={14} />
          </button>
        ))}
      </div>
    </>
  );
}

const SAMPLE = 'Amazing grace, how sweet the sound\nThat saved a wretch like me';

function ThemePopover() {
  const themes = useStore((s) => s.themes);
  const defaultId = useStore((s) => s.settings.defaultThemeId);
  const p = useStore((s) => (s.selectedPresentationId ? s.presentations[s.selectedPresentationId] : undefined));
  const s = useStore.getState();
  const activeId = p ? (themes.some((t) => t.id === p.themeId) ? p.themeId : defaultId) : null;

  return (
    <>
      <div className="pop-title">
        Themes
        <IconButton icon="plus" title="New theme" onClick={() => s.createTheme()} />
      </div>
      <div className="theme-grid">
        {themes.map((t) => (
          <div
            key={t.id}
            className={`theme-card ${activeId === t.id ? 'selected' : ''}`}
            onClick={() => p && s.updatePresentation(p.id, { themeId: t.id })}
            onDoubleClick={() => s.setUI({ editingThemeId: t.id })}
          >
            <div className="theme-card-canvas">
              <SlidePreview text={SAMPLE} theme={t} />
            </div>
            <div className="theme-card-name">
              <span className="list-label">{t.name}</span>
              {defaultId === t.id && <span className="badge">Default</span>}
              <IconButton icon="edit" title="Edit theme" onClick={() => s.setUI({ editingThemeId: t.id })} />
            </div>
          </div>
        ))}
      </div>
      <div className="pop-foot muted">
        {p
          ? `Click a theme to apply it to “${p.title}”. Double-click to edit.`
          : 'Select a presentation to apply a theme. Double-click to edit.'}
      </div>
    </>
  );
}

function MoreMenu({
  onDone,
  onBible,
  onSettings,
  onScreens,
}: {
  onDone: () => void;
  onBible: () => void;
  onSettings: () => void;
  onScreens: () => void;
}) {
  const item = (label: string, action: () => void) => (
    <button
      onClick={() => {
        onDone();
        action();
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="menu">
      {item('New Presentation', () => newPresentation(useStore.getState().libraryCategory))}
      {item('Import Songs, Playlists or Bibles…', () => pickFiles(IMPORT_ACCEPT).then((files) => importFiles(files)))}
      {item('Add Scripture…', onBible)}
      <hr />
      {item('Configure Screens…', onScreens)}
      {item('Settings & Shortcuts…', onSettings)}
    </div>
  );
}
