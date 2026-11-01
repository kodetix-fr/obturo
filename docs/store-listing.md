# Obturo - Chrome Web Store listing

Prepared on 2026-10-01, rewritten against the code on 2026-10-02. Nothing is published or submitted. The texts below describe the product as the code does today: reread them against what actually ships, after the manual test. The notes are in English; the texts that go into the store are given in French (the main audience of the store) and in English. The French one addresses the reader as "tu", like the interface.

## 1. Requirements checked in the official documentation (2026-10-01)

Sources consulted:

- https://developer.chrome.com/docs/webstore/program-policies/privacy
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/review-process
- https://developer.chrome.com/docs/webstore/register
- https://developer.chrome.com/docs/extensions/reference/manifest

Findings:

- **A privacy policy is REQUIRED, even when everything is local.** The FAQ says extensions must disclose how they handle data "even when the data is processed or stored locally on the device and is not transmitted". "Handle" means collect, transmit, use or share. "Website content" and screenshots are named explicitly. The dashboard asks for a policy URL, so the policy has to be hosted (see section 8). `docs/PRIVACY.md` is the ready text, in English then in French.
- **Single purpose**: either a narrow subject or a narrow browser function. "Excessive permissions unrelated to the single purpose will be considered a violation."
- **Privacy tab of the dashboard**: description of the single purpose, justification of each permission, justification of remote code, disclosure of the kinds of data collected, certifications, policy URL.
- **Manifest limits**: `name` 75 characters, `short_name` 12, `description` 132. The packaging script checks `name` and `description` in each language of `_locales/`.
- **Visuals**: 128x128 PNG icon (a 96x96 drawing plus a 16 px transparent margin on each side, readable on light and dark backgrounds); at least 1 screenshot (5 ideally) at 1280x800 or 640x400, square corners, no margin; **small tile 440x280, marked as required** on the images page; 1400x560 marquee optional.
- **Publishing**: upload of a zip (2 GB max); tabs Store Listing (description, category, language required), Privacy, Distribution (paid or not, countries, public / unlisted / private visibility), Test instructions; "Submit for review"; deferred publication is possible, up to 30 days after the review ends.
- **Review**: usually a few days, up to a few weeks; closer examination for new developers or extensions, dangerous permissions, broad host permissions (`<all_urls>`...). Obturo asks for none.
- **Not confirmed by the documentation consulted**: the amount of the registration fee (the page only says "one-time registration fee"; the often quoted 5 USD is to be confirmed at sign-up); the two-step verification requirement; the exact labels of the disclosure and certification boxes (the page only has a screenshot); the list of store categories.

## 2. Name

Obturo (6 characters, limit 75).

## 3. Short summary (limit 132)

The store takes the summary from the manifest `description`, which comes from `extDescription` in `_locales/<language>/messages.json`. What ships today, with the character count of each:

| Language | Text in the package | Characters |
|---|---|---|
| English (default) | Capture, annotate and keep your screenshots. 100% local, no account. | 68 |
| French | Capture, annote et garde tes captures d'écran. 100 % local, sans compte. | 72 |
| German | Screenshots aufnehmen, beschriften und behalten. 100 % lokal, ohne Konto. | 73 |
| Spanish | Haz capturas de pantalla, anótalas y consérvalas. 100 % local, sin cuenta. | 74 |
| Portuguese (Brazil) | Capture, anote e guarde suas capturas de tela. 100% local, sem conta. | 69 |
| Indonesian | Tangkap, beri anotasi, dan simpan tangkapan layar Anda. 100% lokal, tanpa akun. | 79 |
| Russian | Делайте скриншоты, добавляйте пометки и храните их. 100 % локально, без аккаунта. | 81 |
| Japanese | スクリーンショットを撮影し、注釈を付けて保存。100% ローカル、アカウント不要。 | 41 |
| Chinese (simplified) | 截取、标注并保存你的截图。100% 本地，无需账号。 | 26 |

The seven languages after French are assisted translations, not yet reviewed by native speakers (the README says so); the store listing texts below exist in English and French only, the store shows the English one to the other languages.

A richer wording that mentions the history and the exports, if the owner prefers it. It is NOT in the package: adopting it means changing `extDescription` in the two `messages.json` files.

| Language | Alternative | Characters |
|---|---|---|
| English | Capture, annotate and keep your screenshots locally: searchable history, PNG, JPEG, WebP and PDF export. No account. | 116 |
| French | Capture, annote et garde tes captures en local : historique avec recherche, export PNG, JPEG, WebP et PDF. Sans compte. | 119 |

## 4. Long description

### Français

Obturo capture, annote et garde tes captures d'écran, sans compte et sans serveur.

