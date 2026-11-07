# Obturo - Privacy policy

Last updated: 2026-11-04

This policy is in English, then in French (below). Both say the same thing.

## Summary

**No data ever leaves your computer.** Obturo has no server, no account, no telemetry, no usage analytics, no advertising, and runs no downloaded code. Everything stays in your browser, on your device.

## What the extension does

When you ask for it (icon click, keyboard shortcut or menu), Obturo captures the active tab and keeps the result locally in a history that you can search, clean up and export. It then asks what to do with the capture: edit and annotate it, copy it to the clipboard or download it. A setting makes it copy the capture straight away instead.

## Data handled

For each capture, Obturo stores:

- the captured image, as it was taken (the original);
- the versions you make of it: annotations, crop and scale, kept as data and not as images;
- a small thumbnail of the version on display;
- the address (URL) and title of the captured page, the name of its site, and the capture date and size;
- whether you pinned the capture;
- an entry in an internal index (date, size, whether it is pinned or edited, the name of the site, and the title and address in lower case) used for the search and for the cleanup.

A screenshot may contain personal or confidential information visible on the page. It is handled like everything else: locally, never sent anywhere.

An image you add yourself (a file you pick, an image you paste with Ctrl+V or drop on the library) is stored the same way, as a PNG, with the name of the file as its title (*Pasted image* for a paste) and no address.

Obturo also stores your settings: language, theme, how long to keep captures, the size limit, and the default download format and options. Three technical records go with them: a copy of the language and the theme (so that the library opens in the right ones), the list of the captures that the open library holds (so that the cleanup does not remove them), and two bare facts about Obturo itself: the last version whose news you have read, and how many captures were kept in the history (a number, nothing about them), which decides when the one request for a review is shown. Neither leaves your computer.

Obturo does not read page content beyond the captured image, the address and the title, except when you turn on *Hide sensitive text* in the settings: it then reads the text of the page, inside the page, to find what to cover while the image is taken, and keeps none of it and sends none of it. It reads the clipboard only at the moment you paste into the library (Ctrl+V), and then only an image, never text; otherwise it only writes the image you have just captured, when you ask for it or when the setting that copies straight away is on. It sets no cookie and has no identifier of you or of your device.

## Where and for how long

- Data is stored in the browser's local storage for the extension (IndexedDB, and a small copy of the language and the theme in `localStorage`), on your computer, private to the extension and to your profile. It is stored as is, not encrypted: anyone who has access to your browser profile can read it.
- **No trace.** A switch in the popup and in the settings: while it is on, a capture is copied to the clipboard and saved nowhere (not in the history, no file), and the icon turns violet so that you know (the library shows it too). Importing or pasting an image is refused while it is on. Turning it off brings the history back; the captures already kept stay.
- **How long is up to you.** By default, captures older than 30 days are deleted automatically and the history is kept under 2 GB. In the settings you can keep captures for 7 days, 30 days, 90 days, 1 year or forever, and set the size limit to 500 MB, 1 GB, 2 GB, 5 GB, 10 GB or none.
  - A capture you pin is never deleted automatically.
  - A capture you have edited is not deleted because of its age; it can be deleted, after the unedited ones, if the size limit needs the room.
  - The capture open in the library is never deleted while it is open.
  - The cleanup runs when a capture is added and when the library opens. If the settings cannot be read, nothing is deleted.
- **Deleting everything yourself**: delete a capture with its delete button, or select several captures in the history and delete them; use *Purge now* in the settings to remove captures by age or by size, after a preview; or use *Delete everything* in the settings to erase the whole history and, with it, every pinned and edited capture.
- Uninstalling the extension deletes all of its data.

## Files you save

When you download a capture or a grouped export (PNG, JPEG, WebP, PDF or ZIP), the browser writes the file to your downloads folder, like any download. By default the name holds the name of the site and the date of the capture, never the title of the page; the title is only part of it if you write `{title}` in the *File name* setting. What you copy to the clipboard or save to disk is then outside Obturo: it is your responsibility.

