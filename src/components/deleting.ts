/**
 * Deleting things, from menus, buttons and the Delete key. Whatever holds other things (a
 * presentation, a playlist, a group of slides, a library) asks first and says what goes with
 * it; a single slide or playlist entry goes straight away, as in ProPresenter. All of it can
 * be undone.
 */
import { notify } from '../notices';
import { useStore } from '../store';
import type { Presentation } from '../types';
import { confirmThen } from './Ask';
import { shortcut } from './ui';

const st = () => useStore.getState();
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sentences = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** "You can undo this with ⌘Z." */
export const undoHint = () => `You can undo this with ${shortcut('Z')}.`;

const slidesOf = (p: Presentation) => p.groups.flatMap((g) => g.slides);

const usesMedia = (p: Presentation, id: string) => slidesOf(p).filter((sl) => sl.media === id || sl.background?.mediaId === id).length;

export function deletePresentation(id: string) {
  const s = st();
  const p = s.presentations[id];
  if (!p) return;
  const playlists = s.playlists.filter((pl) => pl.items.some((it) => it.type === 'presentation' && it.presentationId === id)).length;
  const live = s.live.slide?.presentationId === id || s.live.announcement?.presentationId === id;
  confirmThen(
    {
      title: `Delete “${p.title}”?`,
      message: sentences(
        playlists > 0 && `It comes out of ${playlists === 1 ? 'the playlist' : `the ${playlists} playlists`} it’s in, too.`,
        live && 'It’s on screen, and will be cleared.',
        undoHint(),
      ),
      confirmLabel: 'Delete',
      danger: true,
    },
    () => st().deletePresentation(id),
  );
}

/** Deletes a slide (no question: it's one slide, and Undo brings it back). In Edit mode the slide after it is selected. */
export function deleteSlide(presentationId: string, slideId: string) {
  const s = st();
  const p = s.presentations[presentationId];
  if (!p) return;
  const slides = slidesOf(p);
  const at = slides.findIndex((sl) => sl.id === slideId);
  if (at < 0) return;
  const neighbour = slides[at + 1] ?? slides[at - 1];
  const wasSelected = s.editSlideId === slideId;
  s.deleteSlide(presentationId, slideId);
  if (wasSelected && neighbour) st().setUI({ editSlideId: neighbour.id, editTextSelected: false });
  notify(`Deleted slide ${at + 1}. ${undoHint()}`, 'info', 3500);
}

export function deleteGroup(presentationId: string, groupId: string) {
  const p = st().presentations[presentationId];
  const group = p?.groups.find((g) => g.id === groupId);
  if (!p || !group) return;
  const run = () => st().deleteGroup(presentationId, groupId);
  if (group.slides.length <= 1) {
    run();
    return void notify(`Deleted “${group.name}”. ${undoHint()}`, 'info', 3500);
  }
  confirmThen(
    {
      title: `Delete “${group.name}” and its ${count(group.slides.length, 'slide')}?`,
      message: undoHint(),
      confirmLabel: 'Delete',
      danger: true,
    },
    run,
  );
}

export function deletePlaylist(id: string) {
  const s = st();
  const pl = s.playlists.find((x) => x.id === id);
  if (!pl) return;
  if (s.playlists.length <= 1) return void notify('Lumen keeps at least one playlist. Make another before deleting this one.', 'info');
  const items = pl.items.filter((it) => it.type === 'presentation').length;
  confirmThen(
    {
      title: `Delete the playlist “${pl.name}”?`,
      message: sentences(items > 0 && `Its ${count(items, 'presentation')} stay in the library.`, undoHint()),
      confirmLabel: 'Delete',
      danger: true,
    },
    () => st().deletePlaylist(id),
  );
}

