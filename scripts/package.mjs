// Produces dist/obturo-<version>.zip with only the runtime files of the extension.
// Usage: npm run package   (or: node scripts/package.mjs [extension-folder])
// Cross-platform, no dependency: the zip is written here, with node:zlib (Node >= 22.2 for zlib.crc32).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants, crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

// By default: the repository that contains this script. The optional argument is for trying the script on a dummy folder.
const root = process.argv[2] ? resolve(process.argv[2]) : join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Exclusion list (not an inclusion list): stays valid when new runtime files appear ---

const EXCLUDED_ROOT_DIRS = new Set(['docs', 'scripts', 'test', 'dist', 'types', 'coverage']);
const EXCLUDED_NAMES = new Set(['readme.md', 'package.json', 'package-lock.json']);
const SUFFIXES = ['.test.js', '.zip', '.crx', '.pem'];

// rel: relative path with "/" separators. Used for files and folders (an excluded folder is not walked).
function isExcluded(rel) {
  const segments = rel.split('/');
  if (EXCLUDED_ROOT_DIRS.has(segments[0].toLowerCase())) return true;
  // hidden folders and files (.git*, .github...) and node_modules, at any level
  if (segments.some((s) => s.startsWith('.') || s === 'node_modules')) return true;
  const base = segments.at(-1).toLowerCase();
  if (EXCLUDED_NAMES.has(base) || /^tsconfig.*\.json$/.test(base) || /^eslint\.config\./.test(base)) return true;
  if (SUFFIXES.some((s) => base.endsWith(s))) return true;
  // Every .md outside vendor/ stays out of the package, THIRD_PARTY_NOTICES.md included: the license of Fabric.js
  // travels in vendor/fabric.LICENSE (full text). LICENSE, with no extension, stays at the root: it is Obturo's license.
  return base.endsWith('.md') && segments[0] !== 'vendor';
}

// Runtime files of the extension in `base` (relative paths with "/" separators). The E2E tests use it too, to load
// into Chrome exactly what the package contains.
export function listRuntimeFiles(base, rel = '') {
  const files = [];
  for (const e of readdirSync(join(base, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (isExcluded(r)) continue;
    if (e.isDirectory()) files.push(...listRuntimeFiles(base, r));
    else if (e.isFile()) files.push(r);
    else throw new Error(`unexpected entry (link or special file): ${r}`);
  }
  return files;
}

// --- Manifest texts: __MSG_key__ resolved against _locales/<lang>/messages.json (Chrome's format) ---
// The manifest tests use these too.

export const MSG_REF = /__MSG_(\w+)__/g;

/** Every _locales/<lang>/messages.json of `base`: { lang: { key: { message } } }. Empty without a _locales folder. */
export function readLocales(base) {
  /** @type {Record<string, Record<string, { message: string }>>} */
  const locales = {};
  const dir = join(base, '_locales');
  if (!existsSync(dir)) return locales;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) locales[e.name] = JSON.parse(readFileSync(join(dir, e.name, 'messages.json'), 'utf8'));
  }
  return locales;
}

/** A manifest value with its __MSG_key__ replaced by the text of one language (unknown keys are left as they are). */
export function localize(value, messages) {
  if (typeof value === 'string') return value.replace(MSG_REF, (ref, key) => messages[key]?.message ?? ref);
  if (Array.isArray(value)) return value.map((v) => localize(v, messages));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, localize(v, messages)]));
  return value;
}

// --- Writing the zip ---
// ponytail: classic ZIP without ZIP64 (a few hundred KB of runtime files); the writer throws past 65535 entries or
// 4 GiB, add the ZIP64 records if the package ever grows that far.

// Fixed timestamp (1980-01-01 00:00, the origin of the format): same input files, same zip.
const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1;
const UTF8 = 0x0800; // "names in UTF-8" flag
const MODE = (0o100644 << 16) >>> 0; // Unix attributes: regular file rw-r--r--

