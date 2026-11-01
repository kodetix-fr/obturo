import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NAME_TEMPLATE, FORMATS, QUALITY_DEFAULT, QUALITY_MIN, clampQuality, encodeImage, suggestedFilename } from './encode.js';

// The encoding itself needs a canvas: the E2E tests cover it. Here: the formats, the quality, the file name, and the
// way encodeImage handles what a browser can answer (a canvas that produces a blob, null, or another type).

test('FORMATS: three formats, only PNG is lossless', () => {
  assert.deepEqual(Object.keys(FORMATS), ['png', 'jpeg', 'webp']);
  assert.deepEqual(FORMATS.png, { mime: 'image/png', ext: 'png', lossy: false });
  assert.deepEqual(FORMATS.jpeg, { mime: 'image/jpeg', ext: 'jpg', lossy: true });
  assert.deepEqual(FORMATS.webp, { mime: 'image/webp', ext: 'webp', lossy: true });
});

test('clampQuality: kept within [0.1, 1], the default for what is not a number', () => {
  assert.equal(clampQuality(0.5), 0.5);
  assert.equal(clampQuality(1), 1);
  assert.equal(clampQuality(7), 1);
  assert.equal(clampQuality(0), QUALITY_MIN);
  assert.equal(clampQuality(-3), QUALITY_MIN);
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, '0.5', {}]) assert.equal(clampQuality(bad), QUALITY_DEFAULT);
});

// --- suggestedFilename ---

const at = (y, mo, d, h, mi, s) => new Date(y, mo - 1, d, h, mi, s).getTime(); // local time, like the name

test('suggestedFilename: host, date and time of the capture, extension', () => {
  const createdAt = at(2026, 10, 2, 14, 5, 9);
  assert.equal(suggestedFilename({ url: 'https://example.com/a/b?c=d#e', title: 'T', createdAt }, 'png'), 'example.com_2026-10-02_14-05-09.png');
  assert.equal(suggestedFilename({ url: 'https://docs.example.co.uk:8443/x', createdAt }, '.webp'), 'docs.example.co.uk_2026-10-02_14-05-09.webp');
  assert.equal(suggestedFilename({ url: 'http://192.168.0.12:3000/', createdAt }, 'jpg'), '192.168.0.12_2026-10-02_14-05-09.jpg');
});

test('suggestedFilename: the title and the path never get into the name', () => {
  const name = suggestedFilename({ url: 'https://example.com/secret/path', title: 'Payslip of Jane Doe', createdAt: at(2026, 1, 2, 3, 4, 5) }, 'png');
  assert.equal(name, 'example.com_2026-01-02_03-04-05.png');
});

test('suggestedFilename: capture when there is no host', () => {
  const createdAt = at(2026, 12, 31, 23, 59, 58);
  for (const url of [undefined, '', 'not a url', 'file:///C:/docs/report.pdf', 'about:blank', 'data:text/plain,hi']) {
    assert.equal(suggestedFilename({ url, createdAt }, 'png'), 'capture_2026-12-31_23-59-58.png', String(url));
  }
  assert.match(suggestedFilename({}, 'png'), /^capture_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.png$/, 'no date: now');
  assert.match(suggestedFilename(undefined, 'png'), /^capture_/);
});

test('suggestedFilename: safe on Windows, whatever the address looks like', () => {
  const createdAt = at(2026, 3, 4, 5, 6, 7);
  const forbidden = (name) => [...name].some((ch) => ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch)); // Windows
  const urls = [
    'http://[::1]:8080/', 'http://[2001:db8::7]/x', 'https://xn--bcher-kva.example/', 'https://m\u00fcnchen.example/',
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop/library.html', `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.com/`,
    'https://a..b/', 'https://example.com./', 'https://con/', 'https://nul/',
  ];
  for (const url of urls) {
    const name = suggestedFilename({ url, createdAt }, 'png');
    assert.ok(!forbidden(name), name);
    assert.ok(name.length <= 60 + '_2026-03-04_05-06-07.png'.length, `bounded: ${name.length}`);
    assert.doesNotMatch(name, /^[-.]|[ .]$/, name);
    assert.match(name, /_2026-03-04_05-06-07\.png$/);
    // Windows reserves CON, NUL... as a whole base name; the date suffix makes ours safe, which this checks
    assert.doesNotMatch(name.split('.')[0], /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i);
  }
  assert.equal(suggestedFilename({ url: 'http://[::1]:8080/', createdAt }, 'png'), '1_2026-03-04_05-06-07.png');
});

