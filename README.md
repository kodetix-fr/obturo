<p align="center">
  <img src="docs/logo.svg" alt="" width="112">
</p>

<h1 align="center">Obturo</h1>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/obturo/kaafiicmlbdchfalaljmbeoblihjbnih"><img src="https://img.shields.io/badge/Chrome_Web_Store-install-4285F4?logo=googlechrome&logoColor=white" alt="Install Obturo from the Chrome Web Store"></a>
  <a href="https://github.com/kodetix-fr/obturo/actions/workflows/ci.yml"><img src="https://github.com/kodetix-fr/obturo/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/kodetix-fr/obturo/actions/workflows/security.yml"><img src="https://github.com/kodetix-fr/obturo/actions/workflows/security.yml/badge.svg" alt="Security"></a>
</p>

A small Chrome extension (Manifest V3) for capturing, annotating and keeping
screenshots: an area, the visible part or the full page of a tab, copied to the
clipboard and kept in a searchable history on your computer. 100% local,
no account, free and open source. The interface comes in nine languages.

It exists because capturing a page, hiding the part that must not be shared and
pasting the result into a ticket needs no account, no server and no permission
to read every site you open. Obturo does it with three permissions, and keeps
the original of every capture, so a redacted copy never costs you the real one.

## Features

### Capture

Four kinds of capture, each in two flavours. *Capture* copies the image to the
clipboard and saves it in the history. *Capture and edit* does the same, then
opens the new capture in the editor.

| What | Capture | Capture and edit |
|---|---|---|
| An area, dragged with the mouse | **Alt+Shift+Z**, or a click on the icon | no default key |
| The visible part of the tab | **Alt+Shift+V** | no default key |
| The full page | **Alt+Shift+F** | no default key |
| An element of the page, picked with the mouse | no default key | no default key |

- **Alt+Shift+L** opens the library. A library already open in a tab is brought
  to the front instead of opening a second one.
- Chrome lets an extension suggest four shortcuts, so the *Element* commands and
  the three *Capture and edit* commands have no default key. All nine commands
  are yours to set or change at `chrome://extensions/shortcuts`.
- **The icon's right-click menu** holds *Capture* and *Capture and edit* (each a
  submenu: *Area*, *Visible part*, *Full page*, *Element*), *Open the library* and
  *Settings*. That is four entries at the top level; Chrome shows six at most.
- **Area**: drag a rectangle. Esc cancels, and a selection under 5 px is
  ignored.
- **Element**: move the pointer and a box follows the innermost element under
  it; a click captures that element, the part of it that the window shows, and
  the page never gets the click. **Alt+ArrowUp** selects the parent, **Alt+ArrowDown**
  goes back down to the child, a move of the pointer takes the choice back, Esc
  cancels, and an element under 5 px is ignored. The page stays live while you
  pick: its hover styles and menus keep working, so a hover state is in the capture.
- **Full page**: Obturo scrolls the page (the document, or the panel of a web
  application that scrolls inside the page), captures each tile and stitches
  them together. Esc cancels. The scroll position and the fixed elements of the
  page are put back as they were.
  - After each scroll it waits for the images in view that still load and the
    animations in view that end. For a page that fades in or draws its content
    by script, the *Full page* settings add a wait (0.5, 1 or 2 s).
  - Fixed elements (bars, banners, chat bubbles) show once, at the top or at the
    bottom of the image; the settings can hide them all. Sticky headers show
    once, at the top.
  - When the image is not the whole page (cut at the limits, reduced to fit, a
    big frame held the page) or the capture stops (the window was resized...), a
    short note says so on the page.
- **No trace**: for a capture that must leave nothing behind. A switch in the
  popup (and in *Settings*, *History*) turns it on: a capture is then copied to
  the clipboard and saved nowhere, no row in the history, no thumbnail, no file.
  The icon turns violet (and the tooltip says so) so that the mode is not
  forgotten, the result badge is violet too, and the library shows a violet
  *No trace* button (a click turns the mode off). Importing or pasting an image
  is refused while it is on, since an import is kept in the history. *Capture and edit* is greyed
  out (there is nothing to edit; the shortcuts say so on the page). The captures
  you already have stay. If the copy fails, nothing is left of the capture: the
  badge turns red and a note says so.
