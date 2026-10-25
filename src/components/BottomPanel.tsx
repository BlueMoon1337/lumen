import { useState, type ReactNode } from 'react';
import { useMedia } from '../media';
import { useStore } from '../store';
import type { MediaItem, Theme } from '../types';
import { SlidePreview } from './Canvas';
import { Dialog, Icon, IconButton, pickFiles } from './ui';

export function BottomPanel() {
  const tab = useStore((s) => s.bottomTab);
  const { setUI } = useStore.getState();
  return (
    <div className="bottom-panel">
      <nav className="tabs">
        <button className={tab === 'media' ? 'active' : ''} onClick={() => setUI({ bottomTab: 'media' })}>
          Media
        </button>
        <button className={tab === 'themes' ? 'active' : ''} onClick={() => setUI({ bottomTab: 'themes' })}>
          Themes
        </button>
      </nav>
      {tab === 'media' ? <MediaBin /> : <ThemePanel />}
    </div>
  );
}

function MediaThumb({ item }: { item: MediaItem }) {
  const media = useMedia(item.id);
  if (!media) return <div className="media-thumb-img" />;
  return media.isVideo ? (
    <video className="media-thumb-img" src={`${media.url}#t=0.5`} muted preload="metadata" />
  ) : (
    <img className="media-thumb-img" src={media.url} alt="" />
  );
}

