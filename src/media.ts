import { useEffect, useState } from 'react';

// Media files live in IndexedDB so every window on this origin (control,
// audience, stage) can load them without sending blobs between windows.

const DB_NAME = 'lumen-media';
const STORE = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const putMediaBlob = (id: string, blob: Blob) => request('readwrite', (s) => s.put(blob, id));
export const deleteMediaBlob = (id: string) => {
  const cached = loaded.get(id);
  if (cached) URL.revokeObjectURL(cached.url);
  loaded.delete(id);
  return request('readwrite', (s) => s.delete(id));
};

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
    p = request<Blob | undefined>('readonly', (s) => s.get(id))
      .then((blob) => {
        if (!blob) return null;
        const media = { url: URL.createObjectURL(blob), isVideo: blob.type.startsWith('video/') };
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
  useEffect(() => {
    if (!id) return setMedia(null);
    let alive = true;
    setMedia(loaded.get(id) ?? null);
    loadMedia(id).then((m) => alive && setMedia(m));
    return () => {
      alive = false;
    };
  }, [id]);
  return media;
}