- **After a capture**: by default Obturo asks what to do with it. The capture is
  kept in the history and a page opens in a new tab next to the captured one,
  with a preview and big buttons: **Edit and annotate**, **Copy to the
  clipboard**, and **Download as** PNG, JPEG, WebP or PDF (with your format
  settings and your file name template). A button that worked closes the tab and
  brings the captured page back (Esc or *Close* does too: the capture stays in
  the history). Nothing is
  put on the clipboard until you ask. *Settings*, *Capture*, *After a capture*
  can be set to *Copy it* instead: the quick way, no page, every capture is
  copied and kept. *Save the file* keeps the capture and downloads it at once,
  with your format settings and your file name template, from a tab that opens in
  the background and closes itself: the captured page keeps the focus, and the
  tab only comes forward if the download fails. *Capture and edit* and the
  no-trace mode never ask: the first opens the editor, the second only copies.
- **Delay**: *Settings*, *Capture*, *Delay before capture* (none, 3, 5 or 10 s), and
  a row of the popup that goes through the choices at each click. A capture then
  waits: the icon counts the seconds down and the page stays usable, so a menu, a
  tooltip or a hover state can be opened first. Running any capture again (the
  shortcut, the menu or the popup) cancels the wait, and so does leaving the tab.
  It applies to the visible part, the full page and *Capture and edit*; for an
  area, the selection starts when the delay ends.
- **Hide sensitive text**: *Settings*, *Capture*, *Hide sensitive text* (off by
  default). Before each image of a capture (area, element, visible part, full
  page, and their *and edit* variants), Obturo covers in solid black the e-mail
  addresses, phone numbers, IBANs, card numbers and keys it finds in the text of
  the page, takes the image, and puts the page back as it was: no node is added
  and no text changes, the cover is a CSS highlight that follows a panel that
  scrolls. A full page looks again at each tile, so what loads while the page
  scrolls is covered too. A note on the page then says how many items showing in
  the image were covered, or that none was found, and that form fields, images
  and frames are not covered. It is best effort, not a guarantee: look at
  the image before you share it. If the cover cannot be put up, no image is
  taken (red badge). What is looked for, and what is not, is under *Known
  limits*.
- **Clipboard**: with *Copy it*, every capture is copied and saved. A badge on the icon says how
  it went: `OK` (green) copied and saved, `!` (orange) saved but not copied,
  `ERR` (red) failed, `...` (grey) ignored because another capture is running,
  `n/m` (blue) progress of a full-page capture.

### Library and history

The library is the page you edit and browse in: the editor, and under it a strip
of the 12 latest captures (newest on the left) that starts with an **All
history** button. A **History** button at the top right, next to the settings
button (the sliders icon, which opens the settings), opens the same sheet. The
settings also open from *Settings* in the icon's right-click menu.

- **Import**: any image can be edited in Obturo, not only a capture. Pick files
  with the import button (next to *History*), paste an image with **Ctrl+V**
  (a screenshot from another tool, *Copy image* in a page), or drop files on
  the library. The last image added opens in the editor. PNG, JPEG, WebP, GIF
  (its first image), BMP and AVIF files work, up to 32 million pixels, 16,384
  px a side and 64 MB each; an image that does not fit is refused with the
  reason, the others are added. An imported image is kept as a PNG (a PNG file
  as it is, anything else without loss, so a JPEG becomes a bigger PNG), titled
  with its file name (*Pasted image* for a paste), and has no page address.
  A paste into a text field, or while a dialog is open, is left alone, and a
  tab that cannot edit (another one holds the lock) imports nothing.
- **History sheet**: every capture as a grid of thumbnails, tested with 5,000.
  Search in the titles and addresses (case and accents ignored), filter by site
  and by period (all time, today, 7 days, 30 days), show only pinned captures.
