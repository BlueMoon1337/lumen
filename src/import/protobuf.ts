/**
 * A minimal Protocol Buffers wire-format reader. ProPresenter 7 files are
 * protobuf messages; reading them field by field avoids bundling its schema.
 */
export interface PbField {
  field: number;
  wire: number;
  /** Varints and floats as numbers; length-delimited fields as bytes. */
  value: number | Uint8Array;
}

const utf8 = new TextDecoder('utf-8');

export class PbMessage {
  private constructor(readonly fields: PbField[]) {}

  static parse(bytes: Uint8Array): PbMessage {
    const fields: PbField[] = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let i = 0;
    const varint = () => {
      let result = 0;
      let scale = 1;
      for (;;) {
        if (i >= bytes.length) throw new Error('Truncated varint');
        const b = bytes[i++];
        result += (b & 0x7f) * scale;
        if (!(b & 0x80)) return result;
        scale *= 128;
      }
    };
    while (i < bytes.length) {
      const key = varint();
      const field = Math.floor(key / 8);
      const wire = key & 7;
      if (field === 0) throw new Error('Invalid field number');
      let value: number | Uint8Array;
      if (wire === 0) value = varint();
      else if (wire === 1) {
        if (i + 8 > bytes.length) throw new Error('Truncated double');
        value = view.getFloat64(i, true);
        i += 8;
      } else if (wire === 5) {
        if (i + 4 > bytes.length) throw new Error('Truncated float');
        value = view.getFloat32(i, true);
        i += 4;
      } else if (wire === 2) {
        const length = varint();
        if (i + length > bytes.length) throw new Error('Truncated field');
        value = bytes.subarray(i, i + length);
        i += length;
      } else throw new Error(`Unsupported wire type ${wire}`);
      fields.push({ field, wire, value });
    }
    return new PbMessage(fields);
  }

  private first(field: number) {
    return this.fields.find((f) => f.field === field)?.value;
  }

  bytes(field: number): Uint8Array | undefined {
    const v = this.first(field);
    return v instanceof Uint8Array ? v : undefined;
  }

  string(field: number): string | undefined {
    const b = this.bytes(field);
    return b && utf8.decode(b);
  }

  number(field: number): number | undefined {
    const v = this.first(field);
    return typeof v === 'number' ? v : undefined;
  }

  message(field: number): PbMessage | undefined {
    const b = this.bytes(field);
    return b && PbMessage.parse(b);
  }

  messages(field: number): PbMessage[] {
    return this.fields.filter((f) => f.field === field && f.value instanceof Uint8Array).map((f) => PbMessage.parse(f.value as Uint8Array));
  }

  /** Follows a path of nested message fields, e.g. path(23, 2, 1). */
  path(...fields: number[]): PbMessage | undefined {
    let m: PbMessage | undefined = this;
    for (const f of fields) m = m?.message(f);
    return m;
  }
}
