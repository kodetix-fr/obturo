import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { crc32 as nodeCrc32 } from 'node:zlib';
import { buildZip, crc32, uniqueNames } from './zip.js';

// --- A small reader, independent of the writer: walks the central directory, then checks each local header ---

/** Reads a zip made by buildZip and checks everything a strict extractor would. Returns [{ name, data }]. */
function readZip(buf) {
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50, 'end record at the end of the file');
  const n = buf.readUInt16LE(end + 10);
  assert.equal(buf.readUInt16LE(end + 8), n);
  const centralSize = buf.readUInt32LE(end + 12);
  let p = buf.readUInt32LE(end + 16);
  assert.equal(p + centralSize, end, 'the central directory ends where the end record starts');
  const entries = [];
  let expectedLocal = 0;
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    assert.equal(buf.readUInt16LE(p + 8), 0x0800, 'names flagged as UTF-8');
    assert.equal(buf.readUInt16LE(p + 10), 0, 'stored');
    assert.equal(buf.readUInt16LE(p + 12), 0, 'fixed time');
    assert.equal(buf.readUInt16LE(p + 14), 0x21, 'fixed date: 1980-01-01');
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    assert.equal(buf.readUInt32LE(p + 24), size, 'stored: both sizes are equal');
    const nameLength = buf.readUInt16LE(p + 28);
    assert.equal(buf.readUInt16LE(p + 30), 0, 'no extra field');
    assert.equal(buf.readUInt16LE(p + 32), 0, 'no comment');
    const local = buf.readUInt32LE(p + 42);
    assert.equal(local, expectedLocal, 'entries follow each other without a gap');
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    // the local header says the same
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    assert.equal(buf.readUInt16LE(local + 6), 0x0800);
    assert.equal(buf.readUInt16LE(local + 8), 0);
    assert.equal(buf.readUInt32LE(local + 14), crc);
    assert.equal(buf.readUInt32LE(local + 18), size);
    assert.equal(buf.readUInt32LE(local + 22), size);
    assert.equal(buf.readUInt16LE(local + 26), nameLength);
    assert.equal(buf.readUInt16LE(local + 28), 0);
    assert.equal(buf.toString('utf8', local + 30, local + 30 + nameLength), name);
    const data = buf.subarray(local + 30 + nameLength, local + 30 + nameLength + size);
    assert.equal(nodeCrc32(data), crc, `${name}: CRC-32 checked by zlib`);
    expectedLocal = local + 30 + nameLength + size;
    entries.push({ name, data });
    p += 46 + nameLength;
  }
  assert.equal(expectedLocal, buf.readUInt32LE(end + 16), 'the data ends where the central directory starts');
  return entries;
}

const read = async (blob) => readZip(Buffer.from(await blob.arrayBuffer()));

// --- CRC-32 ---