- **Selection**: with the mouse (**Shift** for a range, **Ctrl** or **Cmd** to
  add one) or the keyboard (arrows move, **Space** selects, **Enter** opens,
  **P** pins, **Delete** removes, **Ctrl+A** selects every result). A selection
  can be pinned, unpinned, exported or deleted; the confirmation says how many
  of them are pinned or edited and how much space it frees.
- **Pin**: a pinned capture is never removed automatically. Pin the open
  capture with the pin button of the editor, or any capture from the sheet.
- **Retention**, in *Settings*, *History*:
  - *Keep captures for*: 7 days, **30 days** (default), 90 days, 1 year or
    forever.
  - *Size limit*: 500 MB, 1 GB, **2 GB** (default), 5 GB, 10 GB or no limit.
  - A pinned capture, the capture open in the library and the capture just
    taken are never removed. An edited capture escapes the age limit: it goes
    only when the size limit needs room, after the unedited ones, oldest first.
  - If the settings cannot be read, nothing is removed.
  - The cleanup runs when a capture is added and when the library opens, by lots
    of 50 so that a capture or a save never waits for long.
  - A gauge shows what the history takes, and what the next cleanup would remove.
  - **Purge now…** removes by age, by size or both, and shows what it would
    remove (and what it spares: pinned and edited captures) before you confirm.
  - **Delete everything…** asks you to type a word first.

### Editor

Non-destructive: the original of a capture is never changed.

- Tools, in groups by what they are for: select; arrow, outline, **numbered
  markers** and styled text (font, size, bold, italic, underline, background) to
  annotate; **highlighter** and **spotlight** to put in evidence; **solid fill**,
  **pixelate** and **blur** to hide data; and crop on its own.
- **One color control everywhere**: the line of an outline or an arrow, a text and
  its background, a marker, the highlighter and the solid fill all use the same
  swatches (black, white, gray, blue, red, yellow, green, orange, pink) and a free
  color beside them. Choosing a color is enough: a text background has a *None*
  swatch and no box to tick. The last colors are kept for the next ones.
- **Shapes**: the outline, the solid fill, the highlighter, the spotlight, the
  pixelation and the blur take a **shape**, chosen in the style bar: rectangle,
  rounded rectangle, ellipse, or **freehand** (draw the outline with the mouse:
  an area for the fill, the spotlight, the pixelation and the blur, a pen stroke
  for the highlighter). Each tool remembers its own shape, and a selected area can
  be given another one (a free area can become a rectangle, not the other way
  round). The shape is saved with the object and drawn the same by the editor,
  the exports and the thumbnails.
- **Highlighter**: draw an area, pick a color. The color is multiplied with the
  image, as a highlighter pen does: dark text stays dark and the white of the page
  takes the color (on a dark background it hardly shows). It is never fully
  opaque, whatever the color, so it cannot hide what is under it: use the solid
  fill for that.
- **Spotlight**: draw the area that stays bright, and everything else is
  dimmed. Draw more areas to keep several bright (they make one shade, an
  overlap is bright once). A spotlight goes under the annotations, so what you
  draw over it is not dimmed.
- **Numbered markers** mark the steps of a procedure: pick the *Marker* tool and
  click once per step. Each click places the next number, the smallest one not
  used yet (delete the 2 and the next marker is a 2 again), and the tool stays
  until you press **Esc**. The color is the one of the style bar (the number
  turns dark on a light color) and the thin / medium / thick choice is the size
  of the disc, which follows the width of the image. Select a marker to change
  its color or size, move it, or resize it by a corner (it stays a circle). A
  marker is saved as data like any annotation, and drawn the same in the
  editor, the exports and the thumbnails.
