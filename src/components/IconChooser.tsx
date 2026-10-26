import { useEffect, useState } from 'react';
import { APP_ICONS, applyAppIcon, DEFAULT_APP_ICON } from '../appIcons';
import { useStore } from '../store';
import type { AppIconId } from '../types';
import { Dialog } from './ui';

/** The icon choices as cards; double-clicking one also confirms it where `onConfirm` is given. */
export function IconPicker({
  value,
  onChange,
  onConfirm,
}: {
  value: AppIconId;
  onChange: (id: AppIconId) => void;
  onConfirm?: () => void;
}) {
  return (
    <div className="icon-picker" role="radiogroup" aria-label="App icon">
      {APP_ICONS.map((icon) => (
        <button
          key={icon.id}
          type="button"
          role="radio"
          aria-checked={value === icon.id}
          className={`icon-choice ${value === icon.id ? 'selected' : ''}`}
          onClick={() => onChange(icon.id)}
          onDoubleClick={onConfirm}
        >
          <img src={icon.preview} alt="" width={112} height={112} draggable={false} />
          <span>{icon.name}</span>
        </button>
      ))}
    </div>
  );
}

/** Shown the very first time Lumen starts: pick the app icon. */
export function WelcomeDialog() {
  const [choice, setChoice] = useState<AppIconId>(DEFAULT_APP_ICON);
  // Preview the choice in the tab (and the Dock) while deciding.
  useEffect(() => {
    applyAppIcon(choice);
  }, [choice]);
  const done = () => useStore.getState().updateSettings({ appIcon: choice });
  const where = window.lumenDesktop ? (window.lumenDesktop.platform === 'darwin' ? 'in the Dock' : 'in the taskbar') : 'in the browser tab';

  return (
    <Dialog title="Welcome to Lumen" onClose={done} className="welcome-dialog">
      <p className="welcome-text">Choose an icon for Lumen. It shows {where}, and you can change it any time in Settings.</p>
      <IconPicker value={choice} onChange={setChoice} onConfirm={done} />
      <div className="dialog-actions">
        <button className="btn primary" onClick={done} autoFocus>
          Continue
        </button>
      </div>
    </Dialog>
  );
}