test('crc32: the published check values', () => {
  const bytes = (s) => new TextEncoder().encode(s);
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(bytes('123456789')), 0xcbf43926);
  assert.equal(crc32(bytes('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

test('crc32: same as zlib for every length and every alignment', () => {
  const big = randomBytes(5000);
  for (let offset = 0; offset < 9; offset++) {
    for (const length of [0, 1, 2, 3, 7, 8, 9, 15, 16, 17, 31, 63, 64, 65, 1000, 4096]) {
      const view = big.subarray(offset, offset + length);
      assert.equal(crc32(view), nodeCrc32(view), `offset ${offset}, length ${length}`);
    }
  }
});

test('crc32: fed chunk by chunk gives the CRC of the whole', () => {
  const data = randomBytes(10_000);
  for (const cuts of [[1], [3, 7], [7, 4103, 4113], [5000], [9999]]) { // positions of the cuts, odd ones on purpose
    let crc = 0;
    let from = 0;
    for (const cut of [...cuts, data.length]) {
      crc = crc32(data.subarray(from, cut), crc);
      from = cut;
    }
    assert.equal(crc, nodeCrc32(data), `cuts ${cuts}`);
  }
});

// --- Names ---

test('uniqueNames: -1, -2 before the extension, whatever the case', () => {
  assert.deepEqual(uniqueNames(['a.png', 'a.png', 'a.png']), ['a.png', 'a-1.png', 'a-2.png']);
  assert.deepEqual(uniqueNames(['a.png', 'A.PNG', 'a.png']), ['a.png', 'A-1.PNG', 'a-2.png'], 'the case is ignored');
  assert.deepEqual(uniqueNames(['x', 'x']), ['x', 'x-1'], 'no extension');
  assert.deepEqual(uniqueNames(['d/.env', 'd/.env']), ['d/.env', 'd/.env-1'], 'a dot file has no extension');
  assert.deepEqual(uniqueNames(['a.tar.gz', 'a.tar.gz']), ['a.tar.gz', 'a.tar-1.gz']);
  assert.deepEqual(uniqueNames(['a.png', 'a-1.png', 'a.png']), ['a.png', 'a-1.png', 'a-2.png'], 'never takes a name that exists');
  assert.deepEqual(uniqueNames(['a.d/b', 'a.d/b']), ['a.d/b', 'a.d/b-1'], 'a dot in a folder is not an extension');
});

// --- Archive ---

test('buildZip: names, folders, UTF-8, empty and binary files come back as they went in', async () => {
  const binary = randomBytes(200_000);
  const files = [
    { name: 'a.png', blob: new Blob([binary], { type: 'image/png' }) },
    { name: 'dossier/capture \u00e9t\u00e9 2026.webp', blob: new Blob(['h\u00e9llo w\u00f6rld']) },
    { name: 'empty.txt', blob: new Blob([]) },
    { name: '\u65e5\u672c\u8a9e.jpg', blob: new Blob([randomBytes(3)]) },
  ];
  const zip = await buildZip(files);
  assert.equal(zip.type, 'application/zip');
  const entries = await read(zip);
  assert.deepEqual(entries.map((e) => e.name), files.map((f) => f.name));
  assert.deepEqual(entries[0].data, binary);
  assert.equal(entries[1].data.toString('utf8'), 'h\u00e9llo w\u00f6rld');
  assert.equal(entries[2].data.length, 0);
});

test('buildZip: a file larger than one chunk of the stream', async () => {
  const data = randomBytes(5 * 1024 * 1024 + 13);
  const [entry] = await read(await buildZip([{ name: 'big.bin', blob: new Blob([data]) }]));
  assert.equal(entry.data.length, data.length);
  assert.ok(entry.data.equals(data));
});

test('buildZip: the same files give the same bytes (fixed date and attributes)', async () => {
  const files = [{ name: 'a', blob: new Blob(['1']) }, { name: 'b', blob: new Blob(['2']) }];
  const one = Buffer.from(await (await buildZip(files)).arrayBuffer());
  const two = Buffer.from(await (await buildZip(files)).arrayBuffer());
  assert.ok(one.equals(two));
});

test('buildZip: repeated names are renamed, never overwritten', async () => {
  const names = (await read(await buildZip([
    { name: 'shot.png', blob: new Blob(['1']) },
    { name: 'shot.png', blob: new Blob(['2']) },
    { name: 'SHOT.png', blob: new Blob(['3']) },
  ]))).map((e) => e.name);
  assert.deepEqual(names, ['shot.png', 'shot-1.png', 'SHOT-2.png']);
});

test('buildZip: a name cannot climb out of the folder it is extracted to', async () => {
  const names = (await read(await buildZip([
    { name: '../../evil.txt', blob: new Blob(['x']) },
    { name: '/etc/passwd', blob: new Blob(['x']) },
    { name: 'a\\b\\c.txt', blob: new Blob(['x']) },
    { name: 'ok/./../nested.txt', blob: new Blob(['x']) },
    { name: 'bell\u0007.txt', blob: new Blob(['x']) },
    { name: '', blob: new Blob(['x']) },
    { name: '..', blob: new Blob(['x']) },
  ]))).map((e) => e.name);
  assert.deepEqual(names, ['evil.txt', 'etc/passwd', 'a/b/c.txt', 'ok/nested.txt', 'bell.txt', 'file', 'file-1']);
});

test('buildZip: no file at all is a valid, empty archive', async () => {
  const zip = await buildZip([]);
  assert.equal(zip.size, 22);
  assert.deepEqual(await read(zip), []);
});

test('buildZip: stops where a zip without ZIP64 stops', async () => {
  const empty = new Blob([]);
  await assert.rejects(buildZip(Array.from({ length: 0x10000 }, (_, i) => ({ name: `f${i}`, blob: empty }))), /too many files/);
  await assert.rejects(buildZip([{ name: 'huge', blob: /** @type {any} */ ({ size: 2 ** 32 }) }]), /too big/);
  await assert.rejects(buildZip([{ name: 'n'.repeat(70_000), blob: empty }]), /name too long/);
});