// Local header of a file (30 bytes + name): fields in the order of the ZIP specification.
function localHeader(nameBuf, method, crc, csize, usize) {
  const b = Buffer.alloc(30);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(20, 4);         // version needed to extract
  b.writeUInt16LE(UTF8, 6);       // flags
  b.writeUInt16LE(method, 8);     // 0 = stored, 8 = deflate
  b.writeUInt16LE(DOS_TIME, 10);
  b.writeUInt16LE(DOS_DATE, 12);
  b.writeUInt32LE(crc, 14);
  b.writeUInt32LE(csize, 18);
  b.writeUInt32LE(usize, 22);
  b.writeUInt16LE(nameBuf.length, 26);
  return b;                       // extra field length (byte 28): 0
}

// Central directory entry (46 bytes + name).
function centralHeader(nameBuf, method, crc, csize, usize, offset) {
  const b = Buffer.alloc(46);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE((3 << 8) | 20, 4); // created on Unix (for the attributes), version 2.0
  b.writeUInt16LE(20, 6);
  b.writeUInt16LE(UTF8, 8);
  b.writeUInt16LE(method, 10);
  b.writeUInt16LE(DOS_TIME, 12);
  b.writeUInt16LE(DOS_DATE, 14);
  b.writeUInt32LE(crc, 16);
  b.writeUInt32LE(csize, 20);
  b.writeUInt32LE(usize, 24);
  b.writeUInt16LE(nameBuf.length, 28);
  b.writeUInt32LE(MODE, 38);
  b.writeUInt32LE(offset, 42);    // position of the local header
  return b;                       // extra field, comment, disk, internal attributes: 0
}

// entries: [{ path, data }]
function writeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { path, data } of entries) {
    const nameBuf = Buffer.from(path, 'utf8');
    const crc = crc32(data);
    const packed = deflateRawSync(data, { level: constants.Z_BEST_COMPRESSION, memLevel: 9 });
    const stored = packed.length >= data.length; // incompressible: stored as is
    const payload = stored ? data : packed;
    const method = stored ? 0 : 8;
    parts.push(localHeader(nameBuf, method, crc, payload.length, data.length), nameBuf, payload);
    central.push(centralHeader(nameBuf, method, crc, payload.length, data.length, offset), nameBuf);
    offset += 30 + nameBuf.length + payload.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  if (entries.length > 0xffff || offset + centralSize > 0xffffffff) throw new Error('package too big for a zip without ZIP64');
  const endRecord = Buffer.alloc(22); // end record: a single "disk", no comment
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, endRecord]);
}

// --- Reading back: reads the central directory of the written zip, inflates everything and compares with the disk ---

function readZip(zip) {
  // ponytail: assumes no end-of-archive comment (it only reads the zip it just wrote), so the end record sits in the
  // last 22 bytes; scan backwards for its signature to read any zip.
  const end = zip.length - 22;
  if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50) throw new Error('end record of the zip not found');
  const n = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < n; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupted central directory in the zip');
    const method = zip.readUInt16LE(p + 10), crc = zip.readUInt32LE(p + 16);
    const csize = zip.readUInt32LE(p + 20), usize = zip.readUInt32LE(p + 24);
    const nlen = zip.readUInt16LE(p + 28), xlen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const path = zip.toString('utf8', p + 46, p + 46 + nlen);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`corrupted content in the zip: ${path}`);
    entries.push({ path, data });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

// --- Program ---

