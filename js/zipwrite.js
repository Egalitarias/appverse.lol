import { crc32 } from './zip.js';

// Builds a zip archive in memory. Each item: { name, data, body, method } where `body` is the bytes to store
// (`data` itself for method 0, the raw-deflated bytes for method 8).
function assemble(items) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const { name, data, body, method } of items) {
    const n = enc.encode(name), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, n.length, true);
    parts.push(new Uint8Array(lh.buffer), n, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
    ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, n.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), n);
    offset += 30 + n.length + body.length;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, items.length, true); end.setUint16(10, items.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/octet-stream' });
}

/** Stored (uncompressed) zip writer: enough for small packages and downloads, no dependencies.
 *  entries: [[path, Uint8Array], ...]  ->  Blob */
export function buildZip(entries) {
  return assemble(entries.map(([name, data]) => ({ name, data, body: data, method: 0 })));
}

async function deflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Like buildZip but deflates every entry that gets smaller (needs CompressionStream: browsers, Node 18+). */
export async function buildZipCompressed(entries) {
  const items = [];
  for (const [name, data] of entries) {
    let body = data, method = 0;
    if (data.length > 64) {
      const packed = await deflateRaw(data);
      if (packed.length < data.length) { body = packed; method = 8; }
    }
    items.push({ name, data, body, method });
  }
  return assemble(items);
}

/** Offers a Blob as a file download. */
export function downloadBlob(blob, filename) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
