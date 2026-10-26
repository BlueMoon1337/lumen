import { useEffect, useMemo, useRef, useState } from 'react';
import {
  bookLabel,
  formatRange,
  loadBibleText,
  lookupOnline,
  lookupRange,
  ONLINE_BIBLES,
  parseReference,
  STANDARD_BOOKS,
  type BibleBookMeta,
  type BibleMeta,
  type Passage,
  type PassageRange,
} from '../bible';
import { BIBLE_DRAFT_ID, BIBLE_LIVE_ID, bibleGroups, bibleSettings, buildBibleSlides, slideCapacity } from '../bibleSlides';
import { importBibleFile } from '../commands';
import { getSequence } from '../lyrics';
import { notify } from '../notices';
import { useStore } from '../store';
import { defaultThemes } from '../seed';
import type { BibleReferences, BibleSettings, BibleSlot, BibleTranslation, Category, Theme } from '../types';
import { SlidePreview } from './Canvas';
import { openContextMenu, type ContextEntries } from './ContextMenu';
import { MenuSelect, type MenuEntry } from './MenuSelect';
import { LIBRARIES } from './Sidebar';
import { Dialog, IconButton, pickFiles, Popover } from './ui';

/** A translation Bible mode can read: imported (on this computer) or online. */
interface Source {
  id: string;
  name: string;
  abbreviation: string;
  books: BibleBookMeta[];
  local?: BibleMeta;
  license: string;
}

function sourceFor(id: string, bibles: BibleMeta[]): Source {
  const local = bibles.find((b) => b.id === id);
  if (local)
    return {
      id,
      name: local.name,
      abbreviation: local.abbreviation,
      books: local.books,
      local,
      license:
        local.license ||
        `${local.name} came from a ProPresenter Bible file that doesn't include its license. Check the publisher's terms before showing it in public.`,
    };
  const online = ONLINE_BIBLES.find((b) => b.id === id) ?? ONLINE_BIBLES[0];
  return {
    id: online.id,
    name: online.name,
    abbreviation: online.abbreviation,
    books: STANDARD_BOOKS,
    license: `${online.name} is in the public domain. Lumen looks it up online through bible-api.com.`,
  };
}

const fetchPassage = (src: Source, range: PassageRange) => (src.local ? lookupRange(src.local, range) : lookupOnline(src.id, range));