## Sharing

None. Obturo does not send, sell, share or transfer any data to anyone.

## Permissions used

- `activeTab`: capture the active tab, only after an action from you.
- `scripting`: show the area selection, scroll the page for a full-page capture, write the image to the clipboard, show a short note on the page (that the capture was copied, or that a full-page capture is not the whole page or stopped), and, when *Hide sensitive text* is on, cover the sensitive text of the page while the image is taken, from the active tab.
- `contextMenus`: the icon's right-click menu: Capture and Capture and edit (each with Area, Visible part and Full page), Open the library, and Settings.

Obturo requests no broad access to websites. It does not use `unlimitedStorage`.

## Check it yourself

"No data leaves your computer" is enforced by the browser, not only promised.

- **The policy.** `manifest.json` carries a content security policy for the pages of the extension and for its service worker: no `connect-src` (no fetch, XHR, WebSocket, EventSource or beacon), images only from the extension, and no remote script, stylesheet, font, frame or form target.
- **The proof.** `test/e2e/privacy.e2e.mjs` tries every one of those channels from the library, from the popup and from the service worker, against a local server, and fails if the server receives a single request. The same attempts from an ordinary web page do reach that server, so the test cannot pass by accident. `manifest.test.js` also fails if the code gains a network API, a remote address, a frame or a resource hint.
- **By hand.** Open the library, press F12 and watch the Network tab while you capture, edit and export: it should list only `chrome-extension://`, `data:` and `blob:` addresses.
- **What a policy cannot stop.** For `<link rel="preconnect">` and for the navigation of a frame, the browser opens a bare connection to the host before it checks any policy (the frame is then blocked, and no request follows). Obturo's code has neither, and a test fails if it gains one. The pages you capture follow their own policies, not Obturo's; the scripts Obturo injects into them (area selection, scrolling, clipboard) are covered by the same code check.
- **A few links.** *Settings* has a *Support Kodetix* link, and an *About* section with links to the reviews of Obturo on the Chrome Web Store, to its issues on GitHub and to Oblitero, another free extension of the same publisher; the popup can show the same two first ones in a request for a review, shown after 15 captures kept and at most twice, and never again once you answered. They are ordinary links that open in a new tab when you click them: Obturo sends nothing, and nothing is loaded before the click. A test allows these addresses in the code, and no other.

## Changes

Any change to this policy will be dated above. Obturo will remain local: a change that would send data off the device would be announced before it ships.

## Contact

Questions about this policy: support@kodetix.fr.

---

# Obturo - Politique de confidentialité

Dernière mise à jour : 2026-11-04

## Résumé

**Aucune donnée ne quitte ton ordinateur.** Obturo n'a pas de serveur, pas de compte, pas de télémétrie, pas de statistiques d'usage, pas de publicité et n'exécute aucun code téléchargé. Tout reste dans ton navigateur, sur ton appareil.

## Ce que fait l'extension