CAPTURER
- Capture une zone, la partie visible ou la page entière d'un onglet : au clic sur l'icône, au raccourci clavier ou dans le menu du clic droit sur l'icône.
- Les variantes « Capturer et éditer » ouvrent la capture dans l'éditeur dès qu'elle est prête.
- Chaque capture est copiée dans le presse-papiers, prête à coller dans un ticket ou un message.
- Mode sans trace : un interrupteur dans le popup, et la capture n'est que copiée, enregistrée nulle part (l'icône devient violette).
- Importe n'importe quelle image (un fichier, un collage avec Ctrl+V, un glisser-déposer) pour l'annoter et la garder dans l'historique.

ANNOTER SANS RIEN PERDRE
- Contours (rectangle, arrondi, ellipse, main levée), flèches, pastilles numérotées pour les étapes, surligneur, projecteur pour attirer le regard, texte stylé, recadrage et redimensionnement ; pixelisation, flou ou aplat pour masquer des données sensibles.
- L'original n'est jamais modifié. Garde plusieurs versions d'une même capture (original, masqué pour le client, annoté pour l'équipe) et passe de l'une à l'autre sans rien perdre.

RETROUVER ET GARDER
- L'historique se parcourt en grille : recherche dans les titres et les adresses, filtres par site et par période, sélection multiple.
- Épingle ce qui doit rester.
- Choisis combien de temps tout est gardé (de 7 jours à 1 an, ou sans limite de durée) et la taille maximale (de 500 Mo à 10 Go, ou sans plafond). Par défaut : 30 jours et 2 Go. Les captures épinglées ne sont jamais supprimées automatiquement.
- Purge à la demande, avec un aperçu de ce qui serait supprimé.

EXPORTER
- Télécharge en PNG, JPEG, WebP ou PDF, avec le choix de la qualité et une estimation de la taille.
- Sélectionne plusieurs captures et exporte-les d'un coup en ZIP d'images ou en PDF de plusieurs pages.

Interface en neuf langues (français, anglais, allemand, espagnol, portugais du Brésil, indonésien, russe, japonais, chinois simplifié), au choix dans l'extension. Thème clair ou sombre.

Confidentialité : tout reste sur ton ordinateur. Aucun compte, aucun serveur, aucune télémétrie, aucune publicité, aucun code distant. L'extension ne demande aucun accès général aux sites : elle n'agit sur un onglet que lorsque tu le lui demandes.

