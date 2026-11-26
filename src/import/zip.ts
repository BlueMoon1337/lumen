import { inflateSync } from 'fflate';

/**
 * Reads the files out of a zip archive.
 *
 * ProPresenter writes its bundles (.proplaylist, some .rvbible) with Zip64
 * sizes in each entry's extra field but a plain end-of-archive record, which
 * standard readers reject. This reader takes the Zip64 sizes wherever an
 * entry's header says 0xFFFFFFFF, regardless of the end record.
 */
export function readZip(bytes: Uint8Array, filter: (name: string) => boolean = () => true): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => view.getUint16(o, true);
  const u32 = (o: number) => view.getUint32(o, true);
  const u64 = (o: number) => u32(o) + u32(o + 4) * 2 ** 32;
  const utf8 = new TextDecoder('utf-8');
  const MAX32 = 0xffffffff;

  // End of central directory: the last record, possibly followed by a comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive.');

  let count = u16(eocd + 10);
  let cdOffset = u32(eocd + 16);
  if ((count === 0xffff || cdOffset === MAX32) && eocd >= 20 && u32(eocd - 20) === 0x07064b50) {
    const z = u64(eocd - 12);
    if (z + 56 <= bytes.length && u32(z) === 0x06064b50) {
      count = u64(z + 32);
      cdOffset = u64(z + 48);
    }
  }

  const files = new Map<string, Uint8Array>();
  let p = cdOffset;
  for (let n = 0; n < count && p + 46 <= bytes.length && u32(p) === 0x02014b50; n++) {
    const method = u16(p + 10);
    let csize = u32(p + 20);
    let usize = u32(p + 24);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    let offset = u32(p + 42);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // Zip64 extra field (0x0001): 8-byte values for each header field that overflowed, in this order.
    for (let e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen; ) {
      const tag = u16(e);
      const size = u16(e + 2);
      if (tag === 0x0001) {
        let q = e + 4;
        if (usize === MAX32) {
          usize = u64(q);
          q += 8;
        }
        if (csize === MAX32) {
          csize = u64(q);
          q += 8;
        }
        if (offset === MAX32) offset = u64(q);
      }
      e += 4 + size;
    }
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/') || !filter(name)) continue;
    if (offset + 30 > bytes.length || u32(offset) !== 0x04034b50) throw new Error(`Damaged zip entry: ${name}`);
    const start = offset + 30 + u16(offset + 26) + u16(offset + 28);
    const data = bytes.subarray(start, start + csize);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, inflateSync(data, { out: new Uint8Array(usize) }));
    else throw new Error(`Unsupported compression in ${name}`);
  }
  return files;
}

export const baseName = (path: string) => path.replace(/^.*[\\/]/, '');
