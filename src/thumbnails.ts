/**
 * Small pictures of the media bin's images and videos. A tile drawing the file itself has a 4K
 * image or video to decode, so scrolling through the bin quickly stuttered and left tiles blank;
 * a thumbnail is a small JPEG, made once (a few at a time, in the background), kept in this
 * browser's storage, and drawn at once after that.
 */
import { useEffect, useState } from 'react';
import { loadMedia, mediaChangeListeners } from './media';

export interface Thumbnail {
  url: string;
  /** A video's length in seconds. */
  duration?: number;
}

interface Saved {
  blob: Blob;
  duration?: number;
}

const WIDTH = 384;
const DB = 'lumen-thumbnails';
const STORE = 'thumbs';

let db: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}
async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await open();
  return new Promise((resolve, reject) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

const ready = new Map<string, Thumbnail>();
const making = new Map<string, Promise<Thumbnail | null>>();

// A reconnected file gets a new thumbnail.
mediaChangeListeners.add((id) => {
  const t = ready.get(id);
  if (t) URL.revokeObjectURL(t.url);
  ready.delete(id);
  making.delete(id);
  void idb('readwrite', (s) => s.delete(id)).catch(() => {});
});

/** Draws a picture into a small JPEG, keeping its shape. */
function shrink(source: CanvasImageSource, w: number, h: number): Promise<Blob> {
  const scale = Math.min(1, WIDTH / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No thumbnail'))), 'image/jpeg', 0.8));
}

function fromImage(url: string): Promise<Saved> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => shrink(img, img.naturalWidth, img.naturalHeight).then((blob) => resolve({ blob }), reject);
    img.onerror = () => reject(new Error('Image didn’t load'));
    img.src = url;
  });
}

/** A frame half a second in (past a fade from black), and the video's length. */
function fromVideo(url: string): Promise<Saved> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    const done = () => {
      v.removeAttribute('src');
      v.load();
    };
    const timer = window.setTimeout(() => (done(), reject(new Error('Video took too long'))), 20000);
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.5, Number.isFinite(v.duration) ? v.duration / 2 : 0.5);
    };
    v.onseeked = () => {
      window.clearTimeout(timer);
      const duration = Number.isFinite(v.duration) ? v.duration : undefined;
      shrink(v, v.videoWidth, v.videoHeight)
        .then((blob) => resolve({ blob, duration }), reject)
        .finally(done);
    };
    v.onerror = () => (window.clearTimeout(timer), done(), reject(new Error('Video didn’t load')));
    v.src = url;
  });
}

// Two at a time, so making them doesn't hold up the rest of Lumen.
let running = 0;
const queue: (() => void)[] = [];
async function inTurn<T>(run: () => Promise<T>): Promise<T> {
  // A slot is handed straight to the next in line, so a newcomer can't slip in between.
  if (running >= 2) await new Promise<void>((go) => queue.push(go));
  else running++;
  try {
    return await run();
  } finally {
    const next = queue.shift();
    if (next) next();
    else running--;
  }
}

function thumbnail(id: string): Promise<Thumbnail | null> {
  const have = ready.get(id);
  if (have) return Promise.resolve(have);
  let p = making.get(id);
  if (p) return p;
  p = (async () => {
    let saved = await idb<Saved | undefined>('readonly', (s) => s.get(id)).catch(() => undefined);
    if (!saved) {
      const media = await loadMedia(id);
      if (!media) return null;
      saved = await inTurn(() => (media.isVideo ? fromVideo(media.url) : fromImage(media.url)));
      void idb('readwrite', (s) => s.put(saved, id)).catch(() => {});
    }
    const t = { url: URL.createObjectURL(saved.blob), duration: saved.duration };
    ready.set(id, t);
    return t;
  })().catch(() => null);
  making.set(id, p);
  return p;
}

/**
 * An item's thumbnail: undefined while it's being found or made, null if it can't be made
 * (then show the file itself).
 */
export function useThumbnail(id: string, version: unknown): Thumbnail | null | undefined {
  const [t, setT] = useState<Thumbnail | null | undefined>(() => ready.get(id));
  useEffect(() => {
    let alive = true;
    setT(ready.get(id));
    void thumbnail(id).then((x) => alive && setT(x));
    return () => {
      alive = false;
    };
  }, [id, version]);
  return t;
}
