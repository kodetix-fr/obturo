// Spanish texts of the service worker: menu entries and the like (keys 'menu.*', 'sw.*').
/** @type {Record<string, string>} */
export default {
  'sw.actionTitle': 'Obturo', // tooltip of the icon; the same text as "actionTitle" in _locales/es/messages.json
  'menu.capture': 'Capturar',
  'menu.captureEdit': 'Capturar y editar',
  'menu.area': 'Zona',
  'menu.visible': 'Parte visible',
  'menu.full': 'Página completa',
  'menu.element': 'Elemento',
  'menu.library': 'Abrir la biblioteca',
  'menu.settings': 'Configuración',
  // the no-trace mode: a capture is copied and saved nowhere
  'sw.noTrace.title': 'sin rastro', // after the name in the tooltip of the icon, while the mode is on
  'sw.noTrace.edit': 'El modo sin rastro está activo: no se guarda nada, así que no hay nada que editar. Desactívalo en el popup de Obturo para editar una captura.',
  'sw.noTrace.copyFailed': 'Sin rastro: la copia falló y no se guardó nada. Inténtalo de nuevo.',
  // what a full-page capture tells the user on the page (notice.js): what the image is not, or why the capture stopped
  'sw.full.cut': 'La página es más larga de lo que cabe en una captura: la imagen se detiene en el punto alcanzado.',
  'sw.full.scaled': 'La imagen se redujo al {n}\u00A0% para ajustarse a los límites de una captura.',
  'sw.full.frame': 'El contenido está en un marco que Obturo no puede desplazar: solo se capturó la parte visible.',
  'sw.full.fail.resized': 'Página completa interrumpida: la ventana cambió de tamaño durante la captura. No se guardó nada. Inténtalo de nuevo sin tocar la ventana.',
  'sw.full.fail.moved': 'Página completa interrumpida: la zona capturada se movió mientras se desplazaba. No se guardó nada.',
  'sw.full.fail.tab': 'Página completa interrumpida: otra pestaña o ventana pasó al primer plano durante la captura. No se guardó nada.',
  'sw.full.fail.page': 'Página completa interrumpida: la página cambió o dejó de responder durante la captura. No se guardó nada.',
  'sw.full.fail.other': 'La captura de página completa falló. No se guardó nada. Inténtalo de nuevo.',
  // what a capture says on the page when the sensitive text was hidden (redact.js)
  'sw.redact.one': '{n} elemento sensible tapado en el texto de la página. Los campos de formulario, las imágenes y los marcos no se tapan: revisa la imagen antes de compartir.',
  'sw.redact.other': '{n} elementos sensibles tapados en el texto de la página. Los campos de formulario, las imágenes y los marcos no se tapan: revisa la imagen antes de compartir.',
  'sw.redact.none': 'No se encontró ninguna dirección de correo, número de teléfono, IBAN, número de tarjeta ni clave en el texto de la página. Los campos de formulario, las imágenes y los marcos no se tapan: revisa la imagen antes de compartir.',
  'sw.redact.partial': 'La página es demasiado grande para revisarla entera: puede quedar texto visible.',
};
