/**
 * HEIC (and HEIF) photos, the format iPhones take pictures in, become plain JPEGs when they're
 * added to the media bin, so every screen and browser can show them. Safari and the Mac app
 * decode HEIC themselves; elsewhere a HEIC decoder (libheif, via heic-to) is loaded the first
 * time one is needed.
 */

/** The longest side a converted photo keeps: plenty for a 4K screen, and much smaller files than a 48 MP original. */
export const MAX_SIDE = 3840;
const QUALITY = 0.9;

/** HEIF major brands that hold HEVC-coded images (AVIF, also HEIF, is left alone: browsers show it). */
const HEVC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx']);
const GENERIC_BRANDS = new Set(['mif1', 'msf1']);

/** Whether a file's first bytes are a HEIF "ftyp" box for an HEVC image. */
export function looksLikeHeic(head: Uint8Array): boolean {
  const text = (from: number) => String.fromCharCode(...head.subarray(from, from + 4));
  if (head.length < 16 || text(4) !== 'ftyp') return false;
  const major = text(8);
  if (HEVC_BRANDS.has(major)) return true;
  if (!GENERIC_BRANDS.has(major)) return false;
  // A generic HEIF file: HEIC if one of its compatible brands says so (and it isn't AVIF).
  const size = Math.min(head.length, new DataView(head.buffer, head.byteOffset).getUint32(0));
  const brands: string[] = [];
  for (let at = 16; at + 4 <= size; at += 4) brands.push(text(at));
  return brands.some((b) => HEVC_BRANDS.has(b)) && !brands.includes('avif');
}

/** Whether a file is a HEIC photo: by its type, its name, or (when neither says) its first bytes. */
export async function isHeic(file: Blob & { name?: string }): Promise<boolean> {
  if (/^image\/hei[cf]/i.test(file.type)) return true;
  if (/\.hei[cf]$/i.test(file.name ?? '')) return true;
  if (file.type && file.type !== 'application/octet-stream') return false;
  return looksLikeHeic(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
}

/** Decodes a photo: natively where the browser can (Safari, the Mac app), else with libheif. */
async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    const { heicTo } = await import('heic-to');
    return heicTo({ blob: file, type: 'bitmap' });
  }
}

/** A JPEG of a HEIC photo, the same name with .jpg, no larger than MAX_SIDE on its longest side. */
export async function heicToJpeg(file: File): Promise<File> {
  const bitmap = await decode(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas to draw on');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!jpeg) throw new Error('The photo could not be saved as a JPEG');
  return new File([jpeg], `${file.name.replace(/\.(heic|heif)$/i, '')}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
}

/**
 * The files to add, with HEIC photos converted to JPEG. Photos that can't be converted are
 * left out and listed in `failed`.
 */
export async function convertHeicPhotos(
  files: File[],
  onProgress?: (count: number) => void,
): Promise<{ files: File[]; converted: number; failed: string[] }> {
  const heic = await Promise.all(files.map((f) => isHeic(f)));
  const count = heic.filter(Boolean).length;
  if (count) onProgress?.(count);
  const out: File[] = [];
  const failed: string[] = [];
  for (const [i, file] of files.entries()) {
    if (!heic[i]) {
      out.push(file);
      continue;
    }
    try {
      out.push(await heicToJpeg(file));
    } catch {
      failed.push(file.name);
    }
  }
  return { files: out, converted: count - failed.length, failed };
}
