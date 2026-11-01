# vendor/

Third-party code copied as is, with no build step (the folder is the extension). No remote code is ever loaded.

## fabric.min.mjs

| | |
|---|---|
| Project | [Fabric.js](https://github.com/fabricjs/fabric.js) |
| Version | **6.9.1** (pinned: do not update without rerunning the editor tests) |
| Licence | MIT, full text in `fabric.LICENSE` (see "Licence" below) |
| Source | `npm pack fabric@6.9.1`, file `package/dist/index.min.mjs` (self-contained ESM: no `import`, `eval` or `new Function`) |
| npm package integrity | `sha512-TqG08Xbt4rtlPsXgCjSUcZz/RsyEP57Qo21nCVRkw7zz9nR0co4SLkL9Q/zQh3tC1Yxap6M5jKFHUKV6SgPovg==` |
| sha256 of the `fabric-6.9.1.tgz` package | `6ebc2d1971301578e98ed5de0970258cdd11a90698adaf71a16b22a786dc5db9` |
| sha256 of `fabric.min.mjs` | `18721283b1d46272943482c1aac6eca99e700d7acecdb46590b9e087cc3f193d` |

The file is not modified (its last line points to a source map that is not copied: DevTools ignores it).

### Verify

```
npm pack fabric@6.9.1 && tar -xzf fabric-6.9.1.tgz
sha256sum package/dist/index.min.mjs vendor/fabric.min.mjs   # both hashes must be identical
```

## fabric.LICENSE

| | |
|---|---|
| Content | Full MIT text from the upstream repository: both copyright lines (2008-2015 Printio, 2016-present Fabric.js contributors) and the sentence requiring the copyright and permission notice to be kept |
| Source | `https://raw.githubusercontent.com/fabricjs/fabric.js/master/LICENSE`, fetched on 2026-10-01 (upstream text changed on 2025-09-09 and 2025-09-15, pull requests #10725 and #10726) |
| sha256 of `fabric.LICENSE` | `eda412692b7398293a049ecf913319da26eb8f7fe27f10709821dd187b517e0b` |

The `LICENSE` shipped with Fabric.js 6.9.1 is an abridged version of this same text: it has neither the 2016-present copyright line nor the sentence "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.". That is the file in the `fabric@6.9.1` npm package and in the upstream tag for this version (named `v691` by Fabric.js), sha256 `d8f93c5639b2d11680911dff6e91567af4c44dd79a87f8ff2e85d1c8b91f9702`. Obturo ships the full text, which meets the MIT condition without ambiguity.

### MV3 CSP compatibility

Checked in Chromium under the default CSP of extension pages (`script-src 'self'`): loading, in-place `IText` editing, the `Pixelate` filter, `toObject` / `enlivenObjects`, `toCanvasElement` export; 0 CSP violations.