Quand tu le demandes (clic sur l'icône, raccourci clavier ou menu), Obturo capture l'onglet actif et garde le résultat localement dans un historique que tu peux parcourir, nettoyer et exporter. Il te demande ensuite quoi faire de la capture : l'éditer et l'annoter, la copier dans le presse-papiers ou la télécharger. Un réglage permet de la copier directement à la place.

## Données traitées

Pour chaque capture, Obturo enregistre :

- l'image capturée, telle qu'elle a été prise (l'original) ;
- les versions que tu en fais : annotations, recadrage et échelle, gardés sous forme de données et non d'images ;
- une petite vignette de la version affichée ;
- l'adresse (URL) et le titre de la page capturée, le nom de son site, ainsi que la date et la taille de la capture ;
- le fait que tu l'aies épinglée ou non ;
- une entrée dans un index interne (date, taille, épinglée ou éditée, nom du site, titre et adresse en minuscules) utilisé pour la recherche et pour le nettoyage.

Une capture d'écran peut contenir des informations personnelles ou confidentielles visibles dans la page. Elles sont traitées exactement comme le reste : localement, sans aucun envoi.

Une image que tu ajoutes toi-même (un fichier que tu choisis, une image que tu colles avec Ctrl+V ou que tu déposes sur la bibliothèque) est stockée de la même façon, en PNG, avec le nom du fichier pour titre (*Image collée* pour un collage) et sans adresse.

Obturo enregistre aussi tes paramètres : langue, thème, durée de conservation des captures, limite de taille, format et options de téléchargement par défaut. Trois enregistrements techniques les accompagnent : une copie de la langue et du thème (pour que la bibliothèque s'ouvre dans les bons), la liste des captures que la bibliothèque ouverte tient (pour que le nettoyage ne les supprime pas), et deux faits tout simples sur Obturo lui-même : la dernière version dont tu as lu les nouveautés, et le nombre de captures gardées dans l'historique (un nombre, rien sur elles), qui décide du moment où la demande d'avis unique est affichée. Ni l'un ni l'autre ne quitte ton ordinateur.

Obturo ne lit pas le contenu des pages en dehors de l'image capturée, de l'adresse et du titre, sauf si tu actives *Masquer le texte sensible* dans les paramètres : il lit alors le texte de la page, dans la page, pour trouver ce qu'il faut recouvrir pendant la prise de l'image, et n'en garde rien et n'en envoie rien. Il ne lit le presse-papiers qu'au moment où tu colles dans la bibliothèque (Ctrl+V), et alors seulement une image, jamais du texte ; sinon il y écrit seulement l'image que tu viens de capturer, quand tu le demandes ou quand le réglage qui copie directement est actif. Il ne dépose aucun cookie et n'a aucun identifiant de toi ni de ton appareil.

## Où et combien de temps

- Les données sont stockées dans l'espace de stockage local de l'extension dans le navigateur (IndexedDB, et une petite copie de la langue et du thème dans `localStorage`), sur ton ordinateur, propre à l'extension et à ton profil. Elles sont stockées telles quelles, non chiffrées : toute personne qui a accès à ton profil de navigateur peut les lire.
- **Sans trace.** Un interrupteur dans le popup et dans les paramètres : tant qu'il est actif, une capture est copiée dans le presse-papiers et enregistrée nulle part (ni dans l'historique, ni en fichier), et l'icône devient violette pour que tu le saches. Le désactiver rend l'historique ; les captures déjà gardées restent.
- **La durée dépend de toi.** Par défaut, les captures de plus de 30 jours sont supprimées automatiquement et l'historique reste sous 2 Go. Dans les paramètres, tu peux garder les captures 7 jours, 30 jours, 90 jours, 1 an ou sans limite de durée, et fixer la limite de taille à 500 Mo, 1 Go, 2 Go, 5 Go, 10 Go ou sans limite.
  - Une capture que tu épingles n'est jamais supprimée automatiquement.
  - Une capture que tu as éditée n'est pas supprimée à cause de son âge ; elle peut l'être, après celles qui n'ont pas été éditées, si la limite de taille a besoin de la place.
  - La capture ouverte dans la bibliothèque n'est jamais supprimée tant qu'elle est ouverte.
  - Le nettoyage s'exécute quand une capture est ajoutée et quand la bibliothèque s'ouvre. Si les paramètres sont illisibles, rien n'est supprimé.
- **Tout supprimer toi-même** : supprime une capture avec son bouton de suppression, ou sélectionne plusieurs captures dans l'historique pour les supprimer ; utilise *Purger maintenant* dans les paramètres pour retirer des captures par âge ou par taille, après un aperçu ; ou utilise *Tout supprimer* dans les paramètres pour effacer tout l'historique, captures épinglées et éditées comprises.
- Désinstaller l'extension supprime toutes ses données.

## Fichiers que tu enregistres

Quand tu télécharges une capture ou un export groupé (PNG, JPEG, WebP, PDF ou ZIP), le navigateur écrit le fichier dans ton dossier de téléchargements, comme tout téléchargement. Par défaut, le nom contient le nom du site et la date de la capture, jamais le titre de la page ; le titre n'y figure que si tu écris `{title}` dans le réglage *Nom du fichier*. Ce que tu copies dans le presse-papiers ou enregistres sur ton disque sort ensuite d'Obturo : cela relève de ta responsabilité.

## Partage

Aucun. Obturo n'envoie, ne vend, ne partage ni ne transfère aucune donnée à qui que ce soit.

## Permissions utilisées

- `activeTab` : capturer l'onglet actif, uniquement après une action de ta part.
- `scripting` : afficher la sélection de zone, faire défiler la page pour une capture de la page entière, écrire l'image dans le presse-papiers, afficher une courte note sur la page quand une capture de la page entière n'est pas la page complète ou s'est arrêtée, et, quand *Masquer le texte sensible* est actif, recouvrir le texte sensible de la page pendant la prise de l'image, depuis l'onglet actif.
- `contextMenus` : le menu du clic droit sur l'icône : Capturer et Capturer et éditer (chacun avec Zone, Partie visible et Page entière), Ouvrir la bibliothèque, et Paramètres.

Obturo ne demande aucun accès général aux sites web. Il n'utilise pas `unlimitedStorage`.

## Vérifie par toi-même

« Aucune donnée ne quitte ton ordinateur » est imposé par le navigateur, pas seulement promis.

- **La politique.** `manifest.json` porte une politique de sécurité du contenu pour les pages de l'extension et pour son service worker : pas de `connect-src` (ni fetch, ni XHR, ni WebSocket, ni EventSource, ni balise de suivi), des images uniquement de l'extension, et aucun script, feuille de style, police, cadre ou cible de formulaire distant.
- **La preuve.** `test/e2e/privacy.e2e.mjs` essaie chacun de ces canaux depuis la bibliothèque, depuis le popup et depuis le service worker, face à un serveur local, et échoue si ce serveur reçoit une seule requête. Les mêmes essais depuis une page web ordinaire l'atteignent bien, donc le test ne peut pas réussir par hasard. `manifest.test.js` échoue aussi si le code gagne une API réseau, une adresse distante, un cadre ou une indication de ressource.
- **À la main.** Ouvre la bibliothèque, appuie sur F12 et regarde l'onglet Réseau pendant que tu captures, édites et exportes : il ne devrait lister que des adresses `chrome-extension://`, `data:` et `blob:`.
- **Ce qu'une politique ne peut pas arrêter.** Pour `<link rel="preconnect">` et pour la navigation d'un cadre, le navigateur ouvre une connexion nue vers l'hôte avant de vérifier la moindre politique (le cadre est ensuite bloqué, et aucune requête ne suit). Le code d'Obturo n'a ni l'un ni l'autre, et un test échoue s'il en gagne un. Les pages que tu captures suivent leurs propres politiques, pas celle d'Obturo ; les scripts qu'Obturo y injecte (sélection de zone, défilement, presse-papiers) sont couverts par la même vérification du code.
- **Quelques liens.** Les *Paramètres* ont un lien *Soutenir Kodetix*, et une section *À propos* avec des liens vers les avis d'Obturo sur le Chrome Web Store, vers ses tickets sur GitHub et vers Oblitero, une autre extension gratuite du même éditeur ; le popup peut montrer les deux premiers dans une demande d'avis, affichée après 15 captures gardées et deux fois au plus, et plus jamais une fois que tu as répondu. Ce sont de simples liens qui s'ouvrent dans un nouvel onglet quand tu cliques : Obturo n'envoie rien, et rien n'est chargé avant le clic. Un test autorise ces adresses dans le code, et aucune autre.

## Modifications

Toute modification de cette politique sera datée ci-dessus. Obturo restera local : un changement qui enverrait des données hors de l'appareil serait signalé avant sa mise en service.

## Contact

Une question sur cette politique : support@kodetix.fr.
