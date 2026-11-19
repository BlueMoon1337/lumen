import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { idbRequest } from './idb';
import type { LumenFolder } from './outputs';

const request = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => idbRequest('blobs', mode, run);

/**
 * A media or audio item kept as a file in Documents ▸ Lumen ▸ Media ▸ Assets (or Audio), as
 * ProPresenter keeps its media: in the desktop app this is stored in place of the item's bytes,
 * and the file is played from where it is.
 */
export interface MediaFile {
  folder: LumenFolder;
  name: string;
  type: string;
}

const isMediaFile = (v: unknown): v is MediaFile =>
  !!v &&
  typeof v === 'object' &&
  !(v instanceof Blob) &&
  typeof (v as MediaFile).name === 'string' &&
  typeof (v as MediaFile).folder === 'string';

let base: Promise<string> | null = null;
/** Documents ▸ Lumen, made if it isn't there. */
const lumenBase = () => (base ??= window.lumenDesktop!.lumenFolder());

let server: Promise<string | null> | null = null;

/**
 * What a file is played from: Lumen's media server on this computer, which streams it as macOS's
 * player expects (src-tauri/src/media_server.rs); or, failing that, the asset protocol, which
 * hands over 1 MB a request and so can stutter on a 4K video's busiest seconds.
 */
const fileUrl = async (f: MediaFile) => {
  server ??= (window.lumenDesktop?.mediaServer?.() ?? Promise.resolve(null)).catch(() => null);
  const address = await server;
  const path = `${f.folder}/${f.name}`;
  return address ? `${address}/${path.split('/').map(encodeURIComponent).join('/')}` : convertFileSrc(`${await lumenBase()}/${path}`);
};

/** Items whose file isn't there: moved or deleted in Finder, or missing from what was imported. */
export const useMissingMedia = create<{ ids: string[] }>(() => ({ ids: [] }));

function setMissing(id: string, missing: boolean) {
  const { ids } = useMissingMedia.getState();
  if (missing !== ids.includes(id)) useMissingMedia.setState({ ids: missing ? [...ids, id] : ids.filter((x) => x !== id) });
}

/** Bumped when an item's file changes (reconnected), so whatever shows it loads it again. */
const useMediaVersions = create<Record<string, number>>(() => ({}));

/** Told when an item's file changes (reconnected) or goes (deleted), e.g. to drop its thumbnail. */
export const mediaChangeListeners = new Set<(id: string) => void>();

/** Drops what's loaded for an item, so it loads again from its new file. */
function forget(id: string) {
  mediaChangeListeners.forEach((f) => f(id));
  const cached = loaded.get(id);
  if (cached?.url.startsWith('blob:')) URL.revokeObjectURL(cached.url);
  loaded.delete(id);
  setMissing(id, false);
  useMediaVersions.setState((v) => ({ [id]: (v[id] ?? 0) + 1 }));
}

export const putMediaBlob = (id: string, blob: Blob) => request('readwrite', (s) => s.put(blob, id));

/** A stored item's bytes: kept by Lumen, or read from its file. Undefined when there are none (or the file is missing). */
export async function getMediaBlob(id: string): Promise<Blob | undefined> {
  const value = await request<unknown>('readonly', (s) => s.get(id));
  if (value instanceof Blob) return value;
  if (!isMediaFile(value) || !window.lumenDesktop?.lumenFileExists) return undefined;
  if (!(await window.lumenDesktop.lumenFileExists(value.folder, value.name))) return undefined;
  return new Blob([await window.lumenDesktop.readLumenFile(value.folder, value.name)], { type: value.type });
}

/** The file an item is kept as, or null (kept by Lumen, as in a browser, or not stored). */
export async function mediaFileOf(id: string): Promise<MediaFile | null> {
  const value = await request<unknown>('readonly', (s) => s.get(id));
  return isMediaFile(value) ? value : null;
}

/** Media is kept as files where the desktop app can keep them; in a browser, by the browser. */
export const keepsFiles = () => !!window.lumenDesktop?.lumenFolder;

