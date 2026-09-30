import { randomBytes } from 'node:crypto';

/**
 * Time-ordered UUID v7 (RFC 9562) for every primary key (ADR-020), on node:crypto only.
 * Layout: 48-bit Unix milliseconds | ver 7 | 12 random bits | var 10 | 62 random bits.
 * Within the same millisecond the 12-bit field counts up so ids stay sortable.
 */
let lastMs = 0;
let seq = 0;

export function newId(now = Date.now()): string {
  let ms = now;
  if (ms <= lastMs) {
    ms = lastMs;
    seq = (seq + 1) & 0x0fff;
    if (seq === 0) ms = ++lastMs; // 4096 ids in one ms: borrow the next ms
  } else {
    seq = randomBytes(2).readUInt16BE(0) & 0x0fff;
  }
  lastMs = ms;

  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(ms, 0, 6);
  bytes.writeUInt16BE(0x7000 | seq, 6);
  randomBytes(8).copy(bytes, 8);
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Milliseconds embedded in a v7 id, for diagnostics. */
export function idTimestamp(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}
