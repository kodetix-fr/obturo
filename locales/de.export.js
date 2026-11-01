// German texts of the downloads: the Download button and its format menu ('act.download*', 'dl.*'), the grouped
// export ('export.*') and the Download section of the settings ('settings.download*').
// i18n.test.js checks the pair with en.export.js and that every key is used by export-ui.js, library.html or settings-ui.js.
/** @type {Record<string, string>} */
export default {
  // the Download button of the editor
  'act.download': 'Herunterladen',
  'act.download.tip': 'Die angezeigte Version im gewählten Format herunterladen',
  'dl.group': 'Herunterladen',
  'dl.options': 'Download-Optionen',
  'dl.busy': 'Wird exportiert…',

  // its menu
  'dl.format': 'Format',
  'dl.hint.png': 'Verlustfrei, scharfer Text',
  'dl.hint.jpeg': 'Kleine Dateien, für Fotos',
  'dl.hint.webp': 'Kleine Dateien, Text bleibt scharf',
  'dl.hint.pdf': 'Ein Dokument',
  'dl.quality': 'Qualität',
  'dl.quality.value': '{n}\u00A0%',
  'dl.estimate': 'Geschätzte Größe',
  'dl.estimate.idle': '(Regler bewegen)',
  'dl.estimate.value': '{size}',
  'dl.estimate.approx': '~ {size}', // extrapolated from a band of a big image
  'dl.estimate.busy': 'Wird geschätzt…',
  'dl.estimate.none': 'zu groß zum Schätzen',
  'dl.layout': 'Seiten',
  'dl.layout.fit': 'Bildgröße',
  'dl.layout.paper': 'A4',
  'dl.encoding': 'Bilder',
  'dl.encoding.flate': 'Verlustfrei',
  'dl.encoding.jpeg': 'Leicht (JPEG)',
  'dl.go': '{format} herunterladen',

  // a single export that fails (the banner; too large for the browser is 'msg.exportFailed')
  'export.err.encoder': 'Export fehlgeschlagen: Dein Browser kann dieses Format nicht erzeugen. Wähle PNG.',
  'export.err.unreadable': 'Export fehlgeschlagen: Das Bild dieser Aufnahme kann nicht gelesen werden. Öffne sie noch einmal.',
  'export.err.generic': 'Export fehlgeschlagen. Versuche ein anderes Format, verringere die Skalierung oder schneide das Bild zu.',

  // the grouped export
  'export.bulk': 'Exportieren…',
  'export.bulk.tip': 'Die ausgewählten Aufnahmen als eine Datei exportieren',
  'export.title': 'Aufnahmen exportieren',
  'export.count.one': '1 Aufnahme ausgewählt',
  'export.count.other': '{n} Aufnahmen ausgewählt',
  'export.output': 'Ausgabe',
  'export.output.zip': 'ZIP mit Bildern',
  'export.output.pdf': 'Mehrseitiges PDF',
  'export.format': 'Bildformat',
  'export.version': 'Jede Aufnahme wird so exportiert, wie sie angezeigt wird: ihre aktive Version, bearbeitet oder nicht.',
  'export.asShown.one': '1 bearbeitete Aufnahme steht auf Original: Sie wird wie angezeigt exportiert, ohne ihre Änderungen.',
  'export.asShown.other': '{n} bearbeitete Aufnahmen stehen auf Original: Sie werden wie angezeigt exportiert, ohne ihre Änderungen.',
  'export.limit': 'Ein Export umfasst höchstens {max} Aufnahmen. Wähle weniger aus.',
  'export.start': 'Exportieren',
  'export.cancel': 'Abbrechen',
  'export.progress': 'Aufnahme {done} von {total} wird exportiert…',
  'export.canceled': 'Export abgebrochen. Nichts wurde heruntergeladen.',
  'export.done': 'Exportierte Aufnahmen: {done} von {total}. Die Datei wird heruntergeladen.',
  'export.none': 'Nichts konnte exportiert werden (0 von {total}).',
  'export.failed': 'Die Datei konnte nicht erstellt werden.',
  'export.cause.gone': 'die Aufnahme gibt es nicht mehr',
  'export.cause.limit': 'das Größenlimit eines Exports wurde erreicht',
  'export.cause.tooLarge': 'zu groß für den Browser',
  'export.cause.encoder': 'der Browser kann dieses Format nicht erzeugen',
  'export.cause.unreadable': 'das Bild kann nicht gelesen werden',
  'export.cause.other': 'unerwarteter Fehler',

  // settings
  'settings.download': 'Herunterladen',
  'settings.download.format': 'Standardformat',
  'settings.download.quality': 'Qualität',
  'settings.download.quality.hint': 'JPEG, WebP, leichtes PDF',
  'settings.download.layout': 'PDF-Seiten',
  'settings.download.encoding': 'PDF-Bilder',
  'settings.download.name': 'Dateiname',
  'settings.download.name.hint': 'Wörter in geschweiften Klammern werden ersetzt: {host} die Website, {title} der Seitentitel, {date} das Datum und {time} die Uhrzeit der Aufnahme. Der Titel wird nur verwendet, wenn du ihn hier einträgst.',
};
