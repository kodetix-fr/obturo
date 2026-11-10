import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listRuntimeFiles } from './scripts/package.mjs';

const read = (file) => readFileSync(new URL(file, import.meta.url));
const files = listRuntimeFiles(fileURLToPath(new URL('.', import.meta.url)));

test('the package holds runtime files only: no documentation, test, script or tool configuration', () => {
  assert.ok(files.includes('manifest.json') && files.includes('sw.js') && files.includes('vendor/fabric.min.mjs'), 'the list is the real one');
  const stray = files.filter((f) => /\.md$/i.test(f)
    || /(^|\/)(test|scripts|docs|types)\//.test(f)
    || /\.test\./.test(f)
    || /(^|\/)(package(-lock)?\.json|tsconfig[^/]*\.json|eslint\.config\.js)$/.test(f)
    || f.split('/').some((segment) => segment.startsWith('.')));
  assert.deepEqual(stray, []);
});

test('the licences travel with the code, under their own names', () => {
  assert.ok(files.includes('LICENSE'));
  assert.ok(files.includes('vendor/fabric.LICENSE'));
});

test('vendor: the files are the ones whose checksum vendor/README.md writes down', () => {
  const readme = read('./vendor/README.md').toString('utf8');
  for (const file of ['fabric.min.mjs', 'fabric.LICENSE']) {
    const [, written] = readme.match(new RegExp(`sha256 of \`${file.replace('.', '\\.')}\` \\| \`([0-9a-f]{64})\``)) ?? [];
    assert.ok(written, `${file}: its checksum is in vendor/README.md`);
    assert.equal(createHash('sha256').update(read(`./vendor/${file}`)).digest('hex'), written, file);
  }
});
