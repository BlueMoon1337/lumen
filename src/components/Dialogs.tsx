import { useEffect, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CROSSFADE_MAX, songCrossfade } from '../countdowns';
import { inkFor } from '../theme';
import { SPLIT_COLORS, splitVerseColors } from '../bibleSlides';
import { checkForUpdates, useUpdates } from '../updates';
import { DEFAULT_APP_ICON } from '../appIcons';
import { addFontFiles, importFiles } from '../commands';
import { cssFamilyFor, faceName, FONT_ACCEPT, isFontInstalled } from '../fonts';
import { DEFAULT_GROUPS, DEFAULT_LABELS, groupPresets, LABEL_SWATCHES, labelPresets } from '../labels';
import { useDisplays } from '../outputs';
import { exportLibrary, isLibraryData, useStore } from '../store';
import type { ColorLabel } from '../types';
import { ColorButton } from './ColorPicker';
import { IconPicker } from './IconChooser';
import { TransitionButton } from './TransitionPicker';
import { alertDialog, confirmDialog, confirmThen } from './Ask';
import { deleteBible, deleteFont, undoHint } from './deleting';
import { saveBytes } from './fileCommands';
import { Dialog, IconButton, pickFiles } from './ui';

const HIGHLIGHTS = [
  { id: 'pink', name: 'Pink', color: '#e6458b' },
  { id: 'blue', name: 'Blue', color: '#3478f6' },
] as const;

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const ALT = IS_MAC ? '⌥' : 'Alt';

/**
 * Settings ▸ Startup: open Lumen when the computer starts (when the operator logs in). The
 * system keeps the setting, so it's read from there rather than from Lumen's own settings.
 */
/**
 * Settings ▸ Split Verse Colors: the colors a verse split over several slides has its label in, in the order
 * they're used (the first split verse takes the first color, the next the second, and so on).
 */
