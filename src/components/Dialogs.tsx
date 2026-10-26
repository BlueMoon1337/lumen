import { useState } from 'react';
import { DEFAULT_APP_ICON } from '../appIcons';
import { addFontFiles, importFiles } from '../commands';
import { cssFamilyFor, faceName, FONT_ACCEPT, isFontInstalled } from '../fonts';
import { useDisplays } from '../outputs';
import { exportLibrary, isLibraryData, useStore } from '../store';
import { IconPicker } from './IconChooser';
import { Dialog, downloadFile, pickFiles } from './ui';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const ALT = IS_MAC ? '⌥' : 'Alt';

export function SettingsDialog({ onClose, onScreens }: { onClose: () => void; onScreens: () => void }) {
  const settings = useStore((s) => s.settings);
  const themes = useStore((s) => s.themes);
  const media = useStore((s) => s.media);
  const bibles = useStore((s) => s.bibles);
  const fonts = useStore((s) => s.fonts);
  const s = useStore.getState();
  const [copperplate] = useState(() =>
    fonts.some((f) => /^copperplate/i.test(f.family))
      ? 'added'
      : isFontInstalled('Copperplate')
        ? 'installed'
        : isFontInstalled('Copperplate Gothic Light')
          ? 'gothic'
          : 'missing',
  );
  const screens = useStore((s) => s.screens.screens);
  const displayCount = useDisplays((s) => s.displays.length);

  const importJson = async () => {
    const [file] = await pickFiles('.json,application/json', false);
    if (!file) return;
    try {
      const data: unknown = JSON.parse(await file.text());
      if (!isLibraryData(data)) throw new Error();
      if (confirm('Replace your entire library, playlists and themes with this file?')) {
        s.importLibrary(data);
        onClose();
      }
    } catch {
      alert('That file is not a Lumen library export.');
    }
  };

  return (
    <Dialog title="Settings" onClose={onClose}>
      <section className="settings-section">
        <h4>Presenting</h4>
        <label className="field-row">
          <span>Transition</span>
          <span className="pair">
            <input
              type="range"
              min={0}
              max={2000}
              step={50}
              value={settings.transitionMs}
              onChange={(e) => s.updateSettings({ transitionMs: Number(e.target.value) })}
            />
            <span className="muted">{(settings.transitionMs / 1000).toFixed(2)}s</span>
          </span>
        </label>
        <label className="field-row">
          <span>Default theme</span>
          <select value={settings.defaultThemeId} onChange={(e) => s.updateSettings({ defaultThemeId: e.target.value })}>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-row">
          <span>Logo</span>
          <select value={settings.logoMediaId ?? ''} onChange={(e) => s.updateSettings({ logoMediaId: e.target.value || undefined })}>
            <option value="">None</option>
            {media.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-row">
          <span>CCLI license #</span>
          <input
            value={settings.ccliLicense ?? ''}
            onChange={(e) => s.updateSettings({ ccliLicense: e.target.value || undefined })}
            placeholder="Shown in copyright lines"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.advanceAcrossItems}
            onChange={(e) => s.updateSettings({ advanceAcrossItems: e.target.checked })}
          />
          After the last slide, continue to the next playlist item
        </label>
      </section>
      <section className="settings-section">
        <h4>App Icon</h4>
        <IconPicker value={settings.appIcon ?? DEFAULT_APP_ICON} onChange={(appIcon) => s.updateSettings({ appIcon })} />
        {window.lumenDesktop?.platform === 'darwin' && (
          <p className="muted small-print">The Dock shows the new icon while Lumen runs; Finder keeps the one Lumen was installed with.</p>
        )}
      </section>
      <section className="settings-section">
        <h4>Screens</h4>
        <p className="muted small-print">
          {screens.filter((x) => x.kind === 'audience').length} audience and {screens.filter((x) => x.kind === 'stage').length} stage screen
          {screens.length === 1 ? '' : 's'} set up · {displayCount} connected display{displayCount === 1 ? '' : 's'} detected.
        </p>
        <div className="button-row">
          <button className="btn" onClick={onScreens}>
            Configure Screens…
          </button>
        </div>
      </section>
      <section className="settings-section">
        <h4>Bibles</h4>
        {bibles.map((b) => (
          <div key={b.id} className="bible-row">
            <span className="list-label">
              <b>{b.abbreviation}</b> {b.name}
            </span>
            <span className="muted">{b.books.length} books</span>
            <button
              className="btn small danger"
              onClick={() => confirm(`Remove ${b.abbreviation} from this computer?`) && s.deleteBible(b.id)}
            >
              Remove
            </button>
          </div>
        ))}
        {bibles.length === 0 && <p className="muted small-print">Import ProPresenter .rvbible files to look up scripture offline.</p>}
        <div className="button-row">
          <button className="btn" onClick={() => pickFiles('.rvbible').then((files) => importFiles(files))}>
            Import Bible (.rvbible)…
          </button>
        </div>
      </section>
      <section className="settings-section">
        <h4>Fonts</h4>
        <p className={`small-print font-status ${copperplate === 'missing' ? 'warn' : 'ok'}`}>
          {
            {
              installed: 'Copperplate is installed on this computer, so slides set in Copperplate look as they do in ProPresenter.',
              gothic: 'This computer has Copperplate Gothic, which Lumen uses for Copperplate.',
              added: 'Copperplate comes from a font file added below.',
              missing:
                'Copperplate isn’t installed on this computer, so Lumen shows the free Cinzel font in its place. Every Mac has Copperplate; on Windows it comes with Microsoft Office as Copperplate Gothic.',
            }[copperplate]
          }
        </p>
        {fonts.map((f) => (
          <div key={f.id} className="bible-row">
            <span
              className="list-label"
              style={{ fontFamily: cssFamilyFor(f.family), fontWeight: f.weight, fontStyle: f.italic ? 'italic' : 'normal' }}
            >
              {f.family}
            </span>
            <span className="muted">{faceName(f)}</span>
            <button className="btn small danger" onClick={() => confirm(`Remove ${f.family} ${faceName(f)}?`) && s.deleteFont(f.id)}>
              Remove
            </button>
          </div>
        ))}
        <div className="button-row">
          <button className="btn" onClick={() => pickFiles(FONT_ACCEPT).then((files) => addFontFiles(files))}>
            Add font files…
          </button>
        </div>
        <p className="muted small-print">
          Add .ttf, .otf, .woff or .ttc files you’re licensed to use. Fonts installed on the computer can also be picked by name from any
          font menu.
        </p>
      </section>
      <section className="settings-section">
        <h4>Library</h4>
        <div className="button-row">
          <button
            className="btn"
            onClick={() =>
              downloadFile(`lumen-library-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportLibrary(), null, 2))
            }
          >
            Export library
          </button>
          <button className="btn" onClick={importJson}>
            Import library
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (!confirm('Erase everything and restore the sample library?')) return;
              useStore.persist.clearStorage();
              location.reload();
            }}
          >
            Reset
          </button>
        </div>
        <p className="muted small-print">
          Exports include songs, playlists, themes and messages. Media files and Bible text stay on this computer.
        </p>
      </section>
      <section className="settings-section">
        <h4>Keyboard</h4>
        <dl className="shortcuts">
          <dt>
            <kbd>→</kbd> <kbd>Space</kbd> <kbd>PgDn</kbd>
          </dt>
          <dd>Next slide</dd>
          <dt>
            <kbd>←</kbd> <kbd>PgUp</kbd>
          </dt>
          <dd>Previous slide</dd>
          <dt>
            <kbd>C</kbd> <kbd>V</kbd> <kbd>B</kbd> …
          </dt>
          <dd>Jump to the next group starting with that letter</dd>
          <dt>
            <kbd>F1</kbd>
          </dt>
          <dd>Clear all</dd>
          <dt>
            <kbd>F2</kbd> / <kbd>F3</kbd> / <kbd>F4</kbd>
          </dt>
          <dd>Clear slide / media / message</dd>
          <dt>
            <kbd>F6</kbd>
          </dt>
          <dd>Toggle logo</dd>
          <dt>
            <kbd>{MOD}</kbd> <kbd>1</kbd> / <kbd>{MOD}</kbd> <kbd>2</kbd>
          </dt>
          <dd>Audience / Stage screens on or off</dd>
          <dt>
            <kbd>{ALT}</kbd> <kbd>{MOD}</kbd> <kbd>1</kbd>
          </dt>
          <dd>Configure Screens</dd>
        </dl>
      </section>
    </Dialog>
  );
}