function MediaBin() {
  const media = useStore((s) => s.media);
  const liveMedia = useStore((s) => s.live.mediaId);
  const logoId = useStore((s) => s.settings.logoMediaId);
  const s = useStore.getState();
  const [dropping, setDropping] = useState(false);

  const importFiles = (files: File[]) => void s.addMediaFiles(files);

  return (
    <div
      className={`media-bin ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <button className="media-tile add" onClick={() => pickFiles('image/*,video/*').then(importFiles)}>
        <Icon name="upload" size={22} />
        <span>Import images or videos</span>
      </button>
      {media.map((m) => (
        <div
          key={m.id}
          className={`media-tile ${liveMedia === m.id ? 'live' : ''}`}
          onClick={() => s.setLiveMedia(liveMedia === m.id ? null : m.id)}
          title="Click to show as the background, click again to clear"
        >
          <MediaThumb item={m} />
          <div className="media-tile-footer">
            <span className="list-label">{m.name}</span>
            {logoId === m.id && <span className="badge">Logo</span>}
            <span className="row-actions">
              <IconButton
                icon="monitor"
                title={logoId === m.id ? 'Unset logo' : 'Use as logo'}
                active={logoId === m.id}
                onClick={() => s.updateSettings({ logoMediaId: logoId === m.id ? undefined : m.id })}
              />
              <IconButton icon="trash" title="Delete" danger onClick={() => confirm(`Delete "${m.name}"?`) && s.deleteMedia(m.id)} />
            </span>
          </div>
        </div>
      ))}
      {media.length === 0 && <p className="muted media-empty">Drop image or video files here. Click one to put it behind your slides.</p>}
    </div>
  );
}

const FONTS = [
  { label: 'Helvetica / Arial', value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: 'System UI', value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet', value: '"Trebuchet MS", sans-serif' },
  { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
  { label: 'Courier', value: '"Courier New", Courier, monospace' },
];

const SAMPLE = 'Amazing grace, how sweet the sound\nThat saved a wretch like me';

function ThemePanel() {
  const themes = useStore((s) => s.themes);
  const defaultId = useStore((s) => s.settings.defaultThemeId);
  const selectedId = useStore((s) => s.selectedPresentationId);
  const presentationTheme = useStore((s) => (s.selectedPresentationId ? s.presentations[s.selectedPresentationId]?.themeId : undefined));
  const s = useStore.getState();
  const activeId = selectedId ? (themes.some((t) => t.id === presentationTheme) ? presentationTheme : defaultId) : null;

  return (
    <div className="theme-list">
      <button className="theme-card add" onClick={() => s.createTheme()}>
        <Icon name="plus" size={22} />
        <span>New theme</span>
      </button>
      {themes.map((t) => (
        <div
          key={t.id}
          className={`theme-card ${activeId === t.id ? 'selected' : ''}`}
          onClick={() => selectedId && s.updatePresentation(selectedId, { themeId: t.id })}
          onDoubleClick={() => s.setUI({ editingThemeId: t.id })}
          title={selectedId ? 'Click to apply to this presentation, double-click to edit' : 'Double-click to edit'}
        >
          <div className="theme-card-canvas">
            <SlidePreview text={SAMPLE} theme={t} />
          </div>
          <div className="theme-card-name">
            <span className="list-label">{t.name}</span>
            {defaultId === t.id && <span className="badge">Default</span>}
            <span className="row-actions">
              <IconButton icon="edit" title="Edit theme" onClick={() => s.setUI({ editingThemeId: t.id })} />
              <IconButton icon="copy" title="Duplicate theme" onClick={() => s.createTheme(t)} />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field-row">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function ThemeEditorDialog() {
  const t = useStore((s) => s.themes.find((x) => x.id === s.editingThemeId));
  const isDefault = useStore((s) => s.settings.defaultThemeId === s.editingThemeId);
  const media = useStore((s) => s.media);
  const s = useStore.getState();
  if (!t) return null;
  const set = (patch: Partial<Theme>) => s.updateTheme(t.id, patch);
  const setInset = (side: keyof Theme['inset'], v: number) => set({ inset: { ...t.inset, [side]: v } });
  const setBg = (patch: Partial<Theme['background']>) => set({ background: { ...t.background, ...patch } });
  const close = () => s.setUI({ editingThemeId: null });

  return (
    <Dialog title="Edit theme" onClose={close} className="theme-dialog">
      <div className="theme-editor">
        <div className="theme-editor-side">
          <div className="theme-editor-preview">
            <SlidePreview text={SAMPLE} caption="Amazing Grace · John Newton" theme={t} />
          </div>
          <label className="field">
            Name
            <input value={t.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <div className="button-row">
            <button className="btn" disabled={isDefault} onClick={() => s.updateSettings({ defaultThemeId: t.id })}>
              {isDefault ? 'Default theme' : 'Make default'}
            </button>
            <button className="btn" onClick={() => s.createTheme(t)}>
              Duplicate
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (confirm(`Delete theme "${t.name}"? Presentations using it switch to the default.`)) s.deleteTheme(t.id);
              }}
            >
              Delete
            </button>
          </div>
          <p className="muted small-print">Text shrinks automatically when a slide has too much to fit at the maximum size.</p>
        </div>
        <div className="theme-fields">
          <fieldset>
            <legend>Text</legend>
            <Row label="Font">
              <select
                value={FONTS.some((f) => f.value === t.fontFamily) ? t.fontFamily : ''}
                onChange={(e) => set({ fontFamily: e.target.value })}
              >
                {!FONTS.some((f) => f.value === t.fontFamily) && <option value="">{t.fontFamily}</option>}
                {FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Max size">
              <input
                type="number"
                min={12}
                max={300}
                value={t.fontSize}
                onChange={(e) => set({ fontSize: Number(e.target.value) || 12 })}
              />
            </Row>
            <Row label="Weight">
              <select value={t.fontWeight} onChange={(e) => set({ fontWeight: Number(e.target.value) })}>
                {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Color">
              <input type="color" value={t.color} onChange={(e) => set({ color: e.target.value })} />
            </Row>
            <Row label="Line height">
              <input
                type="number"
                step={0.05}
                min={0.8}
                max={2.5}
                value={t.lineHeight}
                onChange={(e) => set({ lineHeight: Number(e.target.value) || 1 })}
              />
            </Row>
            <Row label="Style">
              <span className="checks">
                <label>
                  <input type="checkbox" checked={t.uppercase} onChange={(e) => set({ uppercase: e.target.checked })} /> Caps
                </label>
                <label>
                  <input type="checkbox" checked={t.italic} onChange={(e) => set({ italic: e.target.checked })} /> Italic
                </label>
                <label>
                  <input type="checkbox" checked={t.shadow} onChange={(e) => set({ shadow: e.target.checked })} /> Shadow
                </label>
              </span>
            </Row>
            <Row label="Outline">
              <span className="pair">
                <input type="number" min={0} max={20} value={t.outline} onChange={(e) => set({ outline: Number(e.target.value) || 0 })} />
                <input type="color" value={t.outlineColor} onChange={(e) => set({ outlineColor: e.target.value })} />
              </span>
            </Row>
            <Row label="Caption size">
              <input
                type="number"
                step={0.05}
                min={0.2}
                max={1}
                value={t.captionScale}
                onChange={(e) => set({ captionScale: Number(e.target.value) || 0.5 })}
              />
            </Row>
          </fieldset>
          <fieldset>
            <legend>Layout</legend>
            <Row label="Align">
              <select value={t.textAlign} onChange={(e) => set({ textAlign: e.target.value as Theme['textAlign'] })}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </Row>
            <Row label="Vertical">
              <select value={t.verticalAlign} onChange={(e) => set({ verticalAlign: e.target.value as Theme['verticalAlign'] })}>
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </select>
            </Row>
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <Row key={side} label={`Margin ${side} %`}>
                <input type="number" min={0} max={95} value={t.inset[side]} onChange={(e) => setInset(side, Number(e.target.value) || 0)} />
              </Row>
            ))}
            <Row label="Text box fill">
              <span className="pair">
                <input
                  type="checkbox"
                  checked={!!t.boxColor}
                  onChange={(e) => set({ boxColor: e.target.checked ? 'rgba(0, 0, 0, 0.7)' : '' })}
                />
                {t.boxColor && (
                  <input value={t.boxColor} onChange={(e) => set({ boxColor: e.target.value })} aria-label="Box color (CSS)" />
                )}
              </span>
            </Row>
          </fieldset>
          <fieldset>
            <legend>Background</legend>
            <Row label="Type">
              <select value={t.background.type} onChange={(e) => setBg({ type: e.target.value as Theme['background']['type'] })}>
                <option value="none">None (transparent)</option>
                <option value="color">Color</option>
                <option value="gradient">Gradient</option>
                <option value="media">Image / video</option>
              </select>
            </Row>
            {(t.background.type === 'color' || t.background.type === 'gradient') && (
              <Row label="Colors">
                <span className="pair">
                  <input type="color" value={t.background.color} onChange={(e) => setBg({ color: e.target.value })} />
                  {t.background.type === 'gradient' && (
                    <input type="color" value={t.background.color2} onChange={(e) => setBg({ color2: e.target.value })} />
                  )}
                </span>
              </Row>
            )}
            {t.background.type === 'media' && (
              <Row label="Media">
                <select value={t.background.mediaId ?? ''} onChange={(e) => setBg({ mediaId: e.target.value || undefined })}>
                  <option value="">Choose…</option>
                  {media.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Row>
            )}
            <p className="muted small-print">Media playing from the Media bin replaces the theme background while it is live.</p>
          </fieldset>
        </div>
      </div>
    </Dialog>
  );
}
