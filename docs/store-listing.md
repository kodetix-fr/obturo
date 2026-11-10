# Obturo - Chrome Web Store listing

Prepared on 2026-10-01, rewritten against the code on 2026-10-02, texts and visuals brought to version 0.3.0 on 2026-11-09. The listing is published (the README links to it); this file holds the texts that are pasted into the dashboard, and changing it changes nothing there by itself. The texts below describe the product as the code does today: reread them against what actually ships, after the manual test. The notes are in English; the texts that go into the store are given in French (the main audience of the store) and in English. The French one addresses the reader as "tu", like the interface.

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

The brand first, then a short descriptor in the words people search in each language (the store forbids stuffing the name with keywords). It comes from `extName` in `_locales/<language>/messages.json`; the tooltip of the icon stays "Obturo" (`actionTitle`). What ships, with the character count (limit 75):

| Language | Name in the package | Characters |
|---|---|---|
| English (default) | Obturo: Screenshot & Annotate | 29 |
| French | Obturo : capture d'écran et annotation | 38 |
| German | Obturo: Screenshot & Anmerkungen | 32 |
| Spanish | Obturo: Captura de pantalla y anotaciones | 41 |
| Portuguese (Brazil) | Obturo: Captura de tela e anotações | 35 |
| Indonesian | Obturo: Tangkapan Layar & Anotasi | 33 |
| Russian | Obturo: скриншоты и пометки | 27 |
| Japanese | Obturo: スクリーンショットと注釈 | 20 |
| Chinese (simplified) | Obturo：截图与标注 | 12 |

## 3. Short summary (limit 132)

The store takes the summary from the manifest `description`, which comes from `extDescription` in `_locales/<language>/messages.json`. What ships, with the character count of each:

| Language | Text in the package | Characters |
|---|---|---|
| English (default) | Full-page, area or element screenshots, annotated and beautified. 100% local, no account, free and open source. | 111 |
| French | Capture d'écran de page entière, zone ou élément, avec annotations. 100 % local, sans compte, gratuit et open source. | 117 |
| German | Screenshots der ganzen Seite, eines Bereichs oder Elements, mit Anmerkungen. 100 % lokal, ohne Konto, kostenlos und Open Source. | 128 |
| Spanish | Capturas de pantalla de página completa, zona o elemento, con anotaciones. 100 % local, sin cuenta, gratis y de código abierto. | 127 |
| Portuguese (Brazil) | Capturas de tela da página inteira, de uma área ou de um elemento, com anotações. 100% local, sem conta, grátis e de código aberto. | 131 |
| Indonesian | Tangkapan layar halaman penuh, area, atau elemen, lengkap dengan anotasi. 100% lokal, tanpa akun, gratis dan open source. | 121 |
| Russian | Скриншоты всей страницы, области или элемента, с пометками. 100 % локально, без аккаунта, бесплатно, с открытым кодом. | 118 |
| Japanese | ページ全体・範囲・要素のスクリーンショットに注釈を付けて保存。100% ローカル、アカウント不要、無料のオープンソース。 | 60 |
| Chinese (simplified) | 截取整页、区域或元素的截图并添加标注。100% 本地，无需账号，免费开源。 | 37 |

The seven languages after French are assisted translations, not yet reviewed by native speakers (the README says so); the store listing texts below exist in English and French only, the store shows the English one to the other languages.

## 4. Long description

### Français

Obturo capture, annote et garde tes captures d'écran, sans compte et sans serveur.