- **The text and the number of a marker** are typed on the image, where they are.
  Right after the click a field is open on the new marker: type the text of the
  step (**Enter** keeps it and the tool stays for the next step, **Esc** takes the
  field away, a second **Esc** ends the tool, and **Ctrl+Z** in the empty field
  takes the marker back). Later, **double click the text** to edit it, **double
  click the disc** to type another number (1 to 999; two markers may have the same
  one if you want), or select the marker and press **Enter**. Esc puts the old
  text back, leaving the field keeps it, and the whole edit is one step of the
  history. The text is a short line in a pill of the color of the marker, on the
  right of the disc, and **on the left on its own when it would leave the image**;
  the *Text side* buttons of the style bar choose (and the choice is final). The
  disc stays where you clicked whatever the text does. The text moves, resizes and
  is saved with the marker, and the box you select holds both.
- Output scale (percentage or width), 50 levels of undo and redo, zoom and pan.
- **Beautify** (the button in the bar under the editor) puts the capture on a
  **background**: none, one of the nine colors or a free color, or one of six
  gradients. The look has a **padding**, rounded **corners**, a **shadow** (none,
  soft, strong) and an optional **window bar** with the three dots above the
  capture. The editor shows the capture inside its look while it is on, and you
  keep drawing, selecting, cropping, zooming and panning on the capture itself
  (the look steps aside while you edit a crop). The panel opens as a column next
  to the editing area, which stays in sight and follows the controls as they
  move; the *Output* size counts what the look adds (the scale comes down if the
  result would pass the ceilings). It belongs to a
  version: the original is untouched, it can be turned off, a new version starts
  without it, and the last look is offered when you turn it on for another
  version. The editor, its copy and download, the grouped export, the PDF and the
  thumbnails all draw the same pixels. A background of *None* stays transparent
  in PNG and WebP, and is white in JPEG and PDF.
- **Copy image** puts the displayed version on the clipboard. **Download** is
  described below.
- The interface is built on icons; a button that is only an icon has a tooltip
  and an accessible name.

**Delete** or **Backspace** removes the selection, **Ctrl+Z** undoes, **Ctrl+Y**
(or **Ctrl+Shift+Z**) redoes, **Esc** leaves cropping or goes back to the
selection tool, **Ctrl+wheel** zooms, the wheel scrolls (**Shift+wheel**
sideways). Cmd stands in for Ctrl on macOS.

### Versions

The original of each capture is immutable. A version holds only its annotations,
its crop, its scale and its beautify look (JSON, no pixels). Make as many as you like, "original",
"hidden for the customer", "annotated for the team", and switch between them
without losing anything.

### Download and export

- **Download** saves the displayed version. The default format is shown beside
  the button; the arrow next to it opens the options: format (PNG, JPEG, WebP or
  PDF), quality, and for a PDF the pages and the images. For JPEG and WebP the
  menu shows an estimate of the file size once you move the quality slider.
- An unedited capture downloaded as PNG is the original file, not re-encoded.
- **PDF** pages are images. *Fit to image*: one page the size of the image
  (96 dpi). *A4*: the image scaled to the width of an A4 page and cut into A4
  pages. Images are *lossless* or *light* (JPEG, with the quality setting).
- **Grouped export**: select captures in the History sheet, then *Export…* to
  get one file, a ZIP of images (PNG, JPEG or WebP) or a multipage PDF. Each
  capture goes out as it is displayed, that is its active version. An edited
  capture that is set to show its original goes out without its changes, and
  the dialog says so. At most 200 captures and 256 MiB per file; you can cancel,
  and the captures that could not be exported are listed.
- Files are named `<site>_<date>_<time>.<ext>`, the date being the one of the
  capture. The *File name* setting changes that: it is a template with the words
  `{host}`, `{title}`, `{date}` and `{time}` and any text around them (for example
  `{date} {title}`). The title of the page is only part of a name when the template
  says `{title}`. A grouped export is `obturo_<date>_<time>.zip` or `.pdf`, and the
  captures inside the ZIP follow the template.

### Languages and theme

- **Nine languages**: English, French, German, Spanish, Brazilian Portuguese, Indonesian, Russian, Japanese and simplified Chinese, chosen in the extension (*Settings*, *Language*): *Auto* follows the
  language of the browser (a region that is not translated, such as pt-PT, takes
  the translated one, pt-BR), or pick one. The tooltip and the menu of the icon
  follow that choice too. The description and the shortcut names shown by Chrome
  follow the language of the browser, because no API changes them.
