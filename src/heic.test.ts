import { describe, expect, it } from 'vitest';
import { isHeic, looksLikeHeic } from './heic';

/** The start of an ISO media file: an ftyp box with a major brand and compatible brands. */
const ftyp = (major: string, ...compatible: string[]) => {
  const brands = [major, '\0\0\0\0', ...compatible].join('');
  const size = 8 + brands.length;
  const bytes = new Uint8Array(Math.max(size, 32));
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(
    [...'ftyp'].map((c) => c.charCodeAt(0)),
    4,
  );
  bytes.set(
    [...brands].map((c) => c.charCodeAt(0)),
    8,
  );
  return bytes;
};

describe('HEIC photos', () => {
  it('are known by their first bytes', () => {
    expect(looksLikeHeic(ftyp('heic', 'mif1', 'heic'))).toBe(true);
    expect(looksLikeHeic(ftyp('heix', 'mif1'))).toBe(true);
    // Generic HEIF: HEIC when a compatible brand says so, but not AVIF (browsers show those).
    expect(looksLikeHeic(ftyp('mif1', 'mif1', 'heic'))).toBe(true);
    expect(looksLikeHeic(ftyp('mif1', 'mif1', 'avif'))).toBe(false);
    expect(looksLikeHeic(ftyp('avif', 'mif1', 'avif'))).toBe(false);
    // An MP4 and a JPEG are not.
    expect(looksLikeHeic(ftyp('isom', 'iso2', 'mp41'))).toBe(false);
    expect(looksLikeHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(28).fill(0)]))).toBe(false);
  });

  it('are known by type, by name, or by content when a file has no type', async () => {
    expect(await isHeic(new File([new Uint8Array(4)], 'IMG_0001.HEIC'))).toBe(true);
    expect(await isHeic(new File([new Uint8Array(4)], 'photo', { type: 'image/heic' }))).toBe(true);
    expect(await isHeic(new File([ftyp('heic', 'mif1', 'heic')], 'photo'))).toBe(true);
    expect(await isHeic(new File([ftyp('heic')], 'photo.jpg', { type: 'image/jpeg' }))).toBe(false);
    expect(await isHeic(new File([ftyp('isom')], 'clip.mp4', { type: 'video/mp4' }))).toBe(false);
  });
});
