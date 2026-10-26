import { useEffect, useState } from 'react';
import { idbRequest } from './idb';

const request = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => idbRequest('blobs', mode, run);

export const putMediaBlob = (id: string, blob: Blob) => request('readwrite', (s) => s.put(blob, id));
export const getMediaBlob = (id: string) => request<Blob | undefined>('readonly', (s) => s.get(id));
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
