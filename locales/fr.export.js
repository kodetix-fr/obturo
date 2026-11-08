// Textes français des téléchargements : le bouton Télécharger et son menu de formats ('act.download*', 'dl.*'),
// l'export groupé ('export.*') et la section Téléchargement des paramètres ('settings.download*').
// i18n.test.js vérifie la paire avec en.export.js et que chaque clé est utilisée par export-ui.js, library.html ou settings-ui.js.
/** @type {Record<string, string>} */
export default {
  // le bouton Télécharger de l'éditeur
  'act.download': 'Télécharger',
  'act.download.tip': 'Télécharger la version affichée dans le format choisi',
  'dl.group': 'Téléchargement',
  'dl.options': 'Options de téléchargement',
  'dl.busy': 'Export en cours…',

  // son menu
  'dl.format': 'Format',
  'dl.size': 'Taille',
  'dl.hint.png': 'Sans perte, texte net',
  'dl.hint.jpeg': 'Fichiers légers, pour les photos',
  'dl.hint.webp': 'Fichiers légers, texte net',
  'dl.hint.pdf': 'Un document',
  'dl.quality': 'Qualité',
  'dl.quality.value': '{n}\u00a0%',
  'dl.estimate': 'Taille estimée',
  'dl.estimate.idle': '(déplace le curseur)',
  'dl.estimate.value': '{size}',
  'dl.estimate.approx': '~ {size}', // extrapolée à partir d'une bande d'une grande image
  'dl.estimate.busy': 'Estimation…',
  'dl.estimate.none': 'trop grande pour être estimée',
  'dl.layout': 'Pages',
  'dl.layout.fit': "Ajustées à l'image",
  'dl.layout.paper': 'A4',
  'dl.encoding': 'Images',
  'dl.encoding.flate': 'Sans perte',
  'dl.encoding.jpeg': 'Légères (JPEG)',
  'dl.go': 'Télécharger en {format}',

  // un export seul qui échoue (le bandeau ; trop grand pour le navigateur est 'msg.exportFailed')
  'export.err.encoder': 'Export impossible\u00a0: ton navigateur ne prend pas en charge ce format. Choisis PNG.',
  'export.err.unreadable': "Export impossible\u00a0: l'image de cette capture est illisible. Rouvre-la.",
  'export.err.generic': "Export impossible. Essaie un autre format, ou réduis l'échelle ou recadre.",

  // l'export groupé
  'export.bulk': 'Exporter…',
  'export.bulk.tip': 'Exporter les captures sélectionnées en un seul fichier',
  'export.title': 'Exporter des captures',
  'export.count.one': '1 capture sélectionnée',
  'export.count.other': '{n} captures sélectionnées',
  'export.output': 'Sortie',
  'export.output.zip': "ZIP d'images",
  'export.output.pdf': 'PDF multipage',
  'export.format': 'Format des images',
  'export.version': "Chaque capture est exportée telle qu'elle est affichée\u00a0: sa version active, éditée ou non.",
  'export.asShown.one': "1 capture éditée est réglée sur Original\u00a0: elle est exportée telle qu'affichée, sans ses modifications.",
  'export.asShown.other': "{n} captures éditées sont réglées sur Original\u00a0: elles sont exportées telles qu'affichées, sans leurs modifications.",
  'export.limit': 'Un export prend {max} captures au maximum. Sélectionnes-en moins.',
  'export.start': 'Exporter',
  'export.cancel': 'Annuler',
  'export.progress': 'Export de la capture {done} sur {total}…',
  'export.canceled': "Export annulé. Rien n'a été téléchargé.",
  'export.done': 'Captures exportées\u00a0: {done} sur {total}. Le fichier se télécharge.',
  'export.none': "Aucune capture n'a pu être exportée (0 sur {total}).",
  'export.failed': "Le fichier n'a pas pu être créé.",
  'export.cause.gone': "la capture n'existe plus",
  'export.cause.limit': "la taille maximale d'un export est atteinte",
  'export.cause.tooLarge': 'trop grande pour le navigateur',
  'export.cause.encoder': 'le navigateur ne prend pas en charge ce format',
  'export.cause.unreadable': "l'image est illisible",
  'export.cause.other': 'erreur inattendue',

  // paramètres
  'settings.download': 'Téléchargement',
  'settings.download.format': 'Format par défaut',
  'settings.download.quality': 'Qualité',
  'settings.download.quality.hint': 'JPEG, WebP, PDF léger',
  'settings.download.layout': 'Pages du PDF',
  'settings.download.encoding': 'Images du PDF',
  'settings.download.name': 'Nom du fichier',
  'settings.download.name.hint': "Les mots entre accolades sont remplacés\u00a0: {host} le site, {title} le titre de la page, {date} et {time} de la capture. Le titre n'est utilisé que si tu l'écris ici.",
};
