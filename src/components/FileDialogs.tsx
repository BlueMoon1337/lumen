import { useMemo, useState } from 'react';
import { getSequence, parseLyrics, slidesEvery, titleFromText } from '../lyrics';
import { notify } from '../notices';
import { IMAGE_SIZES, type ImageFormat } from '../slideImages';
import { useStore } from '../store';
import { exportSlideImages, exportThemes, readClipboard, useFileDialogs } from './fileCommands';
import { LibraryOptions } from './Sidebar';
import { Dialog } from './ui';

const SPLITS = [
  { value: 0, label: 'Blank lines' },
  { value: 1, label: 'Every line' },
  { value: 2, label: 'Every 2 lines' },
  { value: 4, label: 'Every 4 lines' },
];

/** File ▸ Import ▸ Text from Clipboard…: the clipboard's text, made into a presentation. */
export function TextImportDialog({ onClose }: { onClose: () => void }) {
  const initial = useFileDialogs((s) => s.text);
  const [text, setText] = useState(initial);
  const [title, setTitle] = useState(() => titleFromText(initial));
  const [titled, setTitled] = useState(false);
  const [category, setCategory] = useState(() => useStore.getState().libraryCategory);
  const [split, setSplit] = useState(0);
  const shaped = useMemo(() => (split ? slidesEvery(text, split) : text), [text, split]);
  const { slides, groups } = useMemo(() => {
    const parsed = parseLyrics(shaped);
    return { slides: parsed.groups.reduce((n, g) => n + g.slides.length, 0), groups: parsed.groups.length };
  }, [shaped]);

  const edit = (value: string) => {
    setText(value);
    // The title follows the text until it's typed.
    if (!titled) setTitle(titleFromText(value));
  };
  const paste = async () => {
    const pasted = await readClipboard();
    if (pasted.trim()) edit(pasted);
    else notify('There’s no text on the clipboard. Copy some, or type or paste it in here.', 'info');
  };
  const create = () => {
    const s = useStore.getState();
    const name = title.trim() || 'Untitled';
    const id = s.createPresentation({ title: name, category }, shaped);
    s.select(id);
    s.setUI({ sidebar: 'library', libraryCategory: category, mode: 'show' });
    onClose();
    notify(`Made “${name}” with ${slides} slide${slides === 1 ? '' : 's'}.`, 'success');
  };

  return (
    <Dialog title="New Presentation from Text" onClose={onClose} wide className="text-import-dialog">
      <div className="text-import-fields">
        <label className="field">
          Title
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitled(true);
            }}
            placeholder="Untitled"
          />
        </label>
        <label className="field">
          Library
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <LibraryOptions />
          </select>
        </label>
        <label className="field">
          New slide at
          <select value={split} onChange={(e) => setSplit(Number(e.target.value))}>
            {SPLITS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        className="text-import-text"
        value={text}
        onChange={(e) => edit(e.target.value)}
        autoFocus={!initial}
        spellCheck={false}
        placeholder={'Paste or type the words here.\n\nA blank line starts a new slide; a line like [Chorus] starts a group.'}
        aria-label="Text"
      />
      <div className="dialog-actions">
        <span className="muted small-print text-import-count">
          {slides ? `${slides} slide${slides === 1 ? '' : 's'}${groups > 1 ? ` in ${groups} groups` : ''}` : 'No slides yet'}
        </span>
        <span className="dialog-actions-spacer" />
        <button className="btn" onClick={() => void paste()}>
          Paste
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!slides} onClick={create}>
          Create
        </button>
      </div>
    </Dialog>
  );
}

/** File ▸ Export ▸ Slide Images…: the format and size, then where to save them. */
export function SlideImagesDialog({ onClose }: { onClose: () => void }) {
  const id = useFileDialogs((s) => s.presentationId);
  const p = useStore((s) => (id ? s.presentations[id] : undefined));
  const [format, setFormat] = useState<ImageFormat>('jpeg');
  const [width, setWidth] = useState(1920);
  if (!p) return null;
  const count = getSequence(p).length;
  const desktop = !!window.lumenDesktop;
  return (
    <Dialog title="Export Slide Images" onClose={onClose}>
      <p className="muted small-print">
        {count} slide{count === 1 ? '' : 's'} of “{p.title}”, as they look on screen.{' '}
        {desktop ? 'Choose a folder to save them in next.' : 'They download as a .zip file.'}
      </p>
      <div className="field-row">
        <span>Format</span>
        <select value={format} onChange={(e) => setFormat(e.target.value as ImageFormat)}>
          <option value="jpeg">JPEG</option>
          <option value="png">PNG (keeps transparency)</option>
        </select>
      </div>
      <div className="field-row">
        <span>Size</span>
        <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
          {IMAGE_SIZES.map((s) => (
            <option key={s.width} value={s.width}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!count}
          onClick={() => {
            onClose();
            void exportSlideImages(p.id, { format, width });
          }}
        >
          Export…
        </button>
      </div>
    </Dialog>
  );
}

/** File ▸ Export ▸ Themes…: which themes to save. */
export function ExportThemesDialog({ onClose }: { onClose: () => void }) {
  const themes = useStore((s) => s.themes);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(themes.map((t) => t.id)));
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const all = chosen.size === themes.length;
  return (
    <Dialog title="Export Themes" onClose={onClose}>
      <label className="check-row">
        <input type="checkbox" checked={all} onChange={() => setChosen(new Set(all ? [] : themes.map((t) => t.id)))} />
        <b>All themes</b>
      </label>
      <div className="theme-checks">
        {themes.map((t) => (
          <label key={t.id} className="check-row">
            <input type="checkbox" checked={chosen.has(t.id)} onChange={() => toggle(t.id)} />
            {t.name}
          </label>
        ))}
      </div>
      <p className="muted small-print">
        Background images and videos the themes use go with them. Import ▸ File… adds them to another Lumen.
      </p>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!chosen.size}
          onClick={() => {
            onClose();
            void exportThemes(themes.filter((t) => chosen.has(t.id)).map((t) => t.id));
          }}
        >
          Export…
        </button>
      </div>
    </Dialog>
  );
}