/**
 * Stores an imported (or reconnected) media or audio item. In the desktop app it's saved as a file
 * in Documents ▸ Lumen ▸ Media ▸ Assets (audio: Media ▸ Audio), named `fileName` (or numbered,
 * if a different file has that name), and played from there; in a browser, the browser keeps it.
 */
export async function storeMediaFile(id: string, blob: Blob, fileName: string, kind: 'image' | 'video' | 'audio', type = blob.type) {
  const desktop = window.lumenDesktop;
  if (!desktop?.finderFile || !keepsFiles()) {
    await putMediaBlob(id, blob.type || !type ? blob : new Blob([blob], { type }));
    forget(id);
    return;
  }
  await lumenBase();
  const folder: LumenFolder = kind === 'audio' ? 'Media/Audio' : 'Media/Assets';
  const name =
    fileName
      .replace(/[/\\:]/g, '-')
      .replace(/^\.+/, '')
      .trim() || 'Untitled';
  const file = await desktop.finderFile(folder, name, blob.size);
  if (!file.saved) await desktop.writeFinderFile(folder, file.name, new Uint8Array(await blob.arrayBuffer()));
  const kept: MediaFile = { folder, name: file.name, type: type || blob.type };
  await request('readwrite', (s) => s.put(kept, id));
  forget(id);
}

export const deleteMediaBlob = (id: string) => {
  // Its thumbnail goes with it (thumbnails.ts listens).
  mediaChangeListeners.forEach((f) => f(id));
  const cached = loaded.get(id);
  if (cached?.url.startsWith('blob:')) URL.revokeObjectURL(cached.url);
  loaded.delete(id);
  return request('readwrite', (s) => s.delete(id));
};

/**
 * Deletes stored files nothing uses any more. Deleting media keeps its file until then (the
 * next launch), so Undo can bring it back. Files in Documents ▸ Lumen stay: they're yours.
 */
export async function deleteUnusedBlobs(used: Set<string>): Promise<number> {
  const ids = await request<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
  const unused = ids.filter((id): id is string => typeof id === 'string' && !used.has(id));
  await Promise.all(unused.map(deleteMediaBlob));
  return unused.length;
}

export interface LoadedMedia {
  url: string;
  isVideo: boolean;
}

const loaded = new Map<string, LoadedMedia>();
const pending = new Map<string, Promise<LoadedMedia | null>>();

export function loadMedia(id: string): Promise<LoadedMedia | null> {
  const cached = loaded.get(id);
  if (cached) return Promise.resolve(cached);
  let p = pending.get(id);
  if (!p) {
    p = request<unknown>('readonly', (s) => s.get(id))
      .then(async (value) => {
        if (value instanceof Blob) {
          const media = { url: URL.createObjectURL(value), isVideo: value.type.startsWith('video/') };
          loaded.set(id, media);
          return media;
        }
        if (!isMediaFile(value) || !window.lumenDesktop?.lumenFileExists) {
          setMissing(id, value === undefined);
          return null;
        }
        const there = await window.lumenDesktop.lumenFileExists(value.folder, value.name);
        setMissing(id, !there);
        if (!there) return null;
        const media = { url: await fileUrl(value), isVideo: value.type.startsWith('video/') };
        loaded.set(id, media);
        return media;
      })
      .catch(() => null)
      .finally(() => pending.delete(id));
    pending.set(id, p);
  }
  return p;
}

export function useMedia(id: string | null | undefined): LoadedMedia | null {
  const [media, setMedia] = useState<LoadedMedia | null>(() => (id ? (loaded.get(id) ?? null) : null));
  const version = useMediaVersions((v) => (id ? (v[id] ?? 0) : 0));
  useEffect(() => {
    if (!id) return setMedia(null);
    let alive = true;
    setMedia(loaded.get(id) ?? null);
    loadMedia(id).then((m) => alive && setMedia(m));
    return () => {
      alive = false;
    };
  }, [id, version]);
  return media;
}