Raccourcis par défaut (modifiables dans chrome://extensions/shortcuts) : Alt+Maj+Z capture une zone, Alt+Maj+V la partie visible, Alt+Maj+F la page entière, Alt+Maj+L ouvre la bibliothèque. Les trois commandes « et éditer » n'ont pas de touche par défaut : choisis la tienne au même endroit.

Limites : la capture de la page entière suit une seule zone de défilement par capture, le document ou le panneau qui en montre le plus ; une seconde colonne qui défile n'est pas dans l'image. Les PDF contiennent des images : leur texte n'est pas sélectionnable.

### English

Obturo captures, annotates and keeps your screenshots, with no account and no server.

CAPTURE
- Capture an area, the visible part or the full page of a tab: from the icon, a keyboard shortcut or the icon's right-click menu.
- The "Capture and edit" variants open the capture in the editor as soon as it is ready.
- Every capture is copied to the clipboard, ready to paste into a ticket or a message.
- No-trace mode: a switch in the popup, and the capture is only copied, saved nowhere (the icon turns violet).
- Import any image (a file, a paste with Ctrl+V, a drag and drop) to annotate it and keep it in the history.

ANNOTATE WITHOUT LOSING ANYTHING
- Outlines (rectangle, rounded, ellipse, freehand), arrows, numbered markers for the steps, highlighter, spotlight to draw the eye, styled text, crop and resize; pixelate, blur or solid fill to hide sensitive data.
- The original is never changed. Keep several versions of the same capture (original, hidden for the customer, annotated for the team) and switch between them without losing anything.

FIND AND KEEP
- Browse the history as a grid: search in titles and addresses, filter by site and by period, select several captures.
- Pin what must stay.
- Choose how long everything is kept (from 7 days to 1 year, or forever) and the maximum size (from 500 MB to 10 GB, or no limit). By default: 30 days and 2 GB. Pinned captures are never removed automatically.
- Purge on demand, with a preview of what would be removed.

EXPORT
- Download as PNG, JPEG, WebP or PDF, with a quality setting and an estimate of the file size.
- Select several captures and export them at once as a ZIP of images or a multipage PDF.

The interface comes in nine languages (English, French, German, Spanish, Brazilian Portuguese, Indonesian, Russian, Japanese and simplified Chinese), your choice in the extension. Light or dark theme.

Privacy: everything stays on your computer. No account, no server, no telemetry, no ads, no remote code. The extension requests no broad access to websites: it only acts on a tab when you ask it to.

Default shortcuts (changeable at chrome://extensions/shortcuts): Alt+Shift+Z captures an area, Alt+Shift+V the visible part, Alt+Shift+F the full page, Alt+Shift+L opens the library. The three "and edit" commands have no default key: pick yours in the same place.

Limits: the full-page capture follows one scrolling area per capture, the document or the panel that shows the most; a second column that scrolls is not in the image. PDFs hold images: their text cannot be selected.

## 5. Category

Proposal: Productivity (Productivité). The documentation consulted does not detail the list of categories: pick it in the dashboard menu.

## 6. Single purpose ("Single purpose" field)

> Français : Capturer l'onglet actif sous forme d'image (zone, partie visible ou page entière), l'annoter, puis garder les captures en local dans un historique.
>
> English: Capture the active tab as an image (area, visible part or full page), annotate it, then keep the captures locally in a history.

The narrow browser function is the screenshot. Annotation, the history and the export of the captures are its direct extension.

## 7. Permission justifications (Privacy tab)

The permissions are unchanged: `activeTab`, `scripting` and `contextMenus`, and nothing else (`manifest.test.js` pins the list). `unlimitedStorage` is not requested: the storage quota measured for the extension is far above the default size limit of the history (2 GB), so the permission would add one more line to justify for no gain.

| Permission | Justification to enter (French) | Justification to enter (English) |
|---|---|---|
| `activeTab` | Capturer l'onglet actif et y afficher la sélection de zone, uniquement après une action explicite de l'utilisateur (clic sur l'icône, raccourci clavier ou entrée du menu de l'icône). Évite toute permission d'hôte générale. | Capture the active tab and show the area selection in it, only after an explicit action from the user (icon click, keyboard shortcut or entry of the icon menu). Avoids any broad host permission. |
| `scripting` | Avec `activeTab`, injecter à la demande le script de sélection de zone dans l'onglet actif, et y écrire l'image capturée dans le presse-papiers. Pour la capture de page entière, faire défiler la page, puis y afficher une courte note quand l'image n'est pas la page complète ou que la capture s'est arrêtée. Aucun script n'est injecté sans action de l'utilisateur. | With `activeTab`, inject on demand the area selection script into the active tab, and write the captured image to the clipboard from there. For a full-page capture, scroll the page, then show a short note in it when the image is not the whole page or the capture stopped. No script is injected without an action from the user. |
| `contextMenus` | Le menu du clic droit sur l'icône de l'extension : « Capturer » et « Capturer et éditer » (chacun avec Zone, Partie visible et Page entière), « Ouvrir la bibliothèque » et « Paramètres ». | The right-click menu of the extension icon: "Capture" and "Capture and edit" (each with Area, Visible part and Full page), "Open the library" and "Settings". |

Remote code: **No.** All the code is in the package, the vendored third-party library included (Fabric.js, MIT license); no script, module or executable resource is loaded from a server. The extension makes no network request.

If a change adds a permission to the manifest, this table must be updated before submission: any unjustified permission is a reason for rejection.

## 8. Data disclosure and privacy policy

The exact labels of the boxes are not in the documentation consulted: reread the real form. Answers in substance:

- **Data handled**:
  - *Website content*: the images of the captured pages (the originals, the annotations made on them, the thumbnails) and the identifiers of the captures the open library holds.
  - *Web history* (browsing activity): the address and title of each captured page, with the capture date.
  - *Settings*: language, theme, retention, size limit, download options. Preferences, not personal data; they are stored locally too.
  - Nothing else: no personally identifiable information, no health, financial or authentication data, no location, no communications. The clipboard is written, and read only for the image the user pastes into the library (Ctrl+V): the paste event of the page, no permission.
  - Declare them honestly, with the precision: stored locally in the extension's IndexedDB and `localStorage`, never transmitted, kept for a period chosen by the user (30 days by default, pinned and edited captures kept), deletable by the user or by uninstalling. The documentation requires the disclosure even then.
- **Certifications**: the extension complies with each, because no data is sold, transferred, used outside the single purpose, used for advertising, or read by a human (nothing leaves the device). This covers the four elements of the FAQ's "limited use": permitted use, permitted transfer, no personalised advertising, no human reading.
- **Policy URL**: https://kodetix.fr/en/obturo/confidentialite, the page of the kodetix.fr site rendered from `docs/PRIVACY.md`.
- The policy's contact is support@kodetix.fr, the e-mail address of the store account (section 10).

## 9. Visuals to produce

| Visual | Size | Status |
|---|---|---|
| Store icon | 128x128 PNG, 96x96 drawing + 16 px margin | Done: `icons/icon128.png` (generated by `scripts/make-icons.mjs`) |
| Screenshots | 1280x800 or 640x400, 1 minimum, 5 ideal, square corners, no margin | To do AFTER the owner's manual test (see the list below) |
| Small tile | 440x280 | To do: marked as required by the documentation. `docs/logo.png` (512 px) is the same drawing as the icon |
| Marquee | 1400x560 | Optional |

Screenshots to produce, on made-up pages and data (no real capture, no personal data), one theme each unless said:

1. The editor with an annotated capture (arrow, text, solid fill), the versions and the strip of captures visible.
2. The area selection over a page, just before the release of the mouse.
3. The history sheet: grid, search, filters, a few pinned captures, a selection with its action bar.
4. The Download menu open: formats, quality with the size estimate, the PDF options.
5. The settings (history: retention, size limit, gauge) in the dark theme.

## 10. Submission steps

1. Create the developer account (one-time registration fee; amount and conditions to be read at sign-up) and provide the developer e-mail address.
2. `npm run package`: builds `dist/obturo-<version>.zip` (checks built in).
3. Dashboard, "Add new item", upload the zip.
4. Store Listing tab: description (section 4), category, language, visuals (section 9).
5. Privacy tab: single purpose (6), permission justifications (7), remote code (no), disclosure (8), policy URL.
6. Distribution tab: free of charge, countries, visibility (starting unlisted to test the listing is possible).
7. Test instructions tab (text below).
8. "Submit for review". Choose deferred publication to decide the moment once the review is over.

Test instructions to enter: "No account or sign-in is needed. Open any web page, press Alt+Shift+Z (or click the Obturo icon) and drag a rectangle: the badge shows OK and the image is on the clipboard. Press Alt+Shift+L (or right-click the icon and choose Open the library) to see the capture, annotate it and download it. The icon's right-click menu also has the full-page capture and the Settings (language, theme, how long captures are kept, download options). Chrome pages (chrome://...) and the Chrome Web Store cannot be captured by any extension. The extension sends nothing to any server."

## 11. "Performance" checklist before submission

- [x] **Package size** (checked on 2026-10-02): `npm run package` builds a zip of 57 files, 726 KB raw and 241 KB zipped (246,780 bytes), and prints no warning about a heavy file (the warning is for any file over 500 KB outside `vendor/`). The only big piece is `vendor/` (Fabric.js, 316,082 bytes minified).
- [x] **No useless file**: the list printed by the script holds no test, no `.md` or other doc, no script, no hidden file. Only the licenses travel: `LICENSE` at the root and `vendor/fabric.LICENSE`.
- [x] **No remote code** (checked on 2026-10-02): outside `vendor/` and the tests, the only `http` addresses in the files of the extension are the SVG namespace in `dom-i18n.js` (an identifier, never requested) and the made-up address `https://obturo/` in `export-pure.js`, whose host names the grouped export file (never requested); no `eval`, no `new Function`, no `import()` of a remote address, no `<script src="http...">` (the editor and the export code are loaded by an `import()` of a file of the package, which is intended), no `fetch`, `XMLHttpRequest` or `WebSocket`. In `vendor/fabric.min.mjs`, only XML namespace strings (`http://www.w3.org/...`) were found on 2026-10-01; redo this check at each update of the library.
- [x] **Service worker imports**: `sw.js` imports `db.js`, `pure.js`, `gestures.js`, `i18n.js` and `settings.js` (and what those import: `retention.js`, `catalog.js`, the dictionaries of `locales/`), and no import of `vendor/` appears there (Fabric loads only in the library page).
- [ ] **Service worker start**: measure it, chrome://extensions, "Service Worker", then the Performance tab of DevTools, cold start; proposed target: a few tens of milliseconds. At load time `sw.js` holds constants and listeners and starts the rebuild of the icon menu, which runs off the capture path.
- [ ] **Memory**: library open with 12 captures, Chrome Task Manager (Shift+Esc); check that a full-page capture does not blow up the service worker (measured peak: about 400 MB with 1080p tiles, about 680 MB with 4K tiles, released at the end).
- [x] **Promise / code consistency**: the policy announces deletion from the library, and it exists in four places: the "x" button of each capture in the strip, the deletion of a selection in the history sheet, "Purge now" and "Delete everything" in the settings. The retention defaults in the policy (30 days, 2 GB, pinned and edited captures kept) are the ones of `settings.js`.

## 12. Price

Obturo is free of charge.
