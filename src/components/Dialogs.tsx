import { useEffect, useState } from 'react';
import { bookLabel, lookupLocal, parseReference, type Passage, type Verse } from '../bible';
import { addFontFiles, importBibleFile, importFiles } from '../commands';
import { cssFamilyFor, faceName, FONT_ACCEPT, isFontInstalled } from '../fonts';
import { notify } from '../notices';
import { useDisplays } from '../outputs';
import { exportLibrary, isLibraryData, useStore } from '../store';
import { IconPicker } from './IconChooser';
import { Dialog, downloadFile, pickFiles } from './ui';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const ALT = IS_MAC ? '⌥' : 'Alt';

const ONLINE = [
  { id: 'web', label: 'World English Bible' },
  { id: 'kjv', label: 'King James Version' },
  { id: 'asv', label: 'American Standard (1901)' },
  { id: 'bbe', label: 'Bible in Basic English' },
  { id: 'ylt', label: "Young's Literal Translation" },
  { id: 'darby', label: 'Darby' },
];

function verseRange(verses: Verse[]) {
  const first = verses[0];
  const last = verses[verses.length - 1];
  const sameChapter = first.chapter === last.chapter;
  const end = verses.length === 1 ? '' : sameChapter ? `-${last.verse}` : `-${last.chapter}:${last.verse}`;
  return `${first.book_name} ${first.chapter}:${first.verse}${end}`;
}

/** Builds editor text with one group per slide so each passage chunk is labelled. */
function passageToText(passage: Passage, perSlide: number, numbers: boolean) {
  const blocks: string[] = [];
  const tag = passage.translation_id.toUpperCase();
  for (let i = 0; i < passage.verses.length; i += perSlide) {
    const chunk = passage.verses.slice(i, i + perSlide);
    const ref = verseRange(chunk);
    const body = chunk.map((v) => `${numbers ? `${v.verse} ` : ''}${v.text.replace(/\s+/g, ' ').trim()}`).join(' ');
    blocks.push(`[${ref}]\n${body}\n~ ${ref} ${tag}`);
  }
  return blocks.join('\n\n');
}

function manualToText(reference: string, text: string) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((p, i) => `[${reference || 'Scripture'}${i ? ` (${i + 1})` : ''}]\n${p}\n~ ${reference}`)
    .join('\n\n');
}

let lastReference = '';