/** Takes an entry (a presentation or a header) out of the open playlist; the presentation stays in the library. */
export function removePlaylistItem(itemId: string) {
  const s = st();
  const pl = s.playlists.find((x) => x.items.some((it) => it.id === itemId));
  const item = pl?.items.find((it) => it.id === itemId);
  if (!pl || !item) return;
  // Select the entry that takes its place, so Delete can go on down the list.
  const at = pl.items.indexOf(item);
  const next = [...pl.items.slice(at + 1), ...pl.items.slice(0, at).reverse()].find((it) => it.type === 'presentation');
  const wasSelected = s.selectedPlaylistItemId === itemId;
  s.removePlaylistItem(itemId);
  if (wasSelected && next?.type === 'presentation') st().select(next.presentationId, next.id);
  const name =
    item.type === 'header' ? `the header “${item.label}”` : `“${s.presentations[item.presentationId]?.title ?? 'Missing presentation'}”`;
  notify(`Removed ${name} from ${pl.name}. ${undoHint()}`, 'info', 3500);
}

export function deleteMedia(id: string) {
  const s = st();
  const m = s.media.find((x) => x.id === id);
  if (!m) return;
  const slides = Object.values(s.presentations).reduce((n, p) => n + usesMedia(p, id), 0);
  const themes = s.themes.filter((t) => t.background.mediaId === id).length;
  const live = s.live.mediaId === id || s.live.audioId === id;
  const uses = [slides > 0 && count(slides, 'slide'), themes > 0 && count(themes, 'theme'), s.settings.logoMediaId === id && 'the logo']
    .filter(Boolean)
    .join(', ');
  confirmThen(
    {
      title: `Delete “${m.name}”?`,
      message: sentences(
        uses && `It’s used by ${uses}, which will do without it.`,
        live && 'It’s playing now, and will be cleared.',
        undoHint(),
      ),
      confirmLabel: 'Delete',
      danger: true,
    },
    () => st().deleteMedia(id),
  );
}

export function deleteMediaPlaylist(id: string) {
  const pl = st().mediaPlaylists.find((x) => x.id === id);
  if (!pl) return;
  confirmThen(
    {
      title: `Delete the media playlist “${pl.name}”?`,
      message: sentences(pl.items.length > 0 && 'Its media stays in the media bin.', undoHint()),
      confirmLabel: 'Delete',
      danger: true,
    },
    () => st().deleteMediaPlaylist(id),
  );
}

export function deleteTheme(id: string) {
  const s = st();
  const t = s.themes.find((x) => x.id === id);
  if (!t) return;
  if (s.themes.length <= 1) return void notify('Lumen needs at least one theme.', 'info');
  const users = Object.values(s.presentations).filter((p) => p.themeId === id).length;
  confirmThen(
    {
      title: `Delete the theme “${t.name}”?`,
      message: sentences(users > 0 && `${count(users, 'presentation')} using it will use the default theme.`, undoHint()),
      confirmLabel: 'Delete',
      danger: true,
    },
    () => st().deleteTheme(id),
  );
}

/** Bibles and fonts are files on this computer rather than library edits, so these can't be undone. */
export function deleteBible(id: string) {
  const b = st().bibles.find((x) => x.id === id);
  if (!b) return;
  confirmThen(
    {
      title: `Remove ${b.abbreviation} from this computer?`,
      message: 'Passages already saved as presentations stay. This can’t be undone: import the Bible file again to get it back.',
      confirmLabel: 'Remove',
      danger: true,
    },
    () => st().deleteBible(id),
  );
}

export function deleteFont(id: string, name: string) {
  confirmThen(
    {
      title: `Remove ${name}?`,
      message: 'Text set in it falls back to a standard font. This can’t be undone: add the font file again to get it back.',
      confirmLabel: 'Remove',
      danger: true,
    },
    () => st().deleteFont(id),
  );
}

export function deleteLibrary(id: string) {
  const s = st();
  const lib = s.libraries.find((l) => l.id === id);
  if (!lib) return;
  if (s.libraries.length <= 1) return void notify('Lumen keeps at least one library. Make another before deleting this one.', 'info');
  const n = Object.values(s.presentations).filter((p) => p.category === id && !p.hidden).length;
  confirmThen(
    {
      title: `Delete the library “${lib.name}”?`,
      message: sentences(
        n > 0 && `Its ${count(n, 'presentation')} ${n === 1 ? 'is' : 'are'} deleted with it, and taken out of any playlists.`,
        undoHint(),
      ),
      confirmLabel: 'Delete',
      danger: true,
    },
    () => st().deleteLibrary(id),
  );
}
