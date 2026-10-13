// Minimal, defensive ZIP reader. Works in browsers and Node 18+ (uses DecompressionStream).
// Treats the archive as hostile: caps entry count/sizes, verifies CRC, rejects unsafe paths.

export const LIMITS = {
  maxEntries: 2000,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function safePath(name) {
  if (
    !name ||
    name.length > 255 ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    /^[a-zA-Z]:/.test(name) ||
    name.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')
  ) {
    throw new Error(`Unsafe path in package: ${JSON.stringify(name)}`);
  }
  return name;
}

async function inflateRaw(bytes, expected) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > expected) {
      await reader.cancel();
      throw new Error('Entry decompresses to more than its declared size (zip bomb?)');
    }
    chunks.push(value);
  }
  if (total !== expected) throw new Error('Entry size mismatch');
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Parses a .applet/.zip file. Returns Map<path, Uint8Array>. */
export async function readZip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => view.getUint16(o, true);
  const u32 = (o) => view.getUint32(o, true);

  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid .applet or .zip file (no zip directory found)');

  const count = u16(eocd + 10);
  const cdOffset = u32(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('Zip64 is not supported');
  if (count > LIMITS.maxEntries) throw new Error(`Too many files (${count})`);

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = new Map();
  let totalBytes = 0;
  let p = cdOffset;

  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(p) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const flags = u16(p + 8);
    const method = u16(p + 10);
    const crc = u32(p + 16);
    const csize = u32(p + 20);
    const size = u32(p + 24);
    const nlen = u16(p + 28);
    const elen = u16(p + 30);
    const clen = u16(p + 32);
    const local = u32(p + 42);
    const rawName = bytes.subarray(p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;

    const name = decoder.decode(rawName);
    if (name.endsWith('/')) continue; // directory entry
    safePath(name);
    if (files.has(name)) throw new Error(`Duplicate entry: ${name}`);
    if (flags & 1) throw new Error('Encrypted entries are not supported');
    if (size > LIMITS.maxFileBytes) throw new Error(`File too large: ${name}`);
    totalBytes += size;
    if (totalBytes > LIMITS.maxTotalBytes) throw new Error('Package is too large when unpacked');

    if (local + 30 > bytes.length || u32(local) !== 0x04034b50) throw new Error('Corrupt local header');
    const dataStart = local + 30 + u16(local + 26) + u16(local + 28);
    if (dataStart + csize > bytes.length) throw new Error('Truncated entry');
    const raw = bytes.subarray(dataStart, dataStart + csize);

    let data;
    if (method === 0) {
      if (csize !== size) throw new Error('Entry size mismatch');
      data = raw.slice();
    } else if (method === 8) {
      data = await inflateRaw(raw, size);
    } else {
      throw new Error(`Unsupported compression method ${method} for ${name}`);
    }
    if (crc32(data) !== crc) throw new Error(`Checksum failed for ${name}`);
    files.set(name, data);
  }
  return files;
}

export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
