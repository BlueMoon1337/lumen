import { useEffect, useState } from 'react';
import { type DisplayInfo, type OutputKind } from '../outputs';
import { exportLibrary, isLibraryData, useStore } from '../store';
import { Dialog, downloadFile, pickFiles } from './ui';

interface Verse {
  book_name: string;
  chapter: number;
  verse: number;
  text: string;
}

interface Passage {
  reference: string;
  verses: Verse[];
  translation_id: string;
}

const TRANSLATIONS = [
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

export function ScriptureDialog({ onClose }: { onClose: () => void }) {
  const [reference, setReference] = useState('John 3:16-18');
  const [translation, setTranslation] = useState('web');
  const [perSlide, setPerSlide] = useState(1);
  const [numbers, setNumbers] = useState(true);
  const [passage, setPassage] = useState<Passage | null>(null);
  const [manual, setManual] = useState('');
  const [status, setStatus] = useState<{ loading?: boolean; error?: string }>({});

  const lookup = async () => {
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
            : 'Could not reach the scripture service. Paste the text below instead.',
      });
    }
  };

  const create = () => {
    const s = useStore.getState();
    const text = passage ? passageToText(passage, perSlide, numbers) : manualToText(reference.trim(), manual);
    if (!text) return;
    const title = passage ? `${passage.reference} (${passage.translation_id.toUpperCase()})` : reference.trim() || 'Scripture';
    const themeId = s.themes.some((t) => t.id === 'theme-scripture') ? 'theme-scripture' : undefined;
    const id = s.createPresentation({ title, category: 'scripture', themeId }, text);
    s.addToPlaylist(id);
    s.select(id);
    s.setUI({ centerMode: 'show' });
    onClose();
  };

  return (
    <Dialog title="Add scripture" onClose={onClose} wide>
      <form
        className="scripture-form"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="e.g. Psalm 23"
          autoFocus
          aria-label="Reference"
        />
        <select value={translation} onChange={(e) => setTranslation(e.target.value)} aria-label="Translation">
          {TRANSLATIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <button className="btn primary" type="submit" disabled={status.loading}>
          {status.loading ? 'Looking up…' : 'Look up'}
        </button>
      </form>
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
          {passage.verses.map((v) => (
            <p key={`${v.chapter}:${v.verse}`}>
              <sup>{v.verse}</sup> {v.text.trim()}
            </p>
          ))}
        </div>
      ) : (
        <label className="field">
          Or paste the text (blank lines separate slides)
          <textarea rows={6} value={manual} onChange={(e) => setManual(e.target.value)} />
        </label>
      )}
      <p className="muted small-print">
        Lookups use the free bible-api.com service and public-domain translations. Check licensing before projecting other translations.
      </p>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!passage && !manual.trim()} onClick={create}>
          Add to playlist
        </button>
      </div>
    </Dialog>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const themes = useStore((s) => s.themes);
  const media = useStore((s) => s.media);
  const s = useStore.getState();
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);

  useEffect(() => {
    window.lumenDesktop?.getDisplays().then(setDisplays);
  }, []);

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

  const displaySelect = (kind: OutputKind) => {
    const key = kind === 'audience' ? 'audienceDisplay' : 'stageDisplay';
    return (
      <label className="field-row">
        <span>{kind === 'audience' ? 'Audience screen' : 'Stage screen'}</span>
        <select
          value={settings[key] ?? ''}
          onChange={(e) => s.updateSettings({ [key]: e.target.value ? Number(e.target.value) : undefined })}
        >
          <option value="">Automatic</option>
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
              {d.primary ? ' (primary)' : ''}
            </option>
          ))}
        </select>
      </label>
    );
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
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.advanceAcrossItems}
            onChange={(e) => s.updateSettings({ advanceAcrossItems: e.target.checked })}
          />
          After the last slide, continue to the next playlist item
        </label>
      </section>
      {window.lumenDesktop && (
        <section className="settings-section">
          <h4>Screens</h4>
          {displaySelect('audience')}
          {displaySelect('stage')}
        </section>
      )}
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
        <p className="muted small-print">Exports include songs, playlists, themes and messages. Media files stay on this computer.</p>
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
        </dl>
      </section>
    </Dialog>
  );
}
