// Splitting a blob across many LoRa packets, and putting it back together.
//
// Wire format, one fragment per line:
//   !B<id>.<seq>.<total>.<kind><enc> <base64 chunk>
// plus two control lines:
//   !BE<id>            end of transmission, check what you are missing
//   !BR<id> 3,7,12     resend these
//
// The blob is encrypted ONCE before fragmenting, not per fragment. Encrypting
// each line separately would add 28 bytes plus base64 expansion to every one of
// them and roughly halve throughput on a link that has none to spare. The
// headers stay in the clear as a result - sequence numbers and a one-letter
// kind, which is no more than the sender name already leaks.

export const FRAG_PREFIX = '!B';

// The firmware caps a serial line at 200 characters and prefixes "NAME: "
// before transmitting, so this leaves room under both that and the SX1262's
// 255-byte packet.
export const MAX_LINE = 180;

const FRAG_RE = /^!B([0-9a-z]{3})\.(\d+)\.(\d+)\.([iat])([01]) (.+)$/;
const END_RE = /^!BE([0-9a-z]{3})$/;
const REQ_RE = /^!BR([0-9a-z]{3}) ([\d,]+)$/;

export function makeId() {
  return Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
}

// Worst-case header for the given total, so every chunk is the same size and
// the last fragment cannot overflow the line limit.
function chunkSize(total) {
  const header = `!Bzzz.${total}.${total}.i1 `.length;
  return MAX_LINE - header;
}

export function packFragments({ id, kind, encrypted, payload }) {
  if (!/^[iat]$/.test(kind)) throw new Error(`bad kind: ${kind}`);
  if (typeof payload !== 'string' || !payload.length) throw new Error('empty payload');

  const enc = encrypted ? '1' : '0';
  // Two passes: the header grows with the digit count of the total, which
  // itself depends on the chunk size.
  let total = Math.ceil(payload.length / chunkSize(1));
  total = Math.ceil(payload.length / chunkSize(total));

  const size = chunkSize(total);
  const lines = [];
  for (let seq = 0; seq < total; seq++) {
    lines.push(`!B${id}.${seq}.${total}.${kind}${enc} ${payload.slice(seq * size, (seq + 1) * size)}`);
  }
  return lines;
}

export function parseFragment(line) {
  const m = FRAG_RE.exec(String(line).trim());
  if (!m) return null;
  const seq = Number(m[2]);
  const total = Number(m[3]);
  if (!total || seq >= total) return null;
  return { id: m[1], seq, total, kind: m[4], encrypted: m[5] === '1', chunk: m[6] };
}

export const endLine = (id) => `!BE${id}`;
export const requestLine = (id, missing) => `!BR${id} ${missing.join(',')}`;

export function parseEnd(line) {
  const m = END_RE.exec(String(line).trim());
  return m ? m[1] : null;
}

export function parseRequest(line) {
  const m = REQ_RE.exec(String(line).trim());
  if (!m) return null;
  return { id: m[1], missing: m[2].split(',').map(Number).filter(Number.isFinite) };
}

export function createAssembly(frag) {
  return {
    id: frag.id,
    total: frag.total,
    kind: frag.kind,
    encrypted: frag.encrypted,
    chunks: new Array(frag.total).fill(null),
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Returns true if this fragment was new.
export function addFragment(asm, frag) {
  if (frag.id !== asm.id || frag.total !== asm.total) return false;
  asm.updatedAt = Date.now();
  if (asm.chunks[frag.seq] !== null) return false;  // duplicate resend
  asm.chunks[frag.seq] = frag.chunk;
  return true;
}

export function missingOf(asm) {
  const out = [];
  for (let i = 0; i < asm.total; i++) if (asm.chunks[i] === null) out.push(i);
  return out;
}

export function receivedCount(asm) {
  return asm.total - missingOf(asm).length;
}

export function isComplete(asm) {
  return missingOf(asm).length === 0;
}

export function assembled(asm) {
  if (!isComplete(asm)) return null;
  return asm.chunks.join('');
}

// A request listing every missing fragment can exceed a line on a bad transfer,
// so ask for as many as fit and let the next round cover the rest.
export function splitRequest(id, missing) {
  const rooms = MAX_LINE - `!BR${id} `.length;
  const out = [];
  let batch = [];
  for (const seq of missing) {
    const next = batch.concat([seq]);
    if (next.join(',').length > rooms) {
      out.push(batch);
      batch = [seq];
    } else {
      batch = next;
    }
  }
  if (batch.length) out.push(batch);
  return out;
}
