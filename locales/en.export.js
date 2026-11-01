// English texts of the downloads: the Download button and its format menu ('act.download*', 'dl.*'), the grouped
// export ('export.*') and the Download section of the settings ('settings.download*').
// i18n.test.js checks the pair with fr.export.js and that every key is used by export-ui.js, library.html or settings-ui.js.
/** @type {Record<string, string>} */
export default {
  // the Download button of the editor
  'act.download': 'Download',
  'act.download.tip': 'Download the displayed version in the chosen format',
  'dl.group': 'Download',
  'dl.options': 'Download options',
  'dl.busy': 'Exporting…',

  // its menu
  'dl.format': 'Format',
  'dl.hint.png': 'Lossless, sharp text',
  'dl.hint.jpeg': 'Small files, for photographs',
  'dl.hint.webp': 'Small files, text stays sharp',
  'dl.hint.pdf': 'A document',
  'dl.quality': 'Quality',
  'dl.quality.value': '{n}%',
  'dl.estimate': 'Estimated size',
  'dl.estimate.idle': '(move the slider)',
  'dl.estimate.value': '{size}',
  'dl.estimate.approx': '~ {size}', // extrapolated from a band of a big image
  'dl.estimate.busy': 'Estimating…',
  'dl.estimate.none': 'too large to estimate',
  'dl.layout': 'Pages',
  'dl.layout.fit': 'Fit to image',
  'dl.layout.paper': 'A4',
  'dl.encoding': 'Images',
  'dl.encoding.flate': 'Lossless',
  'dl.encoding.jpeg': 'Light (JPEG)',
  'dl.go': 'Download {format}',

  // a single export that fails (the banner; too large for the browser is 'msg.exportFailed')
  'export.err.encoder': "Export failed: your browser can't create this format. Choose PNG.",
  'export.err.unreadable': "Export failed: the image of this capture can't be read. Open it again.",
  'export.err.generic': 'Export failed. Try another format, or reduce the scale or crop.',

  // the grouped export
  'export.bulk': 'Export…',
  'export.bulk.tip': 'Export the selected captures as a single file',
  'export.title': 'Export captures',
  'export.count.one': '1 capture selected',
  'export.count.other': '{n} captures selected',
  'export.output': 'Output',
  'export.output.zip': 'ZIP of images',
  'export.output.pdf': 'Multipage PDF',
  'export.format': 'Image format',
  'export.version': 'Each capture is exported as it is displayed: its active version, edited or not.',
  'export.asShown.one': '1 edited capture is set to Original: it is exported as displayed, without its changes.',
  'export.asShown.other': '{n} edited captures are set to Original: they are exported as displayed, without their changes.',
  'export.limit': 'An export takes {max} captures at most. Select fewer.',
  'export.start': 'Export',
  'export.cancel': 'Cancel',
  'export.progress': 'Exporting capture {done} of {total}…',
  'export.canceled': 'Export canceled. Nothing was downloaded.',
  'export.done': 'Captures exported: {done} of {total}. The file is downloading.',
  'export.none': 'Nothing could be exported (0 of {total}).',
  'export.failed': 'The file could not be built.',
  'export.cause.gone': 'the capture no longer exists',
  'export.cause.limit': 'the size limit of an export was reached',
  'export.cause.tooLarge': 'too large for the browser',
  'export.cause.encoder': "the browser can't create this format",
  'export.cause.unreadable': "the image can't be read",
  'export.cause.other': 'unexpected error',

  // settings
  'settings.download': 'Download',
  'settings.download.format': 'Default format',
  'settings.download.quality': 'Quality',
  'settings.download.quality.hint': 'JPEG, WebP, light PDF',
  'settings.download.layout': 'PDF pages',
  'settings.download.encoding': 'PDF images',
  'settings.download.name': 'File name',
  'settings.download.name.hint': 'Words in braces are replaced: {host} the site, {title} the page title, {date} and {time} of the capture. The title is only used if you write it here.',
};
