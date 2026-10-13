/**
 * Minimal schema-less protobuf reader for the blobs WhatsApp stores in
 * ZWAMEDIAITEM.ZMETADATA and ZWAMESSAGEINFO.ZRECEIPTINFO. Only what we need:
 * varints and length-delimited fields; fixed32/64 are skipped over.
 * Malformed input yields an empty message rather than throwing.
 */
export class ProtoMessage {
  private constructor(private readonly fields: Map<number, Array<number | Buffer>>) {}

  static decode(buf: Buffer | Uint8Array | null | undefined): ProtoMessage {
    const fields = new Map<number, Array<number | Buffer>>();
    if (!buf) return new ProtoMessage(fields);
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    let i = 0;
    const varint = (): number => {
      let result = 0;
      let mult = 1;
      for (;;) {
        if (i >= b.length) throw new RangeError("truncated varint");
        const byte = b[i++];
        result += (byte & 0x7f) * mult;
        if (byte < 0x80) return result;
        mult *= 128;
      }
    };
    try {
      while (i < b.length) {
        const key = varint();
        const field = Math.floor(key / 8);
        const wire = key % 8;
        if (field === 0) throw new RangeError("field 0");
        let value: number | Buffer;
        if (wire === 0) value = varint();
        else if (wire === 2) {
          const len = varint();
          if (i + len > b.length) throw new RangeError("truncated bytes");
          value = b.subarray(i, i + len);
          i += len;
        } else if (wire === 1) {
          i += 8;
          continue;
        } else if (wire === 5) {
          i += 4;
          continue;
        } else throw new RangeError(`wire type ${wire}`);
        const list = fields.get(field);
        if (list) list.push(value);
        else fields.set(field, [value]);
      }
    } catch {
      return new ProtoMessage(new Map());
    }
    return new ProtoMessage(fields);
  }

  has(field: number): boolean {
    return this.fields.has(field);
  }

  int(field: number): number | null {
    const v = this.fields.get(field)?.[0];
    return typeof v === "number" ? v : null;
  }

  /** All varint values of a repeated field, including packed encoding. */
  ints(field: number): number[] {
    const out: number[] = [];
    for (const v of this.fields.get(field) ?? []) {
      if (typeof v === "number") out.push(v);
      else {
        const packed = ProtoMessage.unpackVarints(v);
        if (packed) out.push(...packed);
      }
    }
    return out;
  }

  str(field: number): string | null {
    const v = this.fields.get(field)?.[0];
    return Buffer.isBuffer(v) ? v.toString("utf8") : null;
  }

  msg(field: number): ProtoMessage {
    const v = this.fields.get(field)?.[0];
    return ProtoMessage.decode(Buffer.isBuffer(v) ? v : null);
  }

  msgs(field: number): ProtoMessage[] {
    return (this.fields.get(field) ?? [])
      .filter((v): v is Buffer => Buffer.isBuffer(v))
      .map((v) => ProtoMessage.decode(v));
  }

  /** Follow a path of nested message fields, e.g. path(24, 1). */
  path(...fields: number[]): ProtoMessage {
    let m: ProtoMessage = this;
    for (const f of fields) m = m.msg(f);
    return m;
  }

  private static unpackVarints(b: Buffer): number[] | null {
    const out: number[] = [];
    let i = 0;
    while (i < b.length) {
      let result = 0;
      let mult = 1;
      for (;;) {
        if (i >= b.length) return null;
        const byte = b[i++];
        result += (byte & 0x7f) * mult;
        if (byte < 0x80) break;
        mult *= 128;
      }
      out.push(result);
    }
    return out;
  }
}
