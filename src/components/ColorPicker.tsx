import { useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { LABEL_SWATCHES } from '../labels';
import { PROPRESENTER_GROUPS } from '../lyrics';
import { openPopupBelow } from './ContextMenu';

/** ProPresenter's group colors, once each, then Lumen's swatches: quick picks under the picker. */
const QUICK = [...new Set([...PROPRESENTER_GROUPS.map((g) => g.color), ...LABEL_SWATCHES.map((c) => c.color)])];

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Any color: a picker (drag for hue and shade), the hex code to type, and quick picks. It keeps
 * its own color as it changes (it may sit in a floating panel that isn't drawn again).
 */
export function ColorPickerPanel({ value: initial, onChange }: { value: string; onChange: (color: string) => void }) {
  const [value, setValue] = useState(HEX.test(initial) ? initial.toLowerCase() : '#000000');
  const [text, setText] = useState(value);
  const choose = (c: string) => {
    setValue(c);
    setText(c);
    onChange(c);
  };
  return (
    <div className="color-picker">
      <HexColorPicker color={value} onChange={choose} />
      <label className="color-picker-hex">
        <span>Hex</span>
        <input
          value={text}
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            const hex = (v.startsWith('#') ? v : `#${v}`).toLowerCase();
            if (HEX.test(hex)) {
              setValue(hex);
              onChange(hex);
            }
          }}
          aria-label="Hex color"
        />
        <span className="color-picker-current" style={{ background: value }} />
      </label>
      <div className="color-picker-quick">
        {QUICK.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch ${value === c ? 'on' : ''}`}
            style={{ background: c }}
            onClick={() => choose(c)}
            title={c}
            aria-label={c}
          />
        ))}
      </div>
    </div>
  );
}

/** A color well that opens the picker below it, in a floating panel (so a scrolling list doesn't clip it). */
export function ColorButton({ value, onChange, label }: { value: string; onChange: (color: string) => void; label: string }) {
  return (
    <button
      type="button"
      className="color-well"
      style={{ background: value }}
      onClick={(e) => openPopupBelow(e.currentTarget, <ColorPickerPanel value={value} onChange={onChange} />)}
      title={label}
      aria-label={label}
    />
  );
}