function main() {
  // JSON.parse throws if the manifest is invalid; a possible BOM is removed
  const raw = readFileSync(join(root, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  const { version } = manifest;

  // The version number is used in the file name: Chrome format (1 to 4 integers separated by dots)
  if (typeof version !== 'string' || !/^\d{1,5}(\.\d{1,5}){0,3}$/.test(version)) throw new Error(`invalid version in the manifest: ${version}`);

  // Texts: every __MSG_key__ must exist in every language, and the RESOLVED name and description (what the store and
  // chrome://extensions show) are the ones checked, in each language.
  const locales = readLocales(root);
  const keys = [...new Set([...raw.matchAll(MSG_REF)].map((m) => m[1]))];
  if (keys.length || Object.keys(locales).length) {
    if (!Object.hasOwn(locales, manifest.default_locale)) throw new Error(`default_locale "${manifest.default_locale}" has no _locales/<lang>/messages.json`);
    for (const [lang, messages] of Object.entries(locales)) {
      const absent = keys.filter((k) => typeof messages[k]?.message !== 'string');
      if (absent.length) throw new Error(`_locales/${lang}/messages.json lacks: ${absent.join(', ')}`);
    }
  }
  for (const [lang, messages] of Object.keys(locales).length ? Object.entries(locales) : [['', {}]]) {
    const { name, description } = localize(manifest, messages);
    const where = lang ? ` (${lang})` : '';
    // Manifest limits (Chrome docs): name 75 characters, short_name 12, description 132
    if (typeof name !== 'string' || !name) throw new Error(`name missing from the manifest${where}`);
    if (name.length > 75) throw new Error(`name exceeds 75 characters${where}`);
    if (manifest.short_name && manifest.short_name.length > 12) throw new Error('short_name exceeds 12 characters');
    if (typeof description !== 'string' || !description) throw new Error(`description missing from the manifest${where}`);
    if (description.length > 132) throw new Error(`description exceeds 132 characters${where}`);
  }

  const paths = listRuntimeFiles(root).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); // code point order: identical everywhere
  const files = paths.map((rel) => ({ path: rel, data: readFileSync(join(root, rel)) }));

  // The licenses travel with the code: ours at the root, the third-party component's next to it
  const missingLicenses = ['LICENSE', 'vendor/fabric.LICENSE'].filter((l) => !paths.includes(l));
  if (missingLicenses.length) throw new Error(`License missing from the package: ${missingLicenses.join(', ')}`);
  if (paths.includes('THIRD_PARTY_NOTICES.md')) throw new Error('THIRD_PARTY_NOTICES.md must not be in the package (duplicate of vendor/fabric.LICENSE)');

  // The files cited by the manifest must be in the package
  const iconPaths = (v) => (typeof v === 'string' ? [v] : Object.values(v ?? {}));
  const refs = [manifest.background?.service_worker, ...iconPaths(manifest.icons), ...iconPaths(manifest.action?.default_icon)].filter(Boolean);
  const missing = refs.filter((r) => !paths.includes(r));
  if (missing.length) throw new Error(`Files cited by the manifest are missing from the package: ${missing.join(', ')}`);

  // Lightness: any file > 500 KB outside vendor/ is suspect (a warning, not an error)
  for (const { path, data } of files) {
    if (data.length > 500 * 1024 && !path.startsWith('vendor/')) {
      console.warn(`Warning: heavy file outside vendor/: ${path} (${Math.round(data.length / 1024)} KB)`);
    }
  }

  const dist = join(root, 'dist');
  const zipPath = join(dist, `obturo-${version}.zip`);
  mkdirSync(dist, { recursive: true });
  rmSync(zipPath, { force: true });
  const zip = writeZip(files);
  writeFileSync(zipPath, zip);

  // Reading the archive back
  const readBack = readZip(readFileSync(zipPath));
  const names = readBack.map((e) => e.path);
  if (names.some((n) => n.includes('\\'))) throw new Error('Separator "\\" in the zip'); // the Web Store rejects them
  if (!names.includes('manifest.json')) throw new Error('manifest.json missing from the root of the zip');
  if (names.join('\n') !== paths.join('\n')) throw new Error('The zip does not contain exactly the expected files');
  if (readBack.some((e, i) => !e.data.equals(files[i].data))) throw new Error('The content of the zip differs from the source files');

  for (const { path, data } of files) console.log(`${(data.length / 1024).toFixed(1).padStart(9)} KB  ${path}`);
  const total = files.reduce((n, f) => n + f.data.length, 0);
  console.log(`${files.length} files, ${(total / 1024).toFixed(1)} KB raw, zip ${(zip.length / 1024).toFixed(1)} KB (${zip.length} bytes)`);
  console.log(`SHA-256: ${createHash('sha256').update(zip).digest('hex')}`);
  console.log(`Zip:     ${zipPath}`);
}

// Run directly (npm run package): builds the zip. Imported by the E2E tests: does nothing.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}