test('suggestedFilename: a Windows device name at the start of the host gets an underscore, whatever follows the first dot', () => {
  const createdAt = at(2026, 3, 4, 5, 6, 7);
  const name = (host) => suggestedFilename({ url: `https://${host}/`, createdAt }, 'png');
  // "nul.example.com_2026-03-04_05-06-07.png" is the device NUL for Windows, extension or not
  assert.equal(name('nul.example.com'), '_nul.example.com_2026-03-04_05-06-07.png');
  assert.equal(name('aux.com'), '_aux.com_2026-03-04_05-06-07.png');
  assert.equal(name('com1.corp.local'), '_com1.corp.local_2026-03-04_05-06-07.png');
  assert.equal(name('LPT9.Example.test'), '_lpt9.example.test_2026-03-04_05-06-07.png', 'any case (a host is lower case anyway)');
  assert.equal(name('prn.test'), '_prn.test_2026-03-04_05-06-07.png');
  // not device names: a longer first label, COM10 and the like, a bare device name that the date follows (`con_2026...` is a fine name)
  for (const host of ['con', 'console.example.com', 'community.org', 'com10.test', 'comx.test', 'nullable.io', 'auxiliary.com', 'lpt.test', 'www.nul.com', 'a-con.test']) {
    assert.doesNotMatch(name(host), /^_/, host);
    assert.equal(name(host), `${host}_2026-03-04_05-06-07.png`);
  }
  // the host keeps its 60 characters, the underscore comes on top
  const long = name(`nul.${'a'.repeat(30)}.${'b'.repeat(30)}.com`);
  assert.ok(long.length <= 1 + 60 + '_2026-03-04_05-06-07.png'.length, `bounded: ${long.length}`);
  assert.match(long, /^_nul\./);
  // the first label alone reaches the Windows rule, so the whole name must start with the underscore for every spelling
  for (const host of ['nul.example.com', 'aux.com', 'com1.corp.local', 'con', 'lpt3.x']) {
    assert.doesNotMatch(name(host).split('.')[0], /^(con|prn|aux|nul|com\d|lpt\d)$/i, host);
  }
});

test('suggestedFilename: the extension is cleaned, png by default', () => {
  const createdAt = at(2026, 3, 4, 5, 6, 7);
  assert.equal(suggestedFilename({ url: 'https://a.test/', createdAt }), 'a.test_2026-03-04_05-06-07.png');
  assert.equal(suggestedFilename({ url: 'https://a.test/', createdAt }, '../JPG'), 'a.test_2026-03-04_05-06-07.jpg');
  assert.equal(suggestedFilename({ url: 'https://a.test/', createdAt }, ''), 'a.test_2026-03-04_05-06-07.png');
});

// --- suggestedFilename: the template ---

test('suggestedFilename: a template picks the words and their order; the default one is what no template gives', () => {
  const shot = { url: 'https://example.com/a?b=c', title: 'Payslip of Jane Doe', createdAt: at(2026, 10, 2, 14, 5, 9) };
  assert.equal(suggestedFilename(shot, 'png', DEFAULT_NAME_TEMPLATE), suggestedFilename(shot, 'png'));
  assert.equal(suggestedFilename(shot, 'png', '{date} {host}'), '2026-10-02 example.com.png');
  assert.equal(suggestedFilename(shot, 'png', 'Screenshot {date} at {time}'), 'Screenshot 2026-10-02 at 14-05-09.png');
  assert.equal(suggestedFilename(shot, 'jpg', '{host}-{host}'), 'example.com-example.com.jpg', 'a word twice');
  assert.equal(suggestedFilename(shot, 'png', 'plain'), 'plain.png', 'no word at all');
  assert.equal(suggestedFilename(shot, 'png', '{nope}_{date}'), '{nope}_2026-10-02.png', 'an unknown word stays as typed');
  assert.equal(suggestedFilename(shot, 'png', '{HOST}'), '{HOST}.png', 'the words are lower case');
});

