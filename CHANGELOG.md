# Changelog

Notable changes to Obturo. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Support link** (*Settings*, last section): a *Support Kodetix* link that opens a page of kodetix.fr in a new
  tab. It is a plain link: Obturo itself sends nothing and loads nothing before the click, and it stays free.
  No new permission.
- **Beautify** (the button in the bar under the editor): a background (none, a color of the palette or a
  free one, or one of six gradients), a padding, rounded corners, a shadow and an optional window bar around
  the capture. The editor shows the capture inside its look while it is on, and editing keeps working on the
  capture itself (zoom, pan, crop and annotations included); the panel is a column next to the editing area,
  which follows its controls as they move. It is a property of a version, so the original stays untouched and
  it can be turned off; a new version starts without it, and the last look is offered when it is turned on
  for another version. The stage, the copy and the download of the editor, the grouped export (ZIP and PDF)
  and the thumbnails draw it from the same geometry, so they agree to the pixel; the scale ceilings count the
  padding and the bar, and the background *None* is transparent in PNG and WebP and white in JPEG and PDF.
  No new permission.
- **Hide sensitive text** (*Settings*, *Capture*, off by default). Before each image of a capture, Obturo covers in
  solid black the e-mail addresses, phone numbers, IBANs, card numbers and keys found in the text of the page, then
  puts the page back: a CSS highlight, so no node is added, no text changes and the cover follows a scrolling panel.
  Open shadow roots are searched. A full page looks again at each tile. A note on the page says how many items were
  hidden, or that none was found, or that the page was too big to be searched in full. When the cover cannot be put
  up, no image is taken. Best effort: images, canvases, frames, closed shadow DOM and the value of a field are not
  seen. No new permission.
- **Element capture**: a fourth kind next to *Area*, *Visible part* and *Full page*, in the popup, in both
  submenus of the icon menu and as two commands without a default key (*Capture an element*, *Capture an
  element and edit*). A box follows the pointer over the innermost element, a click captures its part inside
  the window and the page never gets that click, Alt+ArrowUp and Alt+ArrowDown choose the parent and the child,
  Esc cancels. The page stays live while you pick, so a hover state is in the capture. No new permission.
- **A delay before a capture** (*Settings*, *Capture*, *Delay before capture*: none, 3, 5 or 10 s, and a row of
  the popup that goes through the choices). The icon counts the seconds down and the page stays usable, so a
  menu, a tooltip or a hover state can be opened before the capture. Any capture gesture during the wait cancels
  it, and so does leaving the tab. For an area, the selection starts when the delay ends. No new permission.
- **Save the file after a capture** (*Settings*, *Capture*, *After a capture*, third choice next to
  *Ask what to do* and *Copy it*). The capture is kept in the history, then downloaded as a file with the
  format, the quality and the file name template of the *Download* section. It is written by a tab that opens
  in the background and closes itself, so the captured page keeps the focus; the tab comes forward only when
  the download fails. The no-trace mode keeps copying only, and *Capture and edit* still opens the editor. No
  new permission.

### Changed

- **Name and summary in the store**, in the nine languages: the name is now *Obturo* followed by a short
  descriptor (for example *Obturo: Screenshot & Annotate*) and the summary lists what it captures, with the
  promise of a local, free and open source tool. The tooltip of the icon stays *Obturo*.

## [0.1.0] - 2026-11-02

First release.

### Added

- Capture of an area drawn with the mouse, of the visible part, or of the full
  page of a tab. A full page is scrolled and stitched (at most 100 tiles and 32
  million pixels), fixed and sticky elements show once, and a note on the page
  says so when the image is not the whole page or the capture stopped. Each
  capture also exists as *Capture and edit*, which opens the editor.
- After a capture, a page opens next to the captured tab with a preview and the
  actions: edit and annotate, copy to the clipboard, download as PNG, JPEG, WebP
  or PDF. Nothing is put on the clipboard unasked. A setting copies every capture
  straight away instead, and a badge on the icon says how it went.
- Gestures: a click on the icon (area), four default shortcuts (`Alt+Shift+Z`,
  `V`, `F` and `L`), three more commands without a default key (the *and edit*
  ones), and the icon's right-click menu.
- No-trace mode: a switch in the popup and in the settings. A capture is copied
  and saved nowhere, and the icon turns violet.
- Import of any image (a file, a paste with Ctrl+V, a drop) to edit it and keep
  it in the history.
- A history in IndexedDB with a retention (7 days, 30 days by default, 90 days,
  1 year or forever) and a size limit (500 MB, 1 GB, 2 GB by default, 5 GB, 10 GB
  or none). Pinned captures are never removed automatically, edited captures
  escape the age limit, and unreadable settings remove nothing. The cleanup runs
  by lots, a gauge shows what the history takes, *Purge now* shows what it would
  remove, and *Delete everything* asks for a typed confirmation.
- The history sheet: every capture as a grid, search in titles and addresses,
  filters by site and period, pinned only, selection by mouse or keyboard, and
  bulk pin, unpin, export and delete.
- The library: a strip of the 12 latest captures, and one editing tab at a time
  (a second tab is read-only).
- A non-destructive editor (Fabric.js 6.9.1, vendored): arrow, outline, numbered
  markers with an optional text, styled text, highlighter, spotlight, solid fill,
  pixelation, blur and crop, with rectangle, rounded rectangle, ellipse or free
  hand shapes, one color control, output scale, undo and redo, zoom and pan.
- Versions of a capture: an immutable original, and variants that hold only
  their annotations, their crop and their scale.
- Download as PNG, JPEG, WebP or PDF, with a quality setting, an estimate of the
  size, a file name template and, for a PDF, the page size and the picture
  quality. Grouped export of the selected captures as a ZIP of images or a
  multipage PDF.
- An interface in nine languages (English, French, German, Spanish, Brazilian
  Portuguese, Indonesian, Russian, Japanese and simplified Chinese) loaded when
  chosen, and a light, dark or system theme.
- Performance budgets, written down and measured by `npm run bench`.
- Tests: `node --test` unit tests, end-to-end tests in the real extension
  (`npm run test:e2e`), and a manual benchmark.
- Development tooling: ESLint, type checking, a cross-platform packaging script
  that checks the manifest texts in each language, continuous integration, a
  security workflow (Semgrep, `npm audit`, Gitleaks) and a release workflow: a
  `v*` tag publishes a GitHub release with the package zip and its SHA-256.
- Documentation: README, architecture notes, privacy policy, contributing guide,
  security policy, code of conduct, issue forms and a pull request template.

### Security

- Three permissions only (`activeTab`, `scripting`, `contextMenus`), no access to
  websites, no `unlimitedStorage`, no network request, no remote code.

[Unreleased]: https://github.com/kodetix-fr/obturo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kodetix-fr/obturo/releases/tag/v0.1.0
