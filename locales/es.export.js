// Spanish texts of the downloads: the Download button and its format menu ('act.download*', 'dl.*'), the grouped
// export ('export.*') and the Download section of the settings ('settings.download*').
// i18n.test.js checks the pair with en.export.js and that every key is used by export-ui.js, library.html or settings-ui.js.
/** @type {Record<string, string>} */
export default {
  // the Download button of the editor
  'act.download': 'Descargar',
  'act.download.tip': 'Descargar la versión mostrada en el formato elegido',
  'dl.group': 'Descarga',
  'dl.options': 'Opciones de descarga',
  'dl.busy': 'Exportando…',

  // its menu
  'dl.format': 'Formato',
  'dl.hint.png': 'Sin pérdida, texto nítido',
  'dl.hint.jpeg': 'Archivos pequeños, para fotografías',
  'dl.hint.webp': 'Archivos pequeños, texto nítido',
  'dl.hint.pdf': 'Un documento',
  'dl.quality': 'Calidad',
  'dl.quality.value': '{n}\u00A0%',
  'dl.estimate': 'Tamaño estimado',
  'dl.estimate.idle': '(mueve el deslizador)',
  'dl.estimate.value': '{size}',
  'dl.estimate.approx': '~ {size}', // extrapolated from a band of a big image
  'dl.estimate.busy': 'Estimando…',
  'dl.estimate.none': 'demasiado grande para estimar',
  'dl.layout': 'Páginas',
  'dl.layout.fit': 'Ajustar a la imagen',
  'dl.layout.paper': 'A4',
  'dl.encoding': 'Imágenes',
  'dl.encoding.flate': 'Sin pérdida',
  'dl.encoding.jpeg': 'Ligero (JPEG)',
  'dl.go': 'Descargar {format}',

  // a single export that fails (the banner; too large for the browser is 'msg.exportFailed')
  'export.err.encoder': 'No se pudo exportar: tu navegador no puede generar este formato. Elige PNG.',
  'export.err.unreadable': 'No se pudo exportar: la imagen de esta captura no se puede leer. Ábrela de nuevo.',
  'export.err.generic': 'No se pudo exportar. Prueba otro formato, o reduce la escala o recorta.',

  // the grouped export
  'export.bulk': 'Exportar…',
  'export.bulk.tip': 'Exportar las capturas seleccionadas en un solo archivo',
  'export.title': 'Exportar capturas',
  'export.count.one': '1 captura seleccionada',
  'export.count.other': '{n} capturas seleccionadas',
  'export.output': 'Salida',
  'export.output.zip': 'ZIP de imágenes',
  'export.output.pdf': 'PDF de varias páginas',
  'export.format': 'Formato de imagen',
  'export.version': 'Cada captura se exporta tal como se muestra: su versión activa, editada o no.',
  'export.asShown.one': '1 captura editada está en Original: se exporta tal como se muestra, sin sus cambios.',
  'export.asShown.other': '{n} capturas editadas están en Original: se exportan tal como se muestran, sin sus cambios.',
  'export.limit': 'Una exportación admite {max} capturas como máximo. Selecciona menos.',
  'export.start': 'Exportar',
  'export.cancel': 'Cancelar',
  'export.progress': 'Exportando captura {done} de {total}…',
  'export.canceled': 'Exportación cancelada. No se descargó nada.',
  'export.done': 'Capturas exportadas: {done} de {total}. El archivo se está descargando.',
  'export.none': 'No se pudo exportar nada (0 de {total}).',
  'export.failed': 'No se pudo crear el archivo.',
  'export.cause.gone': 'la captura ya no existe',
  'export.cause.limit': 'se alcanzó el límite de tamaño de una exportación',
  'export.cause.tooLarge': 'demasiado grande para el navegador',
  'export.cause.encoder': 'el navegador no puede generar este formato',
  'export.cause.unreadable': 'la imagen no se puede leer',
  'export.cause.other': 'error inesperado',

  // settings
  'settings.download': 'Descarga',
  'settings.download.format': 'Formato predeterminado',
  'settings.download.quality': 'Calidad',
  'settings.download.quality.hint': 'JPEG, WebP, PDF ligero',
  'settings.download.layout': 'Páginas del PDF',
  'settings.download.encoding': 'Imágenes del PDF',
  'settings.download.name': 'Nombre de archivo',
  'settings.download.name.hint': 'Las palabras entre llaves se sustituyen: {host} el sitio, {title} el título de la página, {date} y {time} de la captura. El título solo se usa si lo escribes aquí.',
};