test('suggestedFilename: the title goes in only when the template says {title}', () => {
  const shot = { url: 'https://example.com/', title: 'Payslip of Jane Doe', createdAt: at(2026, 10, 2, 14, 5, 9) };
  assert.doesNotMatch(suggestedFilename(shot, 'png'), /Jane/);
  assert.equal(suggestedFilename(shot, 'png', '{title}'), 'Payslip of Jane Doe.png');
  assert.equal(suggestedFilename(shot, 'png', '{host} - {title}'), 'example.com - Payslip of Jane Doe.png');
  assert.equal(suggestedFilename({ ...shot, title: '  Many   spaces\tand\nlines ' }, 'png', '{title}'), 'Many spaces and lines.png');
  assert.equal(suggestedFilename({ ...shot, title: 'a/b:c*"d?<e>|f' }, 'png', '{title}'), 'a-b-c-d-e-f.png', 'what Windows forbids becomes -');
  assert.equal(suggestedFilename({ ...shot, title: '{host}{date}' }, 'png', '{title}'), '{host}{date}.png', 'a title that says {host} is not expanded again');
  assert.equal(suggestedFilename({ ...shot, title: 'x'.repeat(200) }, 'png', '{title}'), `${'x'.repeat(60)}.png`, '60 characters of title');
  assert.doesNotThrow(() => encodeURIComponent(suggestedFilename({ ...shot, title: '\u{1F600}'.repeat(100) }, 'png', '{title}')), 'no pair of surrogates cut in two (encodeURIComponent throws on a lone one)');
});

test('suggestedFilename: a template that leaves nothing, or a title that is not there, gives capture or no dangling separator', () => {
  const createdAt = at(2026, 3, 4, 5, 6, 7);
  for (const template of ['{title}', '{title}.', ' _-. ', '...', '{title}{title}']) assert.equal(suggestedFilename({ url: 'https://a.test/', createdAt }, 'png', template), 'capture.png', template);
  assert.equal(suggestedFilename({ url: 'https://a.test/', createdAt }, 'png', '{title}_{date}'), '2026-03-04.png');
  assert.equal(suggestedFilename({ url: 'https://a.test/', createdAt }, 'png', '{date}_{title}'), '2026-03-04.png');
  assert.equal(suggestedFilename({ url: 'https://a.test/', createdAt }, 'png', '.hidden {date}.'), 'hidden 2026-03-04.png', 'no leading or trailing dot');
  assert.equal(suggestedFilename({ createdAt }, 'png', '{host}'), 'capture.png', 'no address: capture, as before');
});

