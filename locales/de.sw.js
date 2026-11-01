// German texts of the service worker: menu entries and the like (keys 'menu.*', 'sw.*').
/** @type {Record<string, string>} */
export default {
  'sw.actionTitle': 'Obturo', // tooltip of the icon; the same text as "actionTitle" in _locales/de/messages.json
  'menu.capture': 'Aufnehmen',
  'menu.captureEdit': 'Aufnehmen und bearbeiten',
  'menu.area': 'Bereich',
  'menu.visible': 'Sichtbarer Ausschnitt',
  'menu.full': 'Ganze Seite',
  'menu.element': 'Element',
  'menu.library': 'Bibliothek öffnen',
  'menu.settings': 'Einstellungen',
  // the no-trace mode: a capture is copied and saved nowhere
  'sw.noTrace.title': 'spurlos', // after the name in the tooltip of the icon, while the mode is on
  'sw.noTrace.edit': '„Spurlos“ ist an: Es wird nichts gespeichert, also gibt es nichts zu bearbeiten. Schalte den Modus im Obturo-Popup aus, um eine Aufnahme zu bearbeiten.',
  'sw.noTrace.copyFailed': 'Spurlos: Das Kopieren ist fehlgeschlagen, und nichts wurde gespeichert. Versuche es noch einmal.',
  // what a full-page capture tells the user on the page (notice.js): what the image is not, or why the capture stopped
  'sw.full.cut': 'Die Seite ist länger, als eine Aufnahme fassen kann: Das Bild endet an der erreichten Stelle.',
  'sw.full.scaled': 'Das Bild wurde auf {n}\u00A0% verkleinert, um die Grenzen einer Aufnahme einzuhalten.',
  'sw.full.frame': 'Der Inhalt steckt in einem Frame, den Obturo nicht scrollen kann: Nur der sichtbare Ausschnitt wurde aufgenommen.',
  'sw.full.fail.resized': 'Ganze Seite abgebrochen: Das Fenster hat während der Aufnahme seine Größe geändert. Nichts wurde gespeichert. Versuche es noch einmal, ohne das Fenster zu verändern.',
  'sw.full.fail.moved': 'Ganze Seite abgebrochen: Der aufgenommene Bereich hat sich beim Scrollen verschoben. Nichts wurde gespeichert.',
  'sw.full.fail.tab': 'Ganze Seite abgebrochen: Ein anderer Tab oder ein anderes Fenster hat während der Aufnahme den Fokus übernommen. Nichts wurde gespeichert.',
  'sw.full.fail.page': 'Ganze Seite abgebrochen: Die Seite hat sich während der Aufnahme geändert oder nicht mehr geantwortet. Nichts wurde gespeichert.',
  'sw.full.fail.other': 'Ganze Seite fehlgeschlagen. Nichts wurde gespeichert. Versuche es noch einmal.',
  // what a capture says on the page when the sensitive text was hidden (redact.js)
  'sw.redact.one': '{n} sensibles Element in der Aufnahme ausgeblendet. Obturo kann etwas übersehen: Prüfe vor dem Teilen.',
  'sw.redact.other': '{n} sensible Elemente in der Aufnahme ausgeblendet. Obturo kann etwas übersehen: Prüfe vor dem Teilen.',
  'sw.redact.none': 'Im Text der Seite wurden keine E-Mail-Adresse, Telefonnummer, IBAN, Kartennummer und kein Schlüssel gefunden. Prüfe vor dem Teilen.',
  'sw.redact.partial': 'Die Seite ist zu groß, um vollständig durchsucht zu werden: Es kann noch Text sichtbar sein.',
};
