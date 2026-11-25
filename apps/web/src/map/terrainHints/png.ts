/**
 * A 16-bit grey PNG, written here because a canvas can only save 8 bits: a height map of 256
 * greys shows steps on a gentle slope. The pixels are compressed with the platform's own deflate.
 */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A PNG of 16-bit greys (0 black to 65535 white), `w` × `h`. */
export async function greyPng(grey: Uint16Array, w: number, h: number): Promise<Uint8Array> {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, h);
  header[8] = 16; // bit depth
  header[9] = 0; // greyscale
  const raw = new Uint8Array(h * (1 + w * 2));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 2);
    // Filter "up" for every row but the first: smooth heights compress far better.
    raw[row] = y === 0 ? 0 : 2;
    for (let x = 0; x < w; x++) {
      const v = grey[y * w + x]!;
      const above = y === 0 ? 0 : grey[(y - 1) * w + x]!;
      const hi = (v >> 8) - (y === 0 ? 0 : above >> 8);
      const lo = (v & 255) - (y === 0 ? 0 : above & 255);
      raw[row + 1 + x * 2] = hi & 255;
      raw[row + 2 + x * 2] = lo & 255;
    }
  }
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", await deflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
