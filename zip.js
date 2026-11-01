// ZIP writer for the library exports (several captures in one file). No DOM, no chrome.*: it runs the same in a page,
// in the service worker and in Node tests (Blob, TextEncoder and DataView only).
//
// The entries are STORED (method 0), not deflated: the captures are PNG, JPEG or WebP, already compressed, so deflating
// them again costs time and gains nothing. The archive is a Blob made of the small headers and of the caller's own
// Blobs as parts, so the pixels are never copied: the only pass over them is the CRC-32, read in chunks (one chunk in
// memory at a time, whatever the size of the file).

// ponytail: classic ZIP without ZIP64: at most 65535 entries, each file and the archive under 4 GiB, else buildZip
// throws; write the ZIP64 records (and the 64-bit sizes) if an export ever needs more.

const UTF8 = 0x0800; // general purpose flag: names in UTF-8
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01, the origin of the format: same files, same archive
const MODE = (0o100644 << 16) >>> 0; // Unix attributes: regular file rw-r--r--
const MAX_U32 = 0xffffffff;
const encoder = new TextEncoder();

// --- CRC-32 (IEEE 802.3, the one of ZIP and PNG), "slicing by 8": eight tables, eight bytes per step, read as two
// 32-bit words. About 3.5 times faster than the byte-at-a-time table loop (measured: ~1 GB/s against ~250 MB/s).
// ponytail: reads words through a Uint32Array, so it assumes a little-endian CPU (every platform Chrome runs on).

/** @type {Uint32Array | undefined} */
let tables; // built on first use, not at load time (the service worker restarts often)

function buildTables() {
  const t = new Uint32Array(256 * 8);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  for (let n = 0; n < 256; n++) {
    let c = t[n];
    for (let k = 1; k < 8; k++) {
      c = t[c & 255] ^ (c >>> 8);
      t[k * 256 + n] = c;
    }
  }
  return t;
}

/**
 * CRC-32 of `bytes`, continuing from `crc` (0 to start), so a file can be fed chunk by chunk.
 * @param {Uint8Array} bytes
 * @param {number} [crc] Value returned for the previous chunk.
 * @returns {number} Unsigned 32-bit CRC.
 */
export function crc32(bytes, crc = 0) {
  const t = (tables ??= buildTables());
  let c = ~crc;
  let i = 0;
  const n = bytes.length;
  while (i < n && (bytes.byteOffset + i) & 3) c = t[(c ^ bytes[i++]) & 255] ^ (c >>> 8); // up to a word boundary
  const pairs = (n - i) >> 3;
  if (pairs > 0) { // (a view at a misaligned offset throws, even an empty one: only built when aligned)
    const w = new Uint32Array(bytes.buffer, bytes.byteOffset + i, pairs * 2);
    for (let k = 0; k < w.length; k += 2) {
      const a = c ^ w[k], b = w[k + 1];
      c = t[1792 + (a & 255)] ^ t[1536 + ((a >>> 8) & 255)] ^ t[1280 + ((a >>> 16) & 255)] ^ t[1024 + (a >>> 24)]
        ^ t[768 + (b & 255)] ^ t[512 + ((b >>> 8) & 255)] ^ t[256 + ((b >>> 16) & 255)] ^ t[b >>> 24];
    }
    i += pairs * 8;
  }
  while (i < n) c = t[(c ^ bytes[i++]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

/** @param {Blob} blob @returns {Promise<number>} CRC-32 of the content, read in chunks. */
async function blobCrc(blob) {
  let crc = 0;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return crc;
    crc = crc32(value, crc);
  }
}

// --- Names ---

// Path inside the archive: "/" separators, no leading slash, no "." or ".." segment (an extractor must never write
// outside its folder), no control character. An empty result becomes "file".
/** @param {string} name */
function cleanName(name) {
  const parts = String(name).replace(/\\/g, '/').replace(/\p{Cc}/gu, '').split('/');
  return parts.filter((p) => p && p !== '.' && p !== '..').join('/') || 'file';
}

// Unique names: a repeated one gets "-1", "-2"... before its extension ("a.png", "a-1.png"). The comparison ignores
// the case, because Windows and macOS extract case-insensitively and would overwrite one file with the other.
/** @param {string[]} names @returns {string[]} */
export function uniqueNames(names) {
  const seen = new Set();
  return names.map((name) => {
    const dot = name.lastIndexOf('.');
    const cut = dot > name.lastIndexOf('/') + 1 ? dot : name.length; // ".hidden" has no extension
    let candidate = name;
    for (let n = 1; seen.has(candidate.toLowerCase()); n++) candidate = `${name.slice(0, cut)}-${n}${name.slice(cut)}`;
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

// --- Archive ---

/**
 * Builds a ZIP archive of stored files.
 * @param {Array<{ name: string, blob: Blob }>} files In archive order. A name may hold "/" for folders.
 * @returns {Promise<Blob>} `application/zip`. Rejects past the limits of a ZIP without ZIP64 (see the top of the file).
 */
export async function buildZip(files) {
  if (files.length > 0xffff) throw new Error('too many files for a zip without ZIP64');
  const names = uniqueNames(files.map((f) => cleanName(f.name))).map((n) => encoder.encode(n));
  const parts = [];
  const central = [];
  let offset = 0;
  let centralSize = 0;

  for (let i = 0; i < files.length; i++) {
    const { blob } = files[i];
    const name = names[i];
    if (name.length > 0xffff) throw new Error('file name too long for a zip');
    if (blob.size > MAX_U32 || offset > MAX_U32) throw new Error('zip too big for a zip without ZIP64');
    const crc = await blobCrc(blob);

    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true); // version needed to extract
    l.setUint16(6, UTF8, true);
    l.setUint16(8, 0, true); // method 0 = stored
    l.setUint16(10, DOS_TIME, true);
    l.setUint16(12, DOS_DATE, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, blob.size, true); // compressed size = size, nothing is deflated
    l.setUint32(22, blob.size, true);
    l.setUint16(26, name.length, true); // extra field length (28): 0
    local.set(name, 30);

    const entry = new Uint8Array(46 + name.length);
    const c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, (3 << 8) | 20, true); // made on Unix (for the attributes), version 2.0
    c.setUint16(6, 20, true);
    c.setUint16(8, UTF8, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, DOS_TIME, true);
    c.setUint16(14, DOS_DATE, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, blob.size, true);
    c.setUint32(24, blob.size, true);
    c.setUint16(28, name.length, true); // extra field, comment, disk, internal attributes (30 to 37): 0
    c.setUint32(38, MODE, true);
    c.setUint32(42, offset, true); // position of the local header
    entry.set(name, 46);

    parts.push(local, blob);
    central.push(entry);
    offset += local.length + blob.size;
    centralSize += entry.length;
  }
  if (offset + centralSize > MAX_U32) throw new Error('zip too big for a zip without ZIP64');

  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true); // entries on this disk (a single "disk"), no comment
  e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