CAPTURER
- Capture une zone, un élément de la page, la partie visible ou la page entière d'un onglet : au clic sur l'icône, au raccourci clavier ou dans le menu du clic droit sur l'icône.
- Les variantes « Capturer et éditer » ouvrent la capture dans l'éditeur dès qu'elle est prête.
- Après une capture, une page s'ouvre à côté de l'onglet pour choisir : l'éditer, la copier dans le presse-papiers (prête à coller dans un ticket ou un message) ou la télécharger. Les réglages permettent aussi de la copier d'office, ou d'enregistrer le fichier d'office.
- Un délai au choix (3, 5 ou 10 secondes) laisse le temps d'ouvrir un menu ou une infobulle avant la capture.
- « Masquer le texte sensible » (désactivé par défaut) recouvre en noir, le temps de la prise de l'image, les adresses e-mail, numéros de téléphone, IBAN, numéros de carte et clés trouvés dans le texte de la page. C'est un effort, pas une garantie : regarde l'image avant de la partager.
- Mode sans trace : un interrupteur dans le popup, et la capture n'est que copiée, enregistrée nulle part (l'icône devient violette).
- Importe n'importe quelle image (un fichier, un collage avec Ctrl+V, un glisser-déposer) pour l'annoter et la garder dans l'historique.

ANNOTER SANS RIEN PERDRE
- Contours (rectangle, arrondi, ellipse, main levée), flèches, traits et doubles flèches, crayon, pastilles numérotées pour les étapes, vingt émojis, surligneur, projecteur pour attirer le regard, texte stylé, recadrage, redimensionnement et quart de tour ; pixelisation, flou ou aplat pour masquer des données sensibles.
- Un tampon ajoute l'adresse de la page (sans ce qui suit le « ? », qui peut contenir un jeton) et la date de la capture, en texte que tu peux déplacer, modifier ou supprimer.
- Beautify pose la capture sur un fond uni ou dégradé, avec marges, coins arrondis, ombre et barre de fenêtre.
- L'original n'est jamais modifié. Garde plusieurs versions d'une même capture (original, masqué pour le client, annoté pour l'équipe) et passe de l'une à l'autre sans rien perdre.

RETROUVER ET GARDER
- L'historique se parcourt en grille : recherche dans les titres et les adresses, filtres par site et par période, sélection multiple. Le bandeau des captures, sous l'éditeur, se replie pour laisser la place à l'image.
- Épingle ce qui doit rester.
- Choisis combien de temps tout est gardé (de 7 jours à 1 an, ou sans limite de durée) et la taille maximale (de 500 Mo à 10 Go, ou sans plafond). Par défaut : 30 jours et 2 Go. Les captures épinglées ne sont jamais supprimées automatiquement.
- Purge à la demande, avec un aperçu de ce qui serait supprimé.

EXPORTER
- Télécharge en PNG, JPEG, WebP ou PDF, avec le choix des dimensions (échelle ou largeur), de la qualité et une estimation du poids du fichier.
- Sélectionne plusieurs captures et exporte-les d'un coup en ZIP d'images ou en PDF de plusieurs pages.

Interface en neuf langues (français, anglais, allemand, espagnol, portugais du Brésil, indonésien, russe, japonais, chinois simplifié), au choix dans l'extension. Thème clair ou sombre.

Confidentialité : tout reste sur ton ordinateur. Aucun compte, aucun serveur, aucune télémétrie, aucune publicité, aucun code distant. L'extension ne demande aucun accès général aux sites : elle n'agit sur un onglet que lorsque tu le lui demandes.