- English and French are written by the author. The other seven are assisted
  translations, read over but not yet reviewed by native speakers: corrections
  are welcome (see [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-language)).
- **Theme**: system, light or dark.
- To add a language, see [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-language).

### Fast

The strip of captures is painted before the editor starts loading, and the
history sheet only draws the cards in view. The budgets are written down in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and measured by `npm run bench`.

## Scope

Obturo targets Chrome 116 and later, on the desktop. It has no build step: the
repository folder is the extension.

There is no server and no account, and none is planned. Nothing is sent
anywhere, no code is downloaded, there is no telemetry. A cloud sync would
contradict that, and would need network access and a privacy policy of another
kind.

There is no Firefox port: it would need its own manifest and code paths, twice
the surface to test. That is open again if someone ports it and maintains the
port.

There is no OCR. It is outside what the extension is for (capture, annotate,
keep), and it would mean shipping a recognition engine with its models, or
downloading them, which is remote code.

There is no `chrome.debugger`. It would capture a full page without scrolling,
but its permission cannot be optional and shows "Read and change all your data
on all websites" at install, which breaks the promise of a minimal access. The
full page is scrolled and stitched instead, with the limits below.

## Known limits

- **Hide sensitive text** reads the text of the page, so it does not see what is
  not text: images, canvases, the content of frames, closed shadow DOM and the
  content of form fields (the value of an input, a text area or a drop-down,
  whether the page or you filled it). The text is searched block by block: a
  value split by inline elements (a phone number in two spans) is found, one
  split by a line break or by two blocks is not. It looks for
  e-mail addresses, phone numbers (international and French forms), IBANs and
  card numbers (both with their checksum), and the keys of a few services
  (Stripe, GitHub, AWS, Slack, Google, a JWT, a private key block); a name, an
  address, an amount or a key of another shape is left as it is. A page of
  more than 200,000 text nodes, or a search that takes more than 0.4 s per
  image, is searched only as far as that goes, and the note says so. Open
  shadow roots are searched; the note is a box on the page, so with *Ask what
  to do* it is on the captured tab, behind the page of actions, which says how
  many items were covered too.
- **Full page**: one scrolling area per capture, the document or the panel that
  shows the most: a second column or a sidebar that scrolls is not in the image,
  and what a frame shows is captured as it shows, not scrolled. A page that
  draws or fades in by script after a scroll needs the wait of the settings (the
  automatic wait only sees images that load and CSS animations); a page that
  scrolls by itself (a canvas, a custom scroll) gives the visible part. Content
  that moves while the page is captured can show seams, and fixed elements
  inside a closed shadow DOM repeat on every tile. A page that grows meanwhile
  (infinite scroll) is followed as far as the limits allow. The image is cut
  where it would have to shrink below half its size (about 30 screens of a
  1080p window at 100%, 100 tiles at most, about two a second because Chrome
  allows two `captureVisibleTab` calls per second) and capped at 16,384 px a
  side and 32 million pixels, reduced above that. The memory of the extension
  peaks while the page is stitched (about 400 MB for 1080p tiles, up to about
  680 MB for 4K tiles) and is released at the end.
- **No text or links in exports**: a capture is an image, and so is a PDF page.
  The text cannot be selected or searched and the links are gone.
- **Clipboard copy** depends on the focus of the page. When it fails (orange
  badge), copy the image from the library.
- **Pages that cannot be captured**: Chrome forbids extensions on some pages
  (`chrome://`, the Chrome Web Store...).
- **One editing tab**: with the library open in two tabs, the second one is
  read-only, so that two tabs never overwrite each other. It shows the capture
  you pick in the strip or the history, as the editor would export it, and
  keeps *Copy image* and *Download*; editing, versions, pins, deletions and
  imports stay off.
