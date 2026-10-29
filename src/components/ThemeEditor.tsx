import type { ReactNode } from 'react';
import { useStore } from '../store';
import type { Theme, ThemeTextBox } from '../types';
import { SlidePreview } from './Canvas';
import { deleteTheme } from './deleting';
import { FontSelect } from './FontSelect';
import { Dialog } from './ui';

const SAMPLE = 'Amazing grace, how sweet the sound\nThat saved a wretch like me';
const VERSE = 'For God so loved the world, that he gave his only begotten Son';

/** A new caption box: small, at the bottom right, like the Reference box of ProPresenter's Bible template. */
const newCaptionBox = (t: Theme): ThemeTextBox => ({
  name: 'Reference',
  inset: { top: 84, right: t.inset.right, bottom: 5, left: 45 },
  textAlign: 'right',
  verticalAlign: 'bottom',
  fontSize: Math.round(t.fontSize * 0.55),
});

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
  const onlyTheme = useStore((s) => s.themes.length <= 1);
  const isDefault = useStore((s) => s.settings.defaultThemeId === s.editingThemeId);
  const media = useStore((s) => s.media);
  const s = useStore.getState();
  if (!t) return null;
  const set = (patch: Partial<Theme>) => s.updateTheme(t.id, patch);
  const setInset = (side: keyof Theme['inset'], v: number) => set({ inset: { ...t.inset, [side]: v } });
  const setBg = (patch: Partial<Theme['background']>) => set({ background: { ...t.background, ...patch } });
  const box = t.captionBox;
  const setBox = (patch: Partial<ThemeTextBox>) => box && set({ captionBox: { ...box, ...patch } });
  const close = () => s.setUI({ editingThemeId: null });

  return (
    <Dialog title="Edit theme" onClose={close} className="theme-dialog">
      <div className="theme-editor">
        <div className="theme-editor-side">
          <div className="theme-editor-preview">
            {box ? (
              <SlidePreview text={VERSE} caption="John 3:16" theme={t} />
            ) : (
              <SlidePreview text={SAMPLE} caption="Amazing Grace · John Newton" theme={t} />
            )}
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
            <button className="btn danger" disabled={onlyTheme} onClick={() => deleteTheme(t.id)}>
              Delete…
            </button>
          </div>
          <p className="muted small-print">Text shrinks automatically when a slide has too much to fit at the maximum size.</p>
        </div>
        <div className="theme-fields">
          <fieldset>
            <legend>Text</legend>
            <Row label="Font">
              <FontSelect value={t.fontFamily} onChange={(fontFamily) => set({ fontFamily })} />
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
            {!box && (
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
            )}
          </fieldset>
          <fieldset>
            <legend>Text boxes</legend>
            <Row label="Main box">
              <input value={t.textName ?? ''} placeholder="Text" onChange={(e) => set({ textName: e.target.value || undefined })} />
            </Row>
            <Row label="Caption box">
              <span className="checks">
                <label>
                  <input
                    type="checkbox"
                    checked={!!box}
                    onChange={(e) => set({ captionBox: e.target.checked ? newCaptionBox(t) : undefined })}
                  />{' '}
                  Own box (e.g. a reference)
                </label>
              </span>
            </Row>
            {box && (
              <>
                <Row label="Name">
                  <input value={box.name} onChange={(e) => setBox({ name: e.target.value })} />
                </Row>
                <Row label="Font">
                  <FontSelect value={box.fontFamily ?? t.fontFamily} onChange={(fontFamily) => setBox({ fontFamily })} />
                </Row>
                <Row label="Max size">
                  <input
                    type="number"
                    min={12}
                    max={300}
                    value={box.fontSize}
                    onChange={(e) => setBox({ fontSize: Number(e.target.value) || 12 })}
                  />
                </Row>
                <Row label="Color">
                  <input type="color" value={box.color ?? t.color} onChange={(e) => setBox({ color: e.target.value })} />
                </Row>
                <Row label="Align">
                  <select value={box.textAlign} onChange={(e) => setBox({ textAlign: e.target.value as Theme['textAlign'] })}>
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </Row>
                <Row label="Vertical">
                  <select value={box.verticalAlign} onChange={(e) => setBox({ verticalAlign: e.target.value as Theme['verticalAlign'] })}>
                    <option value="top">Top</option>
                    <option value="middle">Middle</option>
                    <option value="bottom">Bottom</option>
                  </select>
                </Row>
                {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                  <Row key={side} label={`Margin ${side} %`}>
                    <input
                      type="number"
                      min={0}
                      max={95}
                      value={box.inset[side]}
                      onChange={(e) => setBox({ inset: { ...box.inset, [side]: Number(e.target.value) || 0 } })}
                    />
                  </Row>
                ))}
              </>
            )}
            <p className="muted small-print">
              Bible mode puts each verse and its reference into these boxes; pick which goes where in Bible mode.
            </p>
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
            <label className="check-row theme-bg-toggle">
              <input
                type="checkbox"
                role="switch"
                checked={!t.keepBackground}
                disabled={t.background.type === 'none'}
                onChange={(e) => set({ keepBackground: e.target.checked ? undefined : true })}
              />
              Media from the Media bin replaces it
            </label>
            <p className="muted small-print">
              {t.background.type === 'none'
                ? 'A transparent background shows the media from the Media bin behind the words.'
                : t.keepBackground
                  ? 'This background stays up over media playing from the Media bin, which keeps playing underneath.'
                  : 'Media playing from the Media bin replaces this background while it is live.'}
            </p>
          </fieldset>
        </div>
      </div>
    </Dialog>
  );
}