function SplitVerseColors() {
  const colors = useStore(useShallow((st) => splitVerseColors(st.settings)));
  const s = useStore.getState();
  const save = (next: string[]) => s.updateSettings({ splitVerseColors: next });
  const move = (i: number, by: number) => {
    const next = [...colors];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    save(next);
  };
  return (
    <div className="settings-subsection">
      <h5>Split Verse Colors</h5>
      <p className="muted small-print">
        In Bible mode, a verse that goes over several slides has its label in one of these colors, in this order, so its slides read as one
        verse and the next split verse looks different.
      </p>
      <ol className="split-colors">
        {colors.map((c, i) => (
          <li key={i}>
            <span className="split-color-number">{i + 1}</span>
            <ColorButton value={c} label={`Color ${i + 1}`} onChange={(color) => save(colors.map((x, j) => (j === i ? color : x)))} />
            <span className="split-color-sample" style={{ background: c, color: inkFor(c) }}>
              Genesis 1:1
            </span>
            <IconButton icon="chevronUp" title="Earlier" disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton icon="chevronDown" title="Later" disabled={i === colors.length - 1} onClick={() => move(i, 1)} />
            <IconButton
              icon="close"
              title="Remove this color"
              disabled={colors.length === 1}
              onClick={() => save(colors.filter((_, j) => j !== i))}
            />
          </li>
        ))}
      </ol>
      <div className="button-row">
        <button className="btn" onClick={() => save([...colors, SPLIT_COLORS[colors.length % SPLIT_COLORS.length]])}>
          Add Color
        </button>
        <button
          className="btn"
          disabled={!useStore.getState().settings.splitVerseColors}
          onClick={() => s.updateSettings({ splitVerseColors: undefined })}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

/** Settings ▸ Audio: Crossfade Songs, and how long a crossfade lasts (up to 5 seconds). */
function AudioSection() {
  const fade = useStore(useShallow((st) => songCrossfade(st.settings)));
  const s = useStore.getState();
  return (
    <section className="settings-section">
      <h4>Audio</h4>
      <label className="check-row">
        <input type="checkbox" checked={fade.on} onChange={(e) => s.updateSettings({ crossfadeSongs: e.target.checked || undefined })} />
        Crossfade Songs:
      </label>
      <div className={`crossfade-slider ${fade.on ? '' : 'off'}`}>
        <input
          type="range"
          min={1}
          max={CROSSFADE_MAX}
          step={1}
          value={fade.seconds}
          disabled={!fade.on}
          onChange={(e) => s.updateSettings({ crossfadeSeconds: Number(e.target.value) })}
          aria-label="Crossfade length in seconds"
          style={{ '--fill': `${((fade.seconds - 1) / (CROSSFADE_MAX - 1)) * 100}%` } as CSSProperties}
        />
        <div className="crossfade-ticks" aria-hidden>
          {Array.from({ length: CROSSFADE_MAX }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        <div className="crossfade-scale">
          <span>1</span>
          <span>
            {fade.seconds} second{fade.seconds === 1 ? '' : 's'}
          </span>
          <span>{CROSSFADE_MAX}</span>
        </div>
      </div>
      <p className="muted small-print">
        Each track in an audio playlist fades into the next, and a track started while another plays fades in as the other fades out. Also
        in the Audio tab (the crossfade button by Playlists).
      </p>
    </section>
  );
}

/** Settings ▸ Outro: what happens when the outro (Media ▸ Outro) ends. */
function OutroSection() {
  const settings = useStore((st) => st.settings);
  const playlists = useStore((st) => st.audioPlaylists);
  const logo = useStore((st) => st.media.find((m) => m.id === st.settings.logoMediaId));
  const s = useStore.getState();
  const playlistId = playlists.some((pl) => pl.id === settings.outroPlaylistId) ? settings.outroPlaylistId : '';
  return (
    <section className="settings-section">
      <h4>Outro</h4>
      <label className="check-row">
        <input
          type="checkbox"
          checked={!!settings.logoAfterOutro}
          onChange={(e) => s.updateSettings({ logoAfterOutro: e.target.checked || undefined })}
        />
        When the outro ends, show the logo
      </label>
      <label className="field-row">
        <span>With the logo, play</span>
        <select
          value={playlistId}
          disabled={!settings.logoAfterOutro}
          onChange={(e) => s.updateSettings({ outroPlaylistId: e.target.value || undefined })}
          aria-label="Audio playlist to play with the logo"
        >
          <option value="">No music</option>
          {playlists.map((pl) => (
            <option key={pl.id} value={pl.id}>
              {pl.name}
              {pl.shuffle ? ' (shuffled)' : ''}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small-print">
        {!logo
          ? 'There’s no logo yet: choose one in Media ▸ Logo (right-click ▸ Active Logo).'
          : `When the outro video finishes, “${logo.name}” comes up and the words and the background clear${
              playlistId ? `, and “${playlists.find((pl) => pl.id === playlistId)?.name}” starts playing with it` : ''
            }. Audio playlists are made in the Audio tab.`}
      </p>
    </section>
  );
}

function StartupSection() {
  const bridge = window.lumenDesktop!;
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    void bridge
      .openAtLogin()
      .then(setOn)
      .catch(() => setOn(false));
  }, [bridge]);
  const change = async (next: boolean) => {
    setOn(next);
    try {
      await bridge.setOpenAtLogin(next);
    } catch (e) {
      setOn(!next);
      void alertDialog({ title: 'Open at Login', message: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <section className="settings-section">
      <h4>Startup</h4>
      <label className="check-row">
        <input type="checkbox" checked={!!on} disabled={on === null} onChange={(e) => void change(e.target.checked)} />
        Open Lumen when {IS_MAC ? 'you log in to this Mac' : 'you sign in to this computer'}
      </label>
    </section>
  );
}

/** Settings ▸ Updates: this version, whether there's a newer one, and the Update button. */
function UpdatesSection() {
  const u = useUpdates();
  const ready = u.status === 'available' || u.status === 'installing';
  const status =
    u.hasToken === false
      ? 'Set up updates to get new versions of Lumen with one click.'
      : u.status === 'checking'
        ? 'Checking for updates…'
        : ready && u.found
          ? `Lumen ${u.found.version} is available.`
          : u.status === 'none'
            ? 'Lumen is up to date.'
            : u.status === 'error'
              ? 'The last check for updates didn’t work.'
              : '';
  return (
    <section className="settings-section">
      <h4>Updates</h4>
      <div className="settings-update">
        <div>
          <div>
            <b>Lumen</b> <span className="muted">Version {u.version ?? '…'}</span>
          </div>
          {status && <div className={`small-print ${ready ? 'update-available' : 'muted'}`}>{status}</div>}
        </div>
        <button
          className={`btn ${ready ? 'primary' : ''}`}
          onClick={() => {
            useStore.getState().setUI({ dialog: 'update' });
            if (!ready) void checkForUpdates();
          }}
        >
          {ready ? 'Update…' : u.hasToken === false ? 'Set Up Updates…' : 'Check for Updates…'}
        </button>
      </div>
      <ZipUpdates />
    </section>
  );
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Install from Zip… and Go Back: updates to Lumen's interface that come as a file (made without
 * GitHub's build machines), and going back to the version before.
 */
function ZipUpdates() {
  const bridge = window.lumenDesktop?.interfaceUpdates;
  const [state, setState] = useState<{ app: string; interface: string | null; previous: string | null } | null>(null);
  useEffect(() => void bridge?.state().then(setState, () => setState(null)), [bridge]);
  if (!bridge) return null;
  const install = async () => {
    const path = await bridge.pick();
    if (!path) return;
    try {
      const found = await bridge.check(path);
      const ok = await confirmDialog({
        title: `Install Lumen ${found.version}?`,
        message:
          (found.compared === 'newer'
            ? `It replaces Lumen ${found.current}.`
            : found.compared === 'same'
              ? `Lumen ${found.current} is already in use; this installs it again.`
              : `It’s older than Lumen ${found.current}, which is in use now.`) +
          ' Lumen restarts to finish. Your library, media and settings stay as they are, and Go Back puts this version back.' +
          (found.notes ? `\n\n${found.notes}` : ''),
        confirmLabel: found.compared === 'newer' ? 'Install and Restart' : 'Install Anyway',
      });
      if (ok) await bridge.install(path);
    } catch (e) {
      await alertDialog({ title: 'Zip File Invalid', message: message(e) });
    }
  };
  const goBack = async () => {
    if (!state?.previous) return;
    const ok = await confirmDialog({
      title: `Go back to Lumen ${state.previous}?`,
      message: `Lumen restarts with version ${state.previous}. Go Back again switches back to ${state.interface ?? state.app}.`,
      confirmLabel: 'Go Back and Restart',
    });
    if (ok) await bridge.goBack().catch((e) => alertDialog({ title: 'Couldn’t go back', message: message(e) }));
  };
  return (
    <div className="zip-updates">
      <div className="button-row">
        <button className="btn" onClick={() => void install()}>
          Install from Zip…
        </button>
        {state?.previous && (
          <button className="btn" onClick={() => void goBack()}>
            Go Back to {state.previous}
          </button>
        )}
      </div>
      <p className="muted small-print">
        Install from Zip takes a Lumen update package (Lumen-…-interface.zip) when the Update button can’t be used.
        {state?.interface ? ` This is Lumen ${state.interface}, on the Lumen ${state.app} app.` : ''}
      </p>
    </div>
  );
}

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
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      data = null;
    }
    if (!isLibraryData(data))
      return alertDialog({
        title: 'That file isn’t a Lumen backup.',
        message: 'Choose a file made with Back Up Library. To add songs or playlists, use File ▸ Import instead.',
      });
    const replace = await confirmDialog({
      title: 'Replace your whole library with this backup?',
      message: `Your presentations, playlists, themes and settings are replaced by the backup’s. ${undoHint()}`,
      confirmLabel: 'Replace',
      danger: true,
    });
    if (!replace) return;
    s.importLibrary(data);
    onClose();
  };

  return (
    <Dialog title="Settings" onClose={onClose} className="settings-dialog">
      {window.lumenDesktop && <UpdatesSection />}
      {window.lumenDesktop && <StartupSection />}
      <section className="settings-section">
        <h4>Presenting</h4>
        <div className="field-row">
          <span>Slide transition</span>
          <TransitionButton target="global" />
        </div>
        <div className="field-row">
          <span>Media transition</span>
          <TransitionButton target="media" />
        </div>
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
          <select value={settings.logoMediaId ?? ''} onChange={(e) => s.setActiveMedia('logo', e.target.value || null)}>
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
      <OutroSection />
      <AudioSection />
      <section className="settings-section">
        <h4>Highlight Color</h4>
        <div className="highlight-choices" role="radiogroup" aria-label="Highlight color">
          {HIGHLIGHTS.map((h) => (
            <button
              key={h.id}
              role="radio"
              aria-checked={(settings.highlight ?? 'pink') === h.id}
              className={`highlight-choice ${(settings.highlight ?? 'pink') === h.id ? 'on' : ''}`}
              onClick={() => s.updateSettings({ highlight: h.id === 'pink' ? undefined : h.id })}
            >
              <span className="highlight-dot" style={{ background: h.color }} />
              {h.name}
            </button>
          ))}
        </div>
        <p className="muted small-print">For selections, the open library or playlist, and buttons that are on.</p>
      </section>
      <section className="settings-section">
        <h4>Layout</h4>
        <div className="field-row">
          <button
            className="btn"
            disabled={!settings.panes || Object.keys(settings.panes).length === 0}
            onClick={() => s.updateSettings({ panes: undefined })}
          >
            Reset Section Sizes
          </button>
        </div>
        <p className="muted small-print">
          Puts the library, live panel, preview, media bin, slide list and inspector back to their original sizes. Drag the line between two
          sections to resize them, or double-click it to reset just that one.
        </p>
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
            <button className="btn small danger" onClick={() => deleteBible(b.id)}>
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
        <SplitVerseColors />
      </section>
      <section className="settings-section">
        <h4>Groups & Labels</h4>
        <p className="muted small-print">
          {groupPresets(settings).length} groups and {labelPresets(settings).length} slide labels to choose from when you right-click a
          slide.
        </p>
        <div className="button-row">
          <button className="btn" onClick={() => s.setUI({ dialog: 'labels' })}>
            Edit Groups & Labels…
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
            <button className="btn small danger" onClick={() => deleteFont(f.id, `${f.family} ${faceName(f)}`)}>
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
              void saveBytes(
                `Lumen Backup ${new Date().toISOString().slice(0, 10)}.json`,
                new TextEncoder().encode(JSON.stringify(exportLibrary(), null, 2)),
                'Lumen Backup',
                ['json'],
                'application/json',
              )
            }
          >
            Back Up Library…
          </button>
          <button className="btn" onClick={() => void importJson()}>
            Restore Backup…
          </button>
          <button
            className="btn danger"
            onClick={() =>
              confirmThen(
                {
                  title: 'Erase everything and start again with the sample library?',
                  message:
                    'Every presentation, playlist, theme and setting is deleted. This can’t be undone, so back up your library first.',
                  confirmLabel: 'Erase Everything',
                  danger: true,
                },
                () => {
                  useStore.persist.clearStorage();
                  location.reload();
                },
              )
            }
          >
            Reset…
          </button>
        </div>
        <p className="muted small-print">
          A backup holds every presentation, playlist, theme, message and setting; media files and Bible text stay on this computer. To
          share songs or playlists, use File ▸ Export.
        </p>
      </section>
      <section className="settings-section">
        <h4>App Icon</h4>
        <IconPicker value={settings.appIcon ?? DEFAULT_APP_ICON} onChange={(appIcon) => s.updateSettings({ appIcon })} />
        {window.lumenDesktop?.platform === 'darwin' && (
          <p className="muted small-print">The Dock shows the new icon while Lumen runs; Finder keeps the one Lumen was installed with.</p>
        )}
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
          <dd>Clear slide / media / logo</dd>
          <dt>
            <kbd>F5</kbd> / <kbd>F6</kbd> / <kbd>F7</kbd>
          </dt>
          <dd>Clear audio / messages / announcements</dd>
          <dt>
            <kbd>F12</kbd>
          </dt>
          <dd>Clear to logo</dd>
          <dt>
            <kbd>{MOD}</kbd> <kbd>←</kbd> / <kbd>→</kbd>
          </dt>
          <dd>Previous / next background from the media bin</dd>
          <dt>
            <kbd>Shift</kbd> <kbd>{MOD}</kbd> <kbd>N</kbd>
          </dt>
          <dd>New slide</dd>
          <dt>
            <kbd>{MOD}</kbd> <kbd>L</kbd> / <kbd>Shift</kbd> <kbd>{MOD}</kbd> <kbd>L</kbd> / <kbd>{ALT}</kbd> <kbd>{MOD}</kbd> <kbd>L</kbd>
          </dt>
          <dd>Show the triggered presentation / announcement; reveal the presentation in its library</dd>
          <dt>
            <kbd>{MOD}</kbd> <kbd>0</kbd>
          </dt>
          <dd>Show the selected slide on the stage screens only</dd>
          <dt>
            <kbd>{MOD}</kbd> <kbd>1</kbd> / <kbd>{MOD}</kbd> <kbd>2</kbd>
          </dt>
          <dd>Audience / Stage screens on or off</dd>
          <dt>
            <kbd>{ALT}</kbd> <kbd>{MOD}</kbd> <kbd>1</kbd>
          </dt>
          <dd>Configure Screens</dd>
          <dt>
            <kbd>{MOD}</kbd> <kbd>Z</kbd> / <kbd>Shift</kbd> <kbd>{MOD}</kbd> <kbd>Z</kbd>
          </dt>
          <dd>Undo / redo</dd>
          <dt>
            <kbd>{MOD}</kbd> <kbd>X</kbd> <kbd>C</kbd> <kbd>V</kbd> <kbd>D</kbd>
          </dt>
          <dd>Cut, copy, paste, duplicate the selected slides</dd>
          <dt>
            <kbd>{ALT}</kbd> <kbd>{MOD}</kbd> <kbd>C</kbd> / <kbd>V</kbd>
          </dt>
          <dd>Copy / paste text style</dd>
          <dt>
            <kbd>{ALT}</kbd> <kbd>Shift</kbd> <kbd>{MOD}</kbd> <kbd>V</kbd>
          </dt>
          <dd>Paste and match style</dd>
          <dt>
            <kbd>{MOD}</kbd> <kbd>A</kbd> / <kbd>Shift</kbd> <kbd>{MOD}</kbd> <kbd>A</kbd>
          </dt>
          <dd>Select all / deselect all slides</dd>
          <dt>
            <kbd>{MOD}</kbd>-click / <kbd>Shift</kbd>-click
          </dt>
          <dd>Select more slides</dd>
          <dt>
            <kbd>Delete</kbd>
          </dt>
          <dd>Delete the selected slides, presentation, playlist item or library</dd>
          <dt>
            <kbd>{MOD}</kbd> <kbd>F</kbd>
          </dt>
          <dd>Search</dd>
          <dt>
            <kbd>{MOD}</kbd> <kbd>N</kbd> / <kbd>Shift</kbd> <kbd>{MOD}</kbd> <kbd>I</kbd>
          </dt>
          <dd>New presentation / import a file</dd>
          <dt>Right-click</dt>
          <dd>Slides, groups, library and playlist items, and media all have menus</dd>
        </dl>
      </section>
    </Dialog>
  );
}

/** One editable list of names and colors: the group presets or the slide labels. */
function PresetList({
  items,
  defaults,
  noun,
  onChange,
}: {
  items: ColorLabel[];
  defaults: ColorLabel[];
  noun: string;
  onChange: (items: ColorLabel[] | undefined) => void;
}) {
  const update = (i: number, patch: Partial<ColorLabel>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <div className="preset-list">
      {items.map((it, i) => (
        <div key={i} className="preset-row">
          <ColorButton value={it.color} onChange={(color) => update(i, { color })} label={`${it.name} color`} />
          <input value={it.name} onChange={(e) => update(i, { name: e.target.value })} aria-label={`${noun} name`} />
          <span className="swatches mini">
            {LABEL_SWATCHES.slice(0, 8).map((c) => (
              <button
                key={c.color}
                className={`swatch ${it.color === c.color ? 'on' : ''}`}
                style={{ background: c.color }}
                onClick={() => update(i, { color: c.color })}
                title={c.name}
                aria-label={c.name}
              />
            ))}
          </span>
          <IconButton icon="chevronUp" title="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
          <IconButton icon="chevronDown" title="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)} />
          <IconButton icon="trash" title={`Remove ${noun}`} danger onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div className="button-row">
        <button
          className="btn"
          onClick={() => onChange([...items, { name: `New ${noun}`, color: LABEL_SWATCHES[items.length % 8].color }])}
        >
          Add {noun}
        </button>
        <button
          className="btn"
          disabled={items === defaults}
          onClick={() =>
            confirmThen({ title: `Put back the standard ${noun.toLowerCase()}s?`, message: undoHint(), confirmLabel: 'Restore' }, () =>
              onChange(undefined),
            )
          }
        >
          Restore Defaults
        </button>
      </div>
    </div>
  );
}

/**
 * The groups and slide labels offered in the right-click menus and the inspector. Changing a
 * preset doesn't change slides that already use it.
 */
export function LabelsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const s = useStore.getState();
  const [tab, setTab] = useState<'groups' | 'labels'>('groups');
  return (
    <Dialog title="Groups & Labels" onClose={onClose} className="labels-dialog">
      <div className="seg labels-tabs">
        <button className={tab === 'groups' ? 'on' : ''} onClick={() => setTab('groups')}>
          Groups
        </button>
        <button className={tab === 'labels' ? 'on' : ''} onClick={() => setTab('labels')}>
          Labels
        </button>
      </div>
      {tab === 'groups' ? (
        <>
          <p className="muted small-print">
            Sections of a song. Right-click a slide and choose Group to start one there; the slides after it in its old group come along.
          </p>
          <PresetList
            items={groupPresets(settings)}
            defaults={DEFAULT_GROUPS}
            noun="Group"
            onChange={(groupPresets) => s.updateSettings({ groupPresets })}
          />
        </>
      ) : (
        <>
          <p className="muted small-print">Cues for whoever is running slides, shown on the slide thumbnails. A slide has one label.</p>
          <PresetList
            items={labelPresets(settings)}
            defaults={DEFAULT_LABELS}
            noun="Label"
            onChange={(labelPresets) => s.updateSettings({ labelPresets })}
          />
        </>
      )}
    </Dialog>
  );
}
