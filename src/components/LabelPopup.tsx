import { useEffect, useRef, useState } from 'react';
import { LABEL_SWATCHES, labelPresets } from '../labels';
import { useStore } from '../store';
import type { ColorLabel } from '../types';
import { closePopup } from './ContextMenu';
import { Icon } from './ui';

const DEFAULT_COLOR = '#e07b28';

/**
 * Label ▸ Edit…, as in ProPresenter: type a label's name (or pick a saved one) and a color, and it
 * goes on the slides as you type, on all the selected slides at once. A new name can be kept
 * with the saved labels for next time. Enter or a click elsewhere closes it; an empty name takes
 * the label off.
 */
export function LabelPopup({ presentationId, slideIds }: { presentationId: string; slideIds: string[] }) {
  const presets = useStore((s) => labelPresets(s.settings));
  const first = useStore((s) => {
    const p = s.presentations[presentationId];
    return p?.groups.flatMap((g) => g.slides).find((sl) => sl.id === slideIds[0])?.label;
  });
  const [name, setName] = useState(first?.name ?? '');
  const [color, setColor] = useState(first?.color ?? DEFAULT_COLOR);
  const [listOpen, setListOpen] = useState(false);
  const [saveGlobal, setSaveGlobal] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const saved = useRef({ name, color, saveGlobal });
  saved.current = { name, color, saveGlobal };
  const isNew = !!name.trim() && !presets.some((l) => l.name.toLowerCase() === name.trim().toLowerCase());

  const apply = (next: { name: string; color: string }) => {
    const label: ColorLabel | undefined = next.name.trim() ? { name: next.name.trim(), color: next.color } : undefined;
    useStore.getState().setSlideLabels(presentationId, slideIds, label);
  };
  const change = (next: { name?: string; color?: string }) => {
    const n = next.name ?? name;
    const c = next.color ?? color;
    if (next.name !== undefined) setName(n);
    if (next.color !== undefined) setColor(c);
    apply({ name: n, color: c });
  };

  // The menu it opens from takes the focus back as it closes; the name field gets it after.
  useEffect(() => {
    const t = window.setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  // On closing, a new label asked to be kept joins the saved ones.
  useEffect(
    () => () => {
      const { name: n, color: c, saveGlobal: keep } = saved.current;
      const s = useStore.getState();
      const all = labelPresets(s.settings);
      if (keep && n.trim() && !all.some((l) => l.name.toLowerCase() === n.trim().toLowerCase()))
        s.updateSettings({ labelPresets: [...all, { name: n.trim(), color: c }] });
    },
    [],
  );

  return (
    <form
      className="label-popup"
      onSubmit={(e) => {
        e.preventDefault();
        closePopup();
      }}
    >
      <div className="label-popup-row">
        <div className="label-combo">
          <input
            ref={input}
            value={name}
            placeholder="Label"
            onFocus={(e) => e.target.select()}
            onChange={(e) => change({ name: e.target.value })}
            aria-label="Label name"
            spellCheck={false}
          />
          <button
            type="button"
            className="label-combo-btn"
            onClick={() => setListOpen(!listOpen)}
            aria-label="Saved labels"
            title="Saved labels"
          >
            <Icon name="chevronDown" size={14} />
          </button>
          {listOpen && (
            <div className="label-combo-list" role="listbox">
              {presets.map((l) => (
                <button
                  key={`${l.name}\u0000${l.color}`}
                  type="button"
                  role="option"
                  aria-selected={l.name === name && l.color === color}
                  onClick={() => {
                    change({ name: l.name, color: l.color });
                    setListOpen(false);
                  }}
                >
                  <span className="label-dot" style={{ background: l.color }} />
                  {l.name}
                </button>
              ))}
              {presets.length === 0 && <span className="muted">No saved labels</span>}
            </div>
          )}
        </div>
        <label className="label-color" title="Color" style={{ background: color }}>
          <input type="color" value={color} onChange={(e) => change({ color: e.target.value })} aria-label="Label color" />
        </label>
      </div>
      <div className="swatches label-swatches">
        {LABEL_SWATCHES.map((c) => (
          <button
            key={c.color}
            type="button"
            className={`swatch ${color === c.color ? 'on' : ''}`}
            style={{ background: c.color }}
            onClick={() => change({ color: c.color })}
            title={c.name}
            aria-label={c.name}
          />
        ))}
      </div>
      {isNew && (
        <label className="check-row label-save">
          <input type="checkbox" checked={saveGlobal} onChange={(e) => setSaveGlobal(e.target.checked)} />
          Save to global labels
        </label>
      )}
      {slideIds.length > 1 && <p className="small-print muted label-count">On {slideIds.length} slides</p>}
    </form>
  );
}