- **The very last change**: edits are saved 500 ms after the last one, and at
  once when the tab is hidden, reloaded or closed. A change made less than about
  25 ms before the tab goes away can still be lost on a busy machine.
- **Large purges**: removing 1,000 captures takes about 1 to 2 seconds
  (Chromium deletes one file per image). It is done in small lots, so captures
  and saves go on meanwhile.
- **Grouped export** keeps the encoded files in memory until the single file is
  built, hence the limit of 200 captures and 256 MiB.

## Data

Everything lives in the browser, in storage private to the extension and to your
browser profile:

| Where | Content |
|---|---|
| IndexedDB `obturo` (version 3), store `shots` | one small row per capture: page address and title, host, size, date, versions, active version, pinned flag, thumbnail (WebP). An imported image has no address and its file name as title |
| same database, store `originals` | the original PNG of each capture or imported image, written once and never rewritten |
| same database, store `catalog` | one light entry per capture (date, size, flags, host, text to search), in buckets: search, filters, totals and the retention read it instead of the captures |
| IndexedDB `obturo-settings` | the settings, and the list of captures the open library holds (so that the cleanup spares them) |
| `localStorage` | a copy of the language and the theme, so that the first paint of the library is in the right language and theme; IndexedDB stays the truth |

A database left by an earlier development build (version 2) is upgraded in
place, without losing a capture.

The captures are stored as they are, not encrypted. Nothing leaves the machine,
and uninstalling the extension deletes the data. The details are in
[docs/PRIVACY.md](docs/PRIVACY.md).

Two things to know before sharing a capture:

- Pixelate, blur and solid fill only change the image you copy or export. The original
  stays intact in the library, which is the point of non-destructive editing:
  delete the capture to erase it.
- Pixelation and blur are not a reliable protection for text. Use the solid fill.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Capture the active tab, only after a gesture from you (icon click, shortcut, menu). No access to websites in general. |
| `scripting` | With `activeTab`, inject into the active tab, on demand, the script that selects an area or scrolls the full page, the one that covers the sensitive text while the image is taken (only with *Hide sensitive text* on), and write the image to the clipboard from there; after a full-page capture, show a short note on the page when the image is not the whole page or the capture stopped. Nothing is injected without a gesture from you. |
| `contextMenus` | The icon's right-click menu: *Capture* and *Capture and edit* (submenus), *Open the library* and *Settings*. |

Obturo asks for no access to websites, reads the clipboard only when you paste
an image into the library (the paste of the page, no permission) and otherwise
only writes the image you have just captured, and makes no network request: the content security
policy of the manifest forbids it, and a test proves it (see "Check it yourself" in
[docs/PRIVACY.md](docs/PRIVACY.md)). It does not ask
for `unlimitedStorage` either: the storage quota measured for the extension is
far above the default size limit (2 GB), which keeps the history under it. If
the browser ever refuses a write, the badge turns red (`ERR`). A new permission
is discussed first, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Install