/** The verse just after (or before) a passage, moving into the next chapter or book. */
function neighbourVerse(range: PassageRange, books: BibleBookMeta[], delta: 1 | -1): string | null {
  const index = books.findIndex((b) => b.code === range.book.code);
  let book = books[index];
  if (!book) return null;
  let chapter: number;
  let verse: number;
  if (delta > 0) {
    chapter = range.endChapter;
    verse = range.endVerse + 1;
    if (verse > book.verses[chapter - 1]) {
      chapter++;
      verse = 1;
      if (chapter > book.verses.length) {
        book = books[index + 1];
        if (!book) return null;
        chapter = 1;
      }
    }
  } else {
    chapter = range.chapter;
    verse = range.verse - 1;
    if (verse < 1) {
      chapter--;
      if (chapter < 1) {
        book = books[index - 1];
        if (!book) return null;
        chapter = book.verses.length;
      }
      verse = book.verses[chapter - 1];
    }
  }
  return `${bookLabel(book)} ${chapter}:${verse}`;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The template with the chosen box highlighted, like the thumbnails in ProPresenter's Verse and Reference menus. */
function SlotThumb({ theme, slot }: { theme: Theme; slot: 'text' | 'caption' }) {
  const own = slot === 'caption' && theme.captionBox;
  const box = own ? theme.captionBox! : theme;
  let x = (box.inset.left / 100) * 160;
  let w = ((100 - box.inset.left - box.inset.right) / 100) * 160;
  let top = (box.inset.top / 100) * 90;
  let h = ((100 - box.inset.top - box.inset.bottom) / 100) * 90;
  let bar = slot === 'text' ? Math.min(h, 14) : Math.min(h, 6);
  if (slot === 'caption' && !own) {
    // No caption box: the caption is a small line under the text.
    bar = 5;
    top = top + h / 2 + 9;
    h = bar;
  }
  if (slot === 'caption') {
    const narrow = w * 0.55;
    x = box.textAlign === 'right' ? x + w - narrow : box.textAlign === 'center' ? x + (w - narrow) / 2 : x;
    w = narrow;
  }
  const y = box.verticalAlign === 'top' ? top : box.verticalAlign === 'bottom' ? top + h - bar : top + (h - bar) / 2;
  return (
    <svg className="slot-thumb" viewBox="0 0 160 90" aria-hidden="true">
      <rect width="160" height="90" fill="#000" />
      <rect x={x} y={y} width={w} height={bar} rx="1" fill="#f2cf3b" />
    </svg>
  );
}

let lastDraftKey = '';

/** A verse slide's right-click menu: show it, or copy it (or the whole passage) to paste into a presentation. */
function bibleSlideMenu(index: number, slideId: string): ContextEntries {
  const s = useStore.getState();
  const draft = s.presentations[BIBLE_DRAFT_ID];
  return [
    { label: 'Show Slide', action: () => s.showBibleSlide(index) },
    '-',
    { label: 'Copy Slide', action: () => s.copySlides(BIBLE_DRAFT_ID, [slideId]) },
    {
      label: 'Copy All Slides',
      action: () =>
        draft &&
        s.copySlides(
          BIBLE_DRAFT_ID,
          getSequence(draft).map((e) => e.slide.id),
        ),
    },
  ];
}
export function BibleView() {
  const settings = useStore((s) => s.settings);
  const bibles = useStore((s) => s.bibles);
  const themes = useStore((s) => s.themes);
  const playlists = useStore((s) => s.playlists);
  const selectedId = useStore((s) => s.selectedPresentationId);
  const selected = useStore((s) => (s.selectedPresentationId ? s.presentations[s.selectedPresentationId] : undefined));
  const draft = useStore((s) => s.presentations[BIBLE_DRAFT_ID]);
  const liveCopy = useStore((s) => s.presentations[BIBLE_LIVE_ID]);
  const live = useStore((s) => s.live.slide);
  const view = useStore((s) => s.settings.slideView);
  const gridSize = useStore((s) => s.settings.gridSize);
  const s = useStore.getState();

  const b = bibleSettings(settings, bibles[0]?.id);
  const update = (patch: Partial<BibleSettings>) => s.updateSettings({ bible: { ...settings.bible, ...patch } });
  const template = themes.find((t) => t.id === b.themeId) ?? themes.find((t) => t.id === 'theme-bible') ?? themes[0] ?? defaultThemes[0];
  const sources = b.translations.map((t) => sourceFor(t.bibleId, bibles));
  const primary = sources[0];

  const [input, setInput] = useState(b.reference);
  const [passages, setPassages] = useState<(Passage | null)[] | null>(null);
  const [status, setStatus] = useState<{ loading?: boolean; error?: string }>({});
  const [pop, setPop] = useState<'options' | 'license' | null>(null);
  const [saving, setSaving] = useState(false);

  const range = useMemo(() => parseReference(b.reference, primary.books), [b.reference, primary.books]);
  const apply = (text: string) => {
    setInput(text);
    if (text.trim() !== b.reference) update({ reference: text.trim() });
  };

  // An imported Bible answers instantly, so passages follow the typing; online ones wait for Return.
  useEffect(() => {
    if (!primary.local || input.trim() === b.reference) return;
    const t = setTimeout(() => {
      if (!('error' in parseReference(input, primary.books))) update({ reference: input.trim() });
    }, 300);
    return () => clearTimeout(t);
    // update() reads the latest settings each render; re-run only when the typing or translation changes.
  }, [input, primary.local]);

  const fetchKey = JSON.stringify(['error' in range ? range.error : formatRange(range), sources.map((x) => x.id)]);
  useEffect(() => {
    if ('error' in range) {
      setPassages(null);
      setStatus({ error: b.reference ? range.error : undefined });
      return;
    }
    let alive = true;
    setStatus({ loading: !primary.local });
    // A missing passage in a parallel translation leaves that translation out, not the slides.
    Promise.all(sources.map((src, i) => fetchPassage(src, range).catch((e: Error) => (i === 0 ? Promise.reject(e) : null))))
      .then((found) => {
        if (!alive) return;
        setPassages(found);
        setStatus({});
      })
      .catch((e: Error) => {
        if (!alive) return;
        setPassages(null);
        setStatus({ error: e.message });
      });
    return () => {
      alive = false;
    };
  }, [fetchKey]);

  // Turn the passage into slides in the template, and keep Bible mode's working presentation in step.
  const optionsKey = JSON.stringify([b.translations, b.showVerseNumbers, b.breakOnNewVerse, b.displayTranslation, b.references]);
  const content = useMemo(() => {
    const first = passages?.[0];
    if (!passages || !first) return null;
    return { title: `${first.reference} (${first.translation_id})`, slides: buildBibleSlides(passages, b, slideCapacity(template)) };
  }, [passages, optionsKey, template]);
  useEffect(() => {
    if (!content) return;
    const key = JSON.stringify([content.title, template.id, content.slides]);
    if (key === lastDraftKey && draft) return;
    lastDraftKey = key;
    s.setBibleDraft({ title: content.title, themeId: template.id, ...bibleGroups(content.slides) });
  }, [content, template.id]);

  const seq = draft && content ? getSequence(draft) : [];
  const liveIndex = live?.presentationId === BIBLE_LIVE_ID && liveCopy && draft && liveCopy.updatedAt === draft.updatedAt ? live.index : -1;
  const liveRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    liveRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [liveIndex]);

  const setRow = (i: number, patch: Partial<BibleTranslation>) =>
    update({ translations: b.translations.map((row, j) => (j === i ? { ...row, ...patch } : row)) });

  const importBible = async (row?: number) => {
    const [file] = await pickFiles('.rvbible', false);
    if (!file) return;
    try {
      const meta = await importBibleFile(file);
      notify(`Imported ${meta.abbreviation} (${meta.books.length} books).`, 'success');
      if (row != null) setRow(row, { bibleId: meta.id });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  // Book › Chapter › Verse, built only as each submenu opens.
  const passageMenu: MenuEntry[] = primary.books.map((book) => ({
    type: 'submenu',
    label: bookLabel(book),
    entries: () =>
      book.verses.map((count, c): MenuEntry => ({
        type: 'submenu',
        label: String(c + 1),
        entries: () => [
          { type: 'item', value: `${book.code}:${c + 1}:0`, label: 'Whole chapter' },
          { type: 'separator' },
          ...Array.from({ length: count }, (_, v): MenuEntry => ({
            type: 'item',
            value: `${book.code}:${c + 1}:${v + 1}`,
            label: String(v + 1),
          })),
        ],
      })),
  }));
  const menuValue = 'error' in range ? '' : `${range.book.code}:${range.chapter}:${range.wholeChapters ? 0 : range.verse}`;
  const pickPassage = (value: string) => {
    const [code, chapter, verse] = value.split(':');
    const book = primary.books.find((x) => x.code === code);
    if (book) apply(verse === '0' ? `${bookLabel(book)} ${chapter}` : `${bookLabel(book)} ${chapter}:${verse}`);
  };

  const translationMenu: MenuEntry[] = [
    ...(bibles.length
      ? [
          { type: 'header', label: 'On this computer' } as MenuEntry,
          ...bibles.map((m): MenuEntry => ({ type: 'item', value: m.id, label: m.name, detail: m.abbreviation })),
        ]
      : []),
    { type: 'header', label: 'Online (public domain)' },
    ...ONLINE_BIBLES.map((o): MenuEntry => ({ type: 'item', value: o.id, label: o.name, detail: o.abbreviation })),
    { type: 'separator' },
    { type: 'item', value: '__import', label: 'Import Bible (.rvbible)…' },
  ];
  const slotMenu: MenuEntry[] = [
    { type: 'item', value: 'none', label: 'None' },
    { type: 'separator' },
    {
      type: 'item',
      value: 'caption',
      label: template.captionBox?.name ?? 'Caption',
      thumbnail: <SlotThumb theme={template} slot="caption" />,
    },
    { type: 'item', value: 'text', label: template.textName ?? 'Text', thumbnail: <SlotThumb theme={template} slot="text" /> },
  ];
  const slotName = (slot: BibleSlot) =>
    slot === 'none' ? 'None' : slot === 'caption' ? (template.captionBox?.name ?? 'Caption') : (template.textName ?? 'Text');

  const step = (delta: 1 | -1) => {
    if ('error' in range) return;
    const next = neighbourVerse(range, primary.books, delta);
    if (next) apply(next);
  };

  const saveMenu: MenuEntry[] = [
    { type: 'item', value: 'save', label: 'Save As…', disabled: !seq.length },
    {
      type: 'item',
      value: 'copy',
      label: 'Copy to Selected Presentation',
      disabled: !seq.length || !selected || selected.hidden,
      title: selected ? `Adds these slides to “${selected.title}”` : 'Select a presentation in the Library first',
    },
    {
      type: 'submenu',
      label: 'Save to Playlist',
      disabled: !seq.length || !playlists.length,
      entries: playlists.map((p): MenuEntry => ({ type: 'item', value: `playlist:${p.id}`, label: p.name })),
    },
  ];
  const onSave = (value: string) => {
    if (!draft) return;
    if (value === 'save') setSaving(true);
    else if (value === 'copy' && selectedId && selected) {
      s.copyBibleTo(selectedId);
      notify(`Added ${draft.title} to “${selected.title}”.`, 'success');
    } else if (value.startsWith('playlist:')) {
      const playlist = playlists.find((p) => p.id === value.slice(9));
      s.saveBible({ title: draft.title, category: b.library, playlistId: playlist?.id });
      notify(`Saved ${draft.title} to the ${playlist?.name ?? ''} playlist.`, 'success');
    }
  };

  return (
    <div className="show-view bible-view">
      <div className="bible-bar">
        <div className="bible-ref">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply(input)}
            onBlur={() => !primary.local && apply(input)}
            placeholder={primary.local?.language === 'spa' ? 'Juan 3:16' : 'John 3:16'}
            aria-label="Passage"
            autoFocus
          />
          <MenuSelect
            label="Choose a passage"
            className="bible-ref-menu"
            value={menuValue}
            display=""
            entries={passageMenu}
            onChange={pickPassage}
          />
        </div>
        <BibleSearch source={primary} onPick={apply} />
        <span className="pres-bar-spacer" />
        <div className="popover-anchor">
          <button className={`btn ${pop === 'options' ? 'on' : ''}`} onClick={() => setPop(pop === 'options' ? null : 'options')}>
            Options
          </button>
          <Popover open={pop === 'options'} onClose={() => setPop(null)} align="right" className="bible-options-pop">
            <BibleOptions settings={b} update={update} template={template} onImport={() => void importBible()} />
          </Popover>
        </div>
      </div>
      <div className="bible-rows">
        {b.translations.map((row, i) => (
          <div className="bible-row" key={i}>
            <MenuSelect
              label="Translation"
              className="bible-translation"
              value={row.bibleId}
              display={sources[i].name}
              entries={translationMenu}
              onChange={(id) => (id === '__import' ? void importBible(i) : setRow(i, { bibleId: id }))}
            />
            <span className="bible-slot-label">Verse</span>
            <MenuSelect
              label="Verse box"
              className="bible-slot"
              value={row.verse}
              display={slotName(row.verse)}
              entries={slotMenu}
              onChange={(v) => setRow(i, { verse: v as BibleSlot })}
            />
            <span className="bible-slot-label">Reference</span>
            <MenuSelect
              label="Reference box"
              className="bible-slot"
              value={row.reference}
              display={slotName(row.reference)}
              entries={slotMenu}
              onChange={(v) => setRow(i, { reference: v as BibleSlot })}
            />
            <span className="pres-bar-spacer" />
            {i === 0 ? (
              <>
                <div className="popover-anchor">
                  <button className="link-btn" onClick={() => setPop(pop === 'license' ? null : 'license')}>
                    License
                  </button>
                  <Popover open={pop === 'license'} onClose={() => setPop(null)} align="right" className="bible-license-pop">
                    {sources.map((src) => (
                      <p key={src.id}>
                        <b>{src.name}</b> ({src.abbreviation})<br />
                        <span className="muted">{src.license}</span>
                      </p>
                    ))}
                  </Popover>
                </div>
                <IconButton
                  icon="plus"
                  title="Add a translation (shown alongside)"
                  disabled={b.translations.length >= 3}
                  onClick={() =>
                    update({
                      translations: [
                        ...b.translations,
                        {
                          bibleId: bibles.find((x) => !b.translations.some((t) => t.bibleId === x.id))?.id ?? 'kjv',
                          verse: 'text',
                          reference: 'none',
                        },
                      ],
                    })
                  }
                />
              </>
            ) : (
              <IconButton
                icon="close"
                title="Remove this translation"
                onClick={() => update({ translations: b.translations.filter((_, j) => j !== i) })}
              />
            )}
          </div>
        ))}
      </div>
      {status.error || status.loading ? (
        <div className={`bible-status ${status.error ? 'error' : ''}`}>{status.error ?? 'Looking up…'}</div>
      ) : null}
      {seq.length ? (
        view === 'list' ? (
          <div className="slide-list">
            {seq.map(({ group, slide }, i) => (
              <div
                key={slide.id}
                role="button"
                tabIndex={-1}
                className={`slide-row ${i === liveIndex ? 'live' : ''}`}
                onClick={() => s.showBibleSlide(i)}
                onContextMenu={(e) => openContextMenu(e, bibleSlideMenu(i, slide.id))}
              >
                <span className="slide-row-label bible-label">{group.name}</span>
                <span className="slide-row-text">{slide.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="slide-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridSize}px, 1fr))` }}>
            {seq.map(({ group, slide }, i) => (
              <div
                key={slide.id}
                ref={i === liveIndex ? liveRef : undefined}
                role="button"
                tabIndex={-1}
                className={`slide-thumb ${i === liveIndex ? 'live' : ''}`}
                onClick={() => s.showBibleSlide(i)}
                onContextMenu={(e) => openContextMenu(e, bibleSlideMenu(i, slide.id))}
                title="Click to show"
              >
                <div className="slide-thumb-canvas">
                  <SlidePreview text={slide.text} caption={slide.caption} theme={template} />
                </div>
                <div className="slide-thumb-label bible-label">
                  <span className="slide-group">{group.name}</span>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="show-empty">
          <p>Type a passage such as “John 3:16-18” or “Psalm 23”, or pick one from the menu next to it.</p>
          <p className="muted">
            Click a slide to show it · <kbd>→</kbd> <kbd>←</kbd> next and previous verse
          </p>
        </div>
      )}
      <div className="pane-footer">
        <MenuSelect label="Save" className="bible-save" value="" display="Save As…" entries={saveMenu} onChange={onSave} />
        <span className="pane-footer-spacer" />
        <button className="verse-step" disabled={'error' in range} onClick={() => step(-1)} title="The verse before this passage">
          ‹ Verse
        </button>
        <button className="verse-step" disabled={'error' in range} onClick={() => step(1)} title="The verse after this passage">
          Verse ›
        </button>
        <span className="pane-footer-spacer" />
        <IconButton icon="grid" title="Grid view" active={view === 'grid'} onClick={() => s.updateSettings({ slideView: 'grid' })} />
        <IconButton icon="list" title="List view" active={view === 'list'} onClick={() => s.updateSettings({ slideView: 'list' })} />
        <input
          type="range"
          className="pink-range"
          min={140}
          max={420}
          value={gridSize}
          disabled={view === 'list'}
          onChange={(e) => s.updateSettings({ gridSize: Number(e.target.value) })}
          aria-label="Slide size"
          title="Slide size"
        />
      </div>
      {saving && draft && (
        <SaveDialog
          title={draft.title}
          library={b.library}
          onClose={() => setSaving(false)}
          onSave={(title, category) => {
            const id = s.saveBible({ title, category });
            setSaving(false);
            if (id) notify(`Saved “${title}” to ${LIBRARIES.find((l) => l.category === category)?.label ?? 'the library'}.`, 'success');
          }}
        />
      )}
    </div>
  );
}

/** Finds verses containing every word typed, in an imported Bible. */
function BibleSearch({ source, onPick }: { source: Source; onPick: (reference: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ reference: string; text: string }[]>([]);
  const [open, setOpen] = useState(false);
  const meta = source.local;

  useEffect(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!meta || !words.length || words.join('').length < 3) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void loadBibleText(meta.id).then((text) => {
        if (!alive || !text) return;
        const found: { reference: string; text: string }[] = [];
        for (const book of meta.books) {
          const chapters = text.books[book.code] ?? [];
          for (let c = 0; c < chapters.length && found.length < 60; c++)
            for (let v = 0; v < chapters[c].length && found.length < 60; v++) {
              const verse = chapters[c][v];
              const folded = fold(verse);
              if (verse && words.every((w) => folded.includes(w)))
                found.push({ reference: `${bookLabel(book)} ${c + 1}:${v + 1}`, text: verse });
            }
          if (found.length >= 60) break;
        }
        setResults(found);
        setOpen(true);
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, meta]);

  return (
    <div className="popover-anchor bible-search">
      <label className="pop-search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder={meta ? 'Search' : 'Search needs an imported Bible'}
          disabled={!meta}
          aria-label="Search the Bible"
        />
      </label>
      <Popover open={open && !!query.trim()} onClose={() => setOpen(false)} className="bible-search-pop">
        {results.length ? (
          <ul className="pop-results">
            {results.map((r) => (
              <li key={r.reference}>
                <button
                  onClick={() => {
                    onPick(r.reference);
                    setOpen(false);
                  }}
                >
                  <span className="pop-result-title">{r.reference}</span>
                  <span className="pop-result-line">{r.text}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pop-empty">No verses contain all of those words.</p>
        )}
      </Popover>
    </div>
  );
}

const REFERENCE_STYLES: [BibleReferences, string][] = [
  ['verse', 'Verse References'],
  ['passage-each', 'Passage Each'],
  ['passage-last', 'Passage Last'],
  ['none', 'No Reference'],
];

function BibleOptions({
  settings: b,
  update,
  template,
  onImport,
}: {
  settings: BibleSettings;
  update: (patch: Partial<BibleSettings>) => void;
  template: Theme;
  onImport: () => void;
}) {
  const [tab, setTab] = useState<'slides' | 'bibles'>('slides');
  const themes = useStore((s) => s.themes);
  const bibles = useStore((s) => s.bibles);
  const s = useStore.getState();
  const check = (key: 'showVerseNumbers' | 'breakOnNewVerse' | 'displayTranslation', label: string) => (
    <label className="check-row">
      <input type="checkbox" checked={b[key]} onChange={(e) => update({ [key]: e.target.checked })} /> {label}
    </label>
  );

  return (
    <div className="bible-options">
      <nav className="bible-options-nav">
        <button className={tab === 'slides' ? 'on' : ''} onClick={() => setTab('slides')}>
          Slide Options
        </button>
        <button className={tab === 'bibles' ? 'on' : ''} onClick={() => setTab('bibles')}>
          Bibles
        </button>
      </nav>
      {tab === 'slides' ? (
        <div className="bible-options-body">
          <div className="bible-options-cols">
            <div>
              {check('showVerseNumbers', 'Show Verse Numbers')}
              {check('breakOnNewVerse', 'Break on New Verse')}
              {check('displayTranslation', 'Display Translation')}
            </div>
            <div role="radiogroup" aria-label="References">
              {REFERENCE_STYLES.map(([value, label]) => (
                <label key={value} className="check-row">
                  <input
                    type="radio"
                    name="bible-references"
                    checked={b.references === value}
                    onChange={() => update({ references: value })}
                  />{' '}
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="bible-options-row">
            <span>Theme</span>
            <MenuSelect
              label="Template"
              className="bible-template"
              value={template.id}
              entries={themes.map((t): MenuEntry => ({
                type: 'item',
                value: t.id,
                label: t.name,
                thumbnail: <SlidePreview text={t.textName ?? 'Text'} caption={t.captionBox?.name ?? 'Reference'} theme={t} />,
              }))}
              onChange={(themeId) => update({ themeId })}
            />
            <button className="btn small" onClick={() => s.setUI({ editingThemeId: template.id })}>
              Edit…
            </button>
          </div>
          <div className="bible-options-row">
            <span>Import Library</span>
            <select value={b.library} onChange={(e) => update({ library: e.target.value as Category })}>
              {LIBRARIES.map((l) => (
                <option key={l.category} value={l.category}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <p className="muted small-print">
            Verses go into the template’s {template.textName ?? 'Text'} box and references into its {template.captionBox?.name ?? 'caption'}
            ; change which with the Verse and Reference menus. Save As puts slides in the Import Library.
          </p>
        </div>
      ) : (
        <div className="bible-options-body">
          {bibles.map((m) => (
            <div key={m.id} className="bible-row-item">
              <span className="list-label">
                <b>{m.abbreviation}</b> {m.name}
              </span>
              <button
                className="btn small danger"
                onClick={() => confirm(`Remove ${m.abbreviation} from this computer?`) && s.deleteBible(m.id)}
              >
                Remove
              </button>
            </div>
          ))}
          {!bibles.length && <p className="muted small-print">No Bibles imported yet. ProPresenter .rvbible files work offline.</p>}
          <div className="button-row">
            <button className="btn" onClick={onImport}>
              Import Bible (.rvbible)…
            </button>
          </div>
          <p className="muted small-print">
            Online, public domain: {ONLINE_BIBLES.map((o) => o.abbreviation).join(', ')} (needs the internet).
          </p>
        </div>
      )}
    </div>
  );
}

function SaveDialog({
  title: initialTitle,
  library,
  onSave,
  onClose,
}: {
  title: string;
  library: Category;
  onSave: (title: string, category: Category) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [category, setCategory] = useState(library);
  return (
    <Dialog title="Save As" onClose={onClose}>
      <form
        className="save-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) onSave(title.trim(), category);
        }}
      >
        <label className="field">
          Name
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="field">
          Library
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {LIBRARIES.map((l) => (
              <option key={l.category} value={l.category}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!title.trim()}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