export function ScriptureDialog({ onClose }: { onClose: () => void }) {
  const bibles = useStore((s) => s.bibles);
  const lastBible = useStore((s) => s.settings.lastBible);
  const [translation, setTranslation] = useState(() =>
    lastBible && (bibles.some((b) => b.id === lastBible) || ONLINE.some((t) => t.id === lastBible)) ? lastBible : (bibles[0]?.id ?? 'web'),
  );
  const local = bibles.find((b) => b.id === translation);
  const [reference, setReference] = useState(() => lastReference || (local?.language === 'spa' ? 'Juan 3:16-18' : 'John 3:16-18'));
  const [perSlide, setPerSlide] = useState(1);
  const [numbers, setNumbers] = useState(true);
  const [passage, setPassage] = useState<Passage | null>(null);
  const [manual, setManual] = useState('');
  const [status, setStatus] = useState<{ loading?: boolean; error?: string }>({});

  const chooseTranslation = (id: string) => {
    setTranslation(id);
    setPassage(null);
    setStatus({});
    useStore.getState().updateSettings({ lastBible: id });
  };

  // Imported Bibles answer instantly, so look up as the reference is typed.
  useEffect(() => {
    if (!local) return;
    if (!reference.trim()) {
      setPassage(null);
      setStatus({});
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      lookupLocal(local, reference)
        .then((p) => {
          if (!alive) return;
          setPassage(p);
          setStatus({});
        })
        .catch((e: Error) => {
          if (!alive) return;
          setPassage(null);
          setStatus({ error: e.message });
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [local, reference]);

  const lookupOnline = async () => {
    setStatus({ loading: true });
    setPassage(null);
    try {
      const res = await fetch(`https://bible-api.com/${encodeURIComponent(reference.trim())}?translation=${translation}`);
      if (!res.ok)
        throw new Error(res.status === 404 ? 'Passage not found. Try a form like "Romans 8:28-30".' : `Lookup failed (${res.status}).`);
      const data = (await res.json()) as Passage;
      if (!data.verses?.length) throw new Error('No verses returned.');
      setPassage(data);
      setStatus({});
    } catch (e) {
      setStatus({
        error:
          e instanceof Error && e.message !== 'Failed to fetch'
            ? e.message
            : 'Could not reach the scripture service. Paste the text below, or import a Bible to work offline.',
      });
    }
  };

  const importBible = async () => {
    const [file] = await pickFiles('.rvbible', false);
    if (!file) return;
    setStatus({ loading: true });
    try {
      const meta = await importBibleFile(file);
      chooseTranslation(meta.id);
      notify(`Imported ${meta.abbreviation} (${meta.books.length} books).`, 'success');
    } catch (e) {
      setStatus({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  const create = () => {
    const s = useStore.getState();
    const text = passage ? passageToText(passage, perSlide, numbers) : manualToText(reference.trim(), manual);
    if (!text) return;
    lastReference = reference;
    const title = passage ? `${passage.reference} (${passage.translation_id.toUpperCase()})` : reference.trim() || 'Scripture';
    const themeId = s.themes.some((t) => t.id === 'theme-scripture') ? 'theme-scripture' : undefined;
    const id = s.createPresentation({ title, category: 'scripture', themeId }, text);
    s.addToPlaylist(id);
    s.select(id);
    s.setUI({ mode: 'show' });
    onClose();
  };

  const range = local ? parseReference(reference, local.books) : null;
  const book = range && !('error' in range) ? range.book : undefined;
  const chapter = range && !('error' in range) ? range.chapter : undefined;

  return (
    <Dialog title="Bible" onClose={onClose} wide>
      <form
        className="scripture-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (local && passage) create();
          else if (!local) void lookupOnline();
        }}
      >
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder={local?.language === 'spa' ? 'p. ej. Juan 3:16 o Salmos 23' : 'e.g. John 3:16 or Psalm 23'}
          autoFocus
          aria-label="Reference"
        />
        <select value={translation} onChange={(e) => chooseTranslation(e.target.value)} aria-label="Translation">
          {bibles.length > 0 && (
            <optgroup label="On this computer">
              {bibles.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.abbreviation} · {b.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Online (bible-api.com)">
            {ONLINE.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </optgroup>
        </select>
        {!local && (
          <button className="btn primary" type="submit" disabled={status.loading}>
            {status.loading ? 'Looking up…' : 'Look up'}
          </button>
        )}
      </form>
      {local && (
        <div className="scripture-browse">
          <select
            value={book?.code ?? ''}
            onChange={(e) => {
              const b = local.books.find((x) => x.code === e.target.value);
              if (b) setReference(`${bookLabel(b)} 1`);
            }}
            aria-label="Book"
          >
            <option value="" disabled>
              Book
            </option>
            {local.books.map((b) => (
              <option key={b.code} value={b.code}>
                {bookLabel(b)}
              </option>
            ))}
          </select>
          <select
            value={chapter ?? ''}
            disabled={!book}
            onChange={(e) => book && setReference(`${bookLabel(book)} ${e.target.value}`)}
            aria-label="Chapter"
          >
            <option value="" disabled>
              Chapter
            </option>
            {book?.verses.map((_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
          <span className="muted">or type a reference such as “Jn 3:16”, “Salmos 23:1-3” or “1 Co 13”.</span>
        </div>
      )}
      <div className="scripture-options">
        <label>
          Verses per slide
          <select value={perSlide} onChange={(e) => setPerSlide(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={numbers} onChange={(e) => setNumbers(e.target.checked)} /> Verse numbers
        </label>
      </div>
      {status.error && <p className="error">{status.error}</p>}
      {passage ? (
        <div className="scripture-preview">
          <div className="scripture-ref">
            {passage.reference} · {passage.translation_id.toUpperCase()}
          </div>
          {passage.verses.map((v) => (
            <p key={`${v.chapter}:${v.verse}`}>
              <sup>{v.chapter !== passage.verses[0].chapter || v.verse === 1 ? `${v.chapter}:${v.verse}` : v.verse}</sup> {v.text.trim()}
            </p>
          ))}
        </div>
      ) : (
        !local && (
          <label className="field">
            Or paste the text (blank lines separate slides)
            <textarea rows={6} value={manual} onChange={(e) => setManual(e.target.value)} />
          </label>
        )
      )}
      <p className="muted small-print">
        {local
          ? `${local.name} is stored on this computer and works offline.`
          : 'Online lookups use the free bible-api.com service and public-domain translations.'}{' '}
        Import ProPresenter .rvbible files to add more translations.
      </p>
      <div className="dialog-actions">
        <button className="btn" onClick={importBible} disabled={status.loading}>
          Import Bible (.rvbible)…
        </button>
        <span className="dialog-actions-spacer" />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!passage && (!!local || !manual.trim())} onClick={create}>
          Add to playlist
        </button>
      </div>
    </Dialog>
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
        <IconPicker value={settings.appIcon ?? 'star'} onChange={(appIcon) => s.updateSettings({ appIcon })} />
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
