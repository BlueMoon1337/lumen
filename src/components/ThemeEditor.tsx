import type { ReactNode } from 'react';
import { useStore } from '../store';
import { FONT_CHOICES } from '../theme';
import type { Theme } from '../types';
import { SlidePreview } from './Canvas';
import { Dialog } from './ui';

const SAMPLE = 'Amazing grace, how sweet the sound\nThat saved a wretch like me';

export function Row({ label, children }: { label: string; children: ReactNode }) {
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
                value={FONT_CHOICES.some((f) => f.value === t.fontFamily) ? t.fontFamily : ''}
                onChange={(e) => set({ fontFamily: e.target.value })}
              >
                {!FONT_CHOICES.some((f) => f.value === t.fontFamily) && <option value="">{t.fontFamily}</option>}
                {FONT_CHOICES.map((f) => (
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
