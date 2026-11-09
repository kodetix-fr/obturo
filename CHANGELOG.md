# Changelog

Notable changes to Obturo. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A stamp**: the *Stamp* button adds the address of the page and the date of the capture as a text at the bottom left
  of the image (or of the crop). It is a text like any other, to move, edit or delete.
- **A pen** to draw freehand, with the color and the stroke of the style bar.
- **Emoji**: twenty of them, placed with one click and picked in the style bar.
- **A line and a double arrow**: the arrow tool takes its *Ends* in the style bar (a head at the end, none, or both).
- **Rotate**: the *Rotate* button turns the whole capture a quarter turn clockwise, with its crop and what is drawn on it.
  Each version has its own turn, and the original is never changed.
- **About** in the settings, last section: the version, what is new in this release and links that open in a new
  tab when clicked: the reviews of Obturo on the Chrome Web Store, its issues on GitHub (*A problem? Tell us*) and
  Oblitero, another free extension of the same publisher. Obturo sends nothing and loads nothing before a click.
- **A dot for the news**: after an update to a new minor release (not a patch, not a first install) the settings
  button of the library and the *Settings* row of the popup carry a small dot, until the About section has been on
  screen; the dialog then opens on it. Nothing opens by itself and the icon of the toolbar gets no badge.
- **One request for a review** in the popup (never over a page): after 15 captures kept in the history, one row that
  takes the place of the two links under the menu, so the popup keeps its height, with the same words for everyone
  and nothing offered. A click on the row opens the reviews and ends the request, the cross ends it, and closing the
  popup without answering counts as *later*: it comes back once after 15 more captures. The count is a local
  number: the no-trace mode adds none, and nothing is sent.

### Changed

- **The strip of captures folds** under a head that keeps the count (*History · 12*): folded by default in a window
  shorter than 900 px, open above, and the choice is kept in the browser. The picture gets the room (at 813 px of height
  the stage goes from about 64 to 79 percent of the window).
- **What you draw is what is saved**: the points of a new shape are kept at two decimals of a pixel, the precision of a saved
  version, so that a shape does not change by a hair when the version is loaded again.
- **The style bar floats over the top of the picture** instead of pushing it down: the picture no longer moves when you
  change tool, in narrow windows where the bar changes its height. The view is worked out under the bar as it is at that
  moment (Fit, zoom, move), and left alone when the bar changes.
- **The output bar holds the output**: *Scale* and *Width* moved into the *Download* menu, the output size under the editor is
  the button that opens it, *Fit* and *100%* show which one applies (the percentage is not said twice at 100%), *Remove crop*
  shows only when there is a crop, and *Beautify*, *Stamp* and *Rotate* come first, at the left.
- **The stamp never carries the query** of the address (a token, an e-mail), whether *Hide sensitive text* is on or off.
- **Rotate is off on the Original** once the capture has versions, with a tip that says to pick a version: turning the
  Original made a bare version, with what was covered in the others showing. A capture with no version can still be turned.
- **A4 PDF**: an image a little taller than a page, such as a screen turned a quarter, stays on one page instead of being
  cut in two; a long page is cut as before.
- **The keyboard follows the app bar**: Import, History and Settings come after Download, then the tools.
- **The version buttons scroll in one row** instead of making the app bar wrap, which at 820 px wide pushed Blur under Crop
  after the first edit.
- The dot of the news is drawn in the ring color, and the tip of the settings button says *Settings, New* while it shows.
- The privacy policy lists the links of the settings and the popup, and the two numbers kept in the settings
  database (the last version whose news were read, the count of captures kept).

## [0.2.1] - 2026-11-06

### Added

- **A read-only library tab shows the capture** you pick in the strip or the history, drawn as the editor would
  export it, and keeps *Copy image* and *Download*. Editing, versions, pins, deletions and imports stay off.
- **A short note on the page after a capture** says it was copied (and saved in the history, or not saved in the
  no-trace mode), or that the copy failed. It shares one box with the note about the cover or the page, goes away
  by itself after a few seconds and is taken off before the next capture.
- **Rename a version**: a double click, or F2, on its pill. The name shows in the delete dialog, and a name you
  chose ends the name of the downloaded file.
- **Purge now** in the footer of the history sheet, next to the storage figures.
- **A violet *No trace* button** in the library header (a click turns the mode off) and a line in the empty
  library; the checkbox of the settings is violet too.
- The page that asks what to do after a capture repeats how many sensitive items were covered, since the note of the
  capture is on the page behind it.

### Changed

- **Deleting from the strip asks first**, with the dialog of the history: it names the capture and says what it
  includes (pinned, edited). The history dialog names a single capture too.
- **Importing or pasting an image is refused while No trace is on**, since an import is kept in the history.
- **The Download menu and the dialog of the grouped export keep their own choices** until the page is reloaded and no
  longer write the defaults of the settings (format, quality, PDF pages and images).
- **A drawing tool stays armed** after a drag, until Esc or a click on *Select*, as the marker already did.
- **Deleting a numbered step brings the following ones down** (delete the 2 of 1, 2, 3, 4 and you read 1, 2, 3);
  numbers you typed yourself are left alone. A text side of a marker that would leave the image is not given while
  the other side fits.
- **Sizes are counted the way the system does** (1 MB is 1,000,000 bytes). The size caps of the menu follow, and a
  cap stored by the old menu keeps its meaning (500 MiB reads 500 MB).
- The settings open at the first section, with a fade at the bottom while there is more to scroll.
- A history card writes the date before the site, so a narrow card cuts the site and not the date.
- The tooltips name the shortcuts as a Mac does (Cmd instead of Ctrl, Cmd+Shift+Z to redo).
- **Hide sensitive text** says what it does not cover (the content of form fields, images, frames), in the hint and in
  the note, and the note counts only what a reader can see (not a row that is hidden or transparent).

### Fixed

- **Edit and annotate** (the page that follows a capture) now leaves the editor in front. The page closed itself by
  bringing the captured page back, which could hide the editor it had just opened.
- A capture opened in a library tab that is already open now goes there by the address of the tab, so it is no
  longer lost when that tab is still loading. When several library tabs are open, the one that may edit takes the
  capture and comes forward, instead of the first one found, which could be the read-only one.
- **Hide sensitive text** now covers text that is selected on the page (the selection was painted over the black
  cover and showed the value, while the note counted it as hidden), text drawn in an SVG, card numbers, IBANs and
  phone numbers written with no-break spaces, and a value split by the markup of the page (a phone number in two
  elements, a card number in four).
- The tool rail fits a short window, and *Crop* is never hidden below the tools that scroll.
- The Download menu opens inside the window at 480 px, instead of 168 px off its left edge.
- In a window 480 px wide the editor gives the image 58 percent of the height instead of 40.
- The figures of the history block of the settings are written in the language you just chose.

## [0.2.0] - 2026-11-03

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

[Unreleased]: https://github.com/kodetix-fr/obturo/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/kodetix-fr/obturo/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kodetix-fr/obturo/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kodetix-fr/obturo/releases/tag/v0.1.0