test('suggestedFilename: safe on Windows whatever the template and the title', () => {
  const createdAt = at(2026, 3, 4, 5, 6, 7);
  const forbidden = (name) => [...name].some((ch) => ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch));
  const templates = ['{title}', 'a/b\\c', 'CON', 'nul', 'Aux.{title}', 'lpt1.txt', '{host}:{time}', '"{title}"', 'x\u0000y\u001f', `${'long'.repeat(60)}`, '  {title}  ', '{title}...'];
  const titles = ['', 'con', 'NUL.txt', 'a:b', '???', '\\\\server\\share', 'tab\there', 'end.', 'end ', '\u{1F600}'.repeat(80)];
  for (const template of templates) {
    for (const title of titles) {
      const name = suggestedFilename({ url: 'https://example.test/', title, createdAt }, 'png', template);
      assert.ok(!forbidden(name), `${JSON.stringify(name)} from ${JSON.stringify(template)} and ${JSON.stringify(title)}`);
      assert.doesNotMatch(name, /^[\s.]|[\s.]\.png$/, name);
      assert.ok(name.endsWith('.png') && name.length > '.png'.length, name);
      assert.ok([...name].length <= 120 + '.png'.length, `bounded: ${name.length}`);
      assert.doesNotMatch(name.split('.')[0], /^(con|prn|aux|nul|com\d|lpt\d)$/i, `a device name: ${name}`); // the part before the first dot decides on Windows
    }
  }
  assert.equal(suggestedFilename({ title: 'CON', createdAt }, 'png', '{title}'), '_CON.png');
  assert.equal(suggestedFilename({ title: 'aux.test', createdAt }, 'png', '{title}'), '_aux.test.png');
  assert.equal(suggestedFilename({ createdAt }, 'png', 'nul'), '_nul.png');
  assert.equal(suggestedFilename({ title: 'console', createdAt }, 'png', '{title}'), 'console.png', 'only the whole device names');
});

test('suggestedFilename: a Date, an invalid date and midnight', () => {
  assert.equal(suggestedFilename({ url: 'https://a.test/', createdAt: new Date(2026, 0, 5, 0, 0, 0) }, 'png'), 'a.test_2026-01-05_00-00-00.png');
  assert.match(suggestedFilename({ url: 'https://a.test/', createdAt: NaN }, 'png'), /^a\.test_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.png$/);
});

// --- encodeImage: what it does with the answer of the browser ---

// A canvas-like source that records how it is asked to encode, and answers with `answer`.
/** @returns {any} */
function fakeCanvas(answer, { method = 'toBlob', width = 4, height = 3 } = {}) {
  const calls = [];
  const source = { width, height, calls };
  source[method] = method === 'toBlob'
    ? (done, type, quality) => { calls.push({ type, quality }); done(answer(type)); }
    : (options) => { calls.push({ type: options.type, quality: options.quality }); return answer(options.type) ? Promise.resolve(answer(options.type)) : Promise.reject(new Error('too big')); };
  return source;
}
const blobOf = (type) => new Blob(['x'], { type });

test('encodeImage: a canvas is encoded as it is, with the type and the clamped quality', async () => {
  for (const method of ['toBlob', 'convertToBlob']) {
    const source = fakeCanvas(blobOf, { method });
    const png = await encodeImage(source);
    assert.equal(png.type, 'image/png');
    await encodeImage(source, { format: 'webp', quality: 7 });
    await encodeImage(source, { format: 'webp', quality: 0 });
    await encodeImage(source, { format: 'webp', quality: 0.42 });
    assert.deepEqual(source.calls, [
      { type: 'image/png', quality: QUALITY_DEFAULT },
      { type: 'image/webp', quality: 1 },
      { type: 'image/webp', quality: QUALITY_MIN },
      { type: 'image/webp', quality: 0.42 },
    ], method);
  }
});

test('encodeImage: unknown format, empty image, no answer, another type than asked', async () => {
  await assert.rejects(encodeImage(fakeCanvas(blobOf), { format: /** @type {any} */ ('avif') }), /unknown image format: avif/);
  await assert.rejects(encodeImage(fakeCanvas(blobOf), { format: /** @type {any} */ ('toString') }), /unknown image format/);
  await assert.rejects(encodeImage(fakeCanvas(blobOf, { width: 0, height: 5 })), /empty image/);
  await assert.rejects(encodeImage(fakeCanvas(() => null)), /could not encode 4x3 px as image\/png/);
  await assert.rejects(encodeImage(fakeCanvas(() => null, { method: 'convertToBlob' })), /too big/);
  // Chrome answers with a PNG when it cannot write the asked type: that is an error here, not a silent PNG
  await assert.rejects(encodeImage(fakeCanvas(() => blobOf('image/png')), { format: 'webp' }), /cannot encode image\/webp/);
});