Raccourcis par défaut (modifiables dans chrome://extensions/shortcuts) : Alt+Maj+Z capture une zone, Alt+Maj+V la partie visible, Alt+Maj+F la page entière, Alt+Maj+L ouvre la bibliothèque. La capture d'un élément et les trois commandes « et éditer » n'ont pas de touche par défaut : choisis la tienne au même endroit.

Limites : la capture de la page entière suit une seule zone de défilement par capture, le document ou le panneau qui en montre le plus ; une seconde colonne qui défile n'est pas dans l'image. « Masquer le texte sensible » ne couvre ni les champs de formulaire, ni les images, ni les cadres. Les PDF contiennent des images : leur texte n'est pas sélectionnable.

### English

Obturo captures, annotates and keeps your screenshots, with no account and no server.

CAPTURE
- Capture an area, an element of the page, the visible part or the full page of a tab: from the icon, a keyboard shortcut or the icon's right-click menu.
- After a capture, a page opens next to the tab to choose: edit it, copy it to the clipboard (ready to paste into a ticket or a message) or download it. The settings can also copy every capture at once, or save the file at once.
- The "Capture and edit" variants open the capture in the editor as soon as it is ready.
- A delay of your choice (3, 5 or 10 seconds) leaves time to open a menu or a tooltip before the capture.
- "Hide sensitive text" (off by default) covers in black, while the image is taken, the e-mail addresses, phone numbers, IBANs, card numbers and keys found in the text of the page. It is a best effort, not a guarantee: look at the image before you share it.
- No-trace mode: a switch in the popup, and the capture is only copied, saved nowhere (the icon turns violet).
- Import any image (a file, a paste with Ctrl+V, a drag and drop) to annotate it and keep it in the history.

ANNOTATE WITHOUT LOSING ANYTHING
- Outlines (rectangle, rounded, ellipse, freehand), arrows, lines and double arrows, a pen, numbered markers for the steps, twenty emoji, highlighter, spotlight to draw the eye, styled text, crop, resize and quarter turn; pixelate, blur or solid fill to hide sensitive data.
- A stamp adds the address of the page (without what follows the "?", which can hold a token) and the date of the capture, as a text you can move, edit or delete.
- Beautify puts the capture on a plain or gradient background, with padding, rounded corners, a shadow and a window bar.
- The original is never changed. Keep several versions of the same capture (original, hidden for the customer, annotated for the team) and switch between them without losing anything.

FIND AND KEEP
- Browse the history as a grid: search in titles and addresses, filter by site and by period, select several captures. The strip of captures under the editor folds to leave the room to the image.
- Pin what must stay.
- Choose how long everything is kept (from 7 days to 1 year, or forever) and the maximum size (from 500 MB to 10 GB, or no limit). By default: 30 days and 2 GB. Pinned captures are never removed automatically.
- Purge on demand, with a preview of what would be removed.

EXPORT
- Download as PNG, JPEG, WebP or PDF, with the size (scale or width), a quality setting and an estimate of the file size.
- Select several captures and export them at once as a ZIP of images or a multipage PDF.

The interface comes in nine languages (English, French, German, Spanish, Brazilian Portuguese, Indonesian, Russian, Japanese and simplified Chinese), your choice in the extension. Light or dark theme.

Privacy: everything stays on your computer. No account, no server, no telemetry, no ads, no remote code. The extension requests no broad access to websites: it only acts on a tab when you ask it to.

Default shortcuts (changeable at chrome://extensions/shortcuts): Alt+Shift+Z captures an area, Alt+Shift+V the visible part, Alt+Shift+F the full page, Alt+Shift+L opens the library. The element capture and the three "and edit" commands have no default key: pick yours in the same place.

Limits: the full-page capture follows one scrolling area per capture, the document or the panel that shows the most; a second column that scrolls is not in the image. "Hide sensitive text" does not cover form fields, images or frames. PDFs hold images: their text cannot be selected.

## 5. Category

Proposal: Productivity (Productivité). The documentation consulted does not detail the list of categories: pick it in the dashboard menu.

## 6. Single purpose ("Single purpose" field)

> Français : Capturer l'onglet actif sous forme d'image (zone, élément, partie visible ou page entière), l'annoter, puis garder les captures en local dans un historique.
>
> English: Capture the active tab as an image (area, element, visible part or full page), annotate it, then keep the captures locally in a history.

The narrow browser function is the screenshot. Annotation, the history and the export of the captures are its direct extension.

## 7. Permission justifications (Privacy tab)

The permissions are unchanged: `activeTab`, `scripting` and `contextMenus`, and nothing else (`manifest.test.js` pins the list). `unlimitedStorage` is not requested: the storage quota measured for the extension is far above the default size limit of the history (2 GB), so the permission would add one more line to justify for no gain.

| Permission | Justification to enter (French) | Justification to enter (English) |
|---|---|---|
| `activeTab` | Capturer l'onglet actif et y afficher la sélection de zone ou d'élément, uniquement après une action explicite de l'utilisateur (clic sur l'icône, raccourci clavier ou entrée du menu de l'icône). Évite toute permission d'hôte générale. | Capture the active tab and show the area or element selection in it, only after an explicit action from the user (icon click, keyboard shortcut or entry of the icon menu). Avoids any broad host permission. |
| `scripting` | Avec `activeTab`, injecter à la demande les scripts de sélection de zone et d'élément dans l'onglet actif, et y écrire l'image capturée dans le presse-papiers. Pour la capture de page entière, faire défiler la page. Afficher dans la page une courte note qui dit que la capture a été copiée, ou que l'image n'est pas la page complète, ou que la capture s'est arrêtée. Si l'utilisateur active « Masquer le texte sensible », lire le texte de la page, dans la page, pour y trouver adresses e-mail, numéros de téléphone, IBAN, numéros de carte et clés, et les recouvrir en noir le temps de la prise de l'image. Aucun de ces textes n'est gardé ni envoyé. Aucun script n'est injecté sans action de l'utilisateur. | With `activeTab`, inject on demand the area and element selection scripts into the active tab, and write the captured image to the clipboard from there. For a full-page capture, scroll the page. Show a short note in the page that says the capture was copied, or that the image is not the whole page, or that the capture stopped. If the user turns on "Hide sensitive text", (off by default), read the text of the page inside the page to find e-mail addresses, phone numbers, IBANs, card numbers and keys, and cover them in black while the image is taken: none of that text is kept or sent. No script is injected without an action from the user. |
| `contextMenus` | Le menu du clic droit sur l'icône de l'extension : « Capturer » et « Capturer et éditer » (chacun avec Zone, Partie visible, Page entière et Élément), « Ouvrir la bibliothèque » et « Paramètres ». | The right-click menu of the extension icon: "Capture" and "Capture and edit" (each with Area, Visible part, Full page and Element), "Open the library" and "Settings". |

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
- The policy's contact is support@kodetix.fr, the e-mail address of the store account.

## 9. Visuals to produce

| Visual | Size | Status |
|---|---|---|
| Store icon | 128x128 PNG, 96x96 drawing + 16 px margin | Done: `icons/icon128.png` (generated by `scripts/make-icons.mjs`) |
| Screenshots | 1280x800 or 640x400, 1 minimum, 5 at most, square corners, no margin | Done for 0.3.0: the five of the list below, made by a script that is not in the repository (`dist/store-0.3.0/`) |
| Small tile | 440x280 | Done: marked as required by the documentation (`dist/store-0.3.0/tile-440x280.png`). `docs/logo.png` (512 px) is the same drawing as the icon |
| Marquee | 1400x560 | Optional, made (`dist/store-0.3.0/marquee-1400x560.png`) |

Screenshots to produce, on made-up pages and data (no real capture, no personal data), one theme each unless said:

1. The editor with the tools of 0.3 on one capture: a pen stroke, a double arrow, an emoji, numbered markers and the stamp, with the floating style bar, the versions and the strip of captures visible.
2. Beautify: a capture on a gradient with padding, shadow and window bar, its panel open.
3. Hide sensitive text: the element capture of a made-up dashboard, open in the editor, with the customer e-mail addresses covered in black.
4. The history sheet in the dark theme: grid, search, filters, a few pinned captures, a selection with its action bar.
5. The Download menu open: formats, size, quality with the size estimate, the PDF options.

The dashboard takes five screenshots at most. Any other image has another place: the small tile (440x280, required), the marquee (1400x560, optional), and the README and the social preview of GitHub (`docs/social-preview.png`), where the area selection, the element picking and the page that follows a capture can go. The area selection and the settings of the 2026-10 list are dropped, and the dark theme moves to the fourth shot.

## 10. Submission steps

The item exists: the developer account was created, and the first version went through "Add new item" on 2026-11-01. A release is an update of that item:

1. `npm run package`: builds `dist/obturo-<version>.zip` (checks built in).
2. Dashboard, Package tab: upload the zip.
3. Store Listing tab: description (section 4) and visuals (section 9), when they changed.
4. Privacy tab: single purpose (6), permission justifications (7), remote code (no), disclosure (8), policy URL, when they changed. The page behind the policy URL must show the current `docs/PRIVACY.md` before the submission.
5. Test instructions tab (text below), when the first use changed.
6. "Submit for review". Choose deferred publication to decide the moment once the review is over.
7. Once the version is published, tag the merge commit of the release `vX.Y.Z` (CONTRIBUTING.md).

Test instructions to enter (the field takes 500 characters at most; this text has 412): "No account needed. Open any web page, press Alt+Shift+Z (or click the Obturo icon) and drag a rectangle: a page opens with the capture and three buttons (Edit and annotate, Copy to the clipboard, Download as). Alt+Shift+L opens the history. Right-click the icon for the element and full-page captures and the Settings. Chrome pages (chrome://) and the Web Store cannot be captured. Nothing is sent to any server."

## 11. "Performance" checklist before submission

- [x] **Package size** (checked on 2026-11-09, on the release commit of 0.3.0): `npm run package` builds a zip of 156 files, 1268.6 KB raw and 443.6 KB zipped (454,271 bytes, against 432,903 for 0.2.1), and prints no warning about a heavy file (the warning is for any file over 500 KB outside `vendor/`). The only big piece is `vendor/` (Fabric.js, 316,082 bytes minified).
- [x] **No useless file**: the list printed by the script holds no test, no `.md` or other doc, no script, no hidden file. Only the licenses travel: `LICENSE` at the root and `vendor/fabric.LICENSE`.
- [x] **No remote code** (checked on 2026-11-09 on the 0.3.0 package): outside `vendor/` and the tests, the only `http` addresses in the files of the extension are the SVG namespace in `dom-i18n.js` (an identifier, never requested), the links of the About section, the popup and the library (`about-pure.js`, `library.html`), which open in a new tab on a click and are never requested by the extension, and the made-up address `https://obturo/` in `export-pure.js`, whose host names the grouped export file (never requested); no `eval`, no `new Function`, no `import()` of a remote address, no `<script src="http...">` (the editor and the export code are loaded by an `import()` of a file of the package, which is intended), no `fetch`, `XMLHttpRequest` or `WebSocket`. In `vendor/fabric.min.mjs`, only XML namespace strings (`http://www.w3.org/...`) were found on 2026-10-01; redo this check at each update of the library.
- [x] **Service worker imports**: `sw.js` imports `db.js`, `pure.js`, `fullpage-pure.js`, `gestures.js`, `i18n.js`, `settings.js`, `notice.js` and `about.js` (and what those import: `retention.js`, `catalog.js`, the dictionaries of `locales/`), and no import of `vendor/` appears there (Fabric loads only in the library page).
- [ ] **Service worker start**: measure it, chrome://extensions, "Service Worker", then the Performance tab of DevTools, cold start; proposed target: a few tens of milliseconds. At load time `sw.js` holds constants and listeners and starts the rebuild of the icon menu, which runs off the capture path.
- [ ] **Memory**: library open with 12 captures, Chrome Task Manager (Shift+Esc); check that a full-page capture does not blow up the service worker (measured peak: about 400 MB with 1080p tiles, about 680 MB with 4K tiles, released at the end).
- [x] **Promise / code consistency**: the policy announces deletion from the library, and it exists in four places: the "x" button of each capture in the strip, the deletion of a selection in the history sheet, "Purge now" and "Delete everything" in the settings. The retention defaults in the policy (30 days, 2 GB, pinned and edited captures kept) are the ones of `settings.js`.

## 12. Price

Obturo is free of charge.