[Add Obturo to Chrome](https://chromewebstore.google.com/detail/obturo/kaafiicmlbdchfalaljmbeoblihjbnih) from the Chrome Web Store.

To run the code instead, in developer mode, with Chrome 116 or newer and no tooling:

1. Get this repository (clone or archive) into a folder. From a
   [release](https://github.com/kodetix-fr/obturo/releases) instead, unzip
   `obturo-<version>.zip`; the `.sha256` file next to it checks the download.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick that folder.
4. After changing the code, use the reload button on the extension's card.

## Layout

No build step, plain ES modules. `docs/ARCHITECTURE.md` has the capture flow, the
databases, the retention, the version model and the budgets.

- `sw.js`: the service worker. Gestures (icon, shortcuts, menu), the three
  captures, the clipboard copy, the write to IndexedDB and the icon menu. It
  imports `db.js`, `pure.js`, `fullpage-pure.js`, `gestures.js`, `i18n.js` and
  `settings.js` (and what those import), never Fabric.js.
- `gestures.js`: what the icon menu holds and where a gesture sends the user.
- `overlay.js`, `fullpage.js`: injected into the tab on demand. The area
  selection, and the page driver of a full-page capture. `notice.js` is the
  short note a full-page capture leaves on the page when it is not the whole
  page or stops.
- `sensitive.js`, `redact.js`: injected together when *Hide sensitive text* is
  on. The first finds what to hide in a text (a pure function, tested without a
  browser); the second covers it for the length of an image.
- `db.js`, `catalog.js`, `retention.js`: IndexedDB access, the catalog that
  search and retention read, and the retention policy. `db-warm.js` opens the
  database while the library page is still being parsed.
- `settings.js`, `i18n.js`, `locales/`, `dom-i18n.js`, `theme-boot.js`: the
  settings database, the translation, the texts of each language, the
  translation of the page, and the theme applied before the first paint.
- `library.html`, `library.css`, `library.js`: the library page, the strip of
  captures and the editing lock. `viewer.js` shows a capture in a read-only tab.
- `history-view.js`, `history-model.js`, `history-dialogs.js`,
  `history-settings.js`, `settings-ui.js`: the history sheet, its logic, its
  confirmations, the history block of the settings, and the settings dialog.
  Loaded on first use.
- `editor.js`, `panel.js`, `dom.js`, `output.js`, `shapes.js`: the editor, built
  on [Fabric.js](https://github.com/fabricjs/fabric.js) and loaded after the
  strip is painted.
- `export-ui.js`, `export-batch.js`, `export-pure.js`, `export.css`,
  `encode.js`, `pdf.js`, `zip.js`: the download menu, the grouped export, and the
  encoders (images, PDF and ZIP written without a library). Loaded on first use.
- `pure.js`, `fullpage-pure.js`, `import-pure.js`, `thumb-pure.js`,
  `versions.js`, `view.js`, `history.js` (the undo and redo stack),
  `saver.js`: the logic, without `chrome.*`, IndexedDB or the DOM, tested with
  `node --test`.
- `vendor/`: Fabric.js 6.9.1, unmodified, with its license and its checksums.
- `_locales/`: the name, description and shortcut names that Chrome reads from
  the manifest, in each language.
- `test/e2e/`: end-to-end tests, the real extension in Playwright's Chromium.
- `scripts/`: packaging, benchmark and icon generation.

## Development

Node 22.13 or newer (CI runs Node 24). The development tools only check the
code: the extension has no runtime dependency.

```sh
npm ci --ignore-scripts
npm run check        # lint, typecheck, unit tests and texts: no browser, fast
npm run test:e2e     # the real extension in Playwright's Chromium, one file at a time
npm run bench        # manual benchmark of the performance budgets
npm run package      # dist/obturo-<version>.zip, runtime files only
```

The first time, install the Chromium of Playwright for the end-to-end tests:
`npx playwright-core install chromium` (add `--with-deps` on Linux). The
end-to-end tests run at concurrency 1 and take several minutes.

CI runs the lint, the type check, the unit tests and the packaging on every push
to `main` and every pull request, the end-to-end tests in a separate job. A
second workflow runs Semgrep, `npm audit` and Gitleaks on every push and every
Monday, with the Semgrep findings in the repository's Security tab;
`npm audit --audit-level=high` runs the same advisory check locally. The
benchmark is not run in CI, its durations depend on the hardware.

The logo lives in `docs/logo.svg`; the icons in `icons/` are the same drawing,
rendered by `npm run icons`. `docs/social-preview.png` is the 1280x640 card for
the repository's social preview, rendered from `docs/social-preview.html`.

## Support

Obturo is free and will stay free. To support Kodetix, which builds it: https://kodetix.fr/soutenir

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the local
checks, the conventions and how to add a language. Vulnerabilities go through
[SECURITY.md](SECURITY.md) rather than a public issue. Released changes are
listed in [CHANGELOG.md](CHANGELOG.md).

## License

MIT, see [LICENSE](LICENSE). Fabric.js (MIT) is
bundled in `vendor/` under its own license, see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
