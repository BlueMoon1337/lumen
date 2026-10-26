import { PbMessage } from './protobuf';
import { baseName, readZip } from './zip';

export type ImportedPlaylistItem =
  | { type: 'header'; label: string }
  | {
      type: 'presentation';
      name: string;
      /** Name of the bundled .pro entry, when it could be matched. */
      file?: string;
      /** Arrangement the playlist item uses, overriding the song's own choice. */
      arrangementId?: string;
    };

export interface ImportedPlaylist {
  name: string;
  items: ImportedPlaylistItem[];
}

export interface ImportedPlaylistBundle {
  playlists: ImportedPlaylist[];
  /** Bundled presentations by zip entry name. */
  files: Map<string, Uint8Array>;
}

// Field numbers from ProPresenter 7's (unofficial) protobuf schema.
const DOCUMENT = { root: 3 };
const PLAYLIST = { name: 2, children: 12, items: 13 };
const ITEM = { name: 2, header: 3, presentation: 4 };
const PRESENTATION_ITEM = { documentPath: 1, arrangement: 2 };
const URL_FIELDS = { absolute: 1, local: 4 };

const norm = (s: string) => s.normalize('NFC').toLowerCase();

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Reads a ProPresenter 7 `.proplaylist`: a zip holding a protobuf `data`
 * file that describes the playlist(s), plus a copy of every presentation used.
 */
export function parseProPlaylist(bytes: Uint8Array): ImportedPlaylistBundle {
  let entries: Map<string, Uint8Array>;
  try {
    entries = readZip(bytes, (name) => name === 'data' || /\.pro$/i.test(name));
  } catch {
    throw new Error('Not a ProPresenter playlist.');
  }
  const data = entries.get('data');
  if (!data) throw new Error('Not a ProPresenter playlist (no playlist data inside).');
  entries.delete('data');

  const byBaseName = new Map([...entries.keys()].map((name) => [norm(baseName(name)), name]));
  const findFile = (candidates: (string | undefined)[]) => {
    for (const c of candidates) {
      const hit = c && byBaseName.get(norm(baseName(c)));
      if (hit) return hit;
    }
    return undefined;
  };

  const readItem = (item: PbMessage): ImportedPlaylistItem | null => {
    const name = item.string(ITEM.name)?.trim() ?? '';
    if (item.message(ITEM.header)) return { type: 'header', label: name || 'Header' };
    const presentation = item.message(ITEM.presentation);
    if (!presentation) return null; // Media cues, placeholders, Planning Center links.
    const url = presentation.message(PRESENTATION_ITEM.documentPath);
    const file = findFile([
      url?.message(URL_FIELDS.local)?.string(2),
      url?.string(URL_FIELDS.absolute) && safeDecode(url.string(URL_FIELDS.absolute)!),
      name && `${name}.pro`,
    ]);
    const arrangementId = presentation.message(PRESENTATION_ITEM.arrangement)?.string(1) || undefined;
    return { type: 'presentation', name: name || (file ? baseName(file).replace(/\.pro$/i, '') : 'Untitled'), file, arrangementId };
  };

  let root: PbMessage | undefined;
  try {
    root = PbMessage.parse(data).message(DOCUMENT.root);
  } catch {
    root = undefined;
  }
  if (!root) throw new Error('Not a ProPresenter playlist (unreadable playlist data).');

  // Folders hold playlists; every node that holds items becomes a playlist.
  const playlists: ImportedPlaylist[] = [];
  const walk = (node: PbMessage, depth: number) => {
    if (depth > 20) return;
    const items = node.message(PLAYLIST.items);
    if (items) {
      playlists.push({
        name: node.string(PLAYLIST.name)?.trim() || 'Imported Playlist',
        items: items
          .messages(1)
          .map(readItem)
          .filter((i): i is ImportedPlaylistItem => i !== null),
      });
    }
    for (const child of node.message(PLAYLIST.children)?.messages(1) ?? []) walk(child, depth + 1);
  };
  walk(root, 0);

  return { playlists, files: entries };
}
