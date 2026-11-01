// Brazilian Portuguese texts of the service worker: menu entries and the like (keys 'menu.*', 'sw.*').
/** @type {Record<string, string>} */
export default {
  'sw.actionTitle': 'Obturo', // tooltip of the icon; the same text as "actionTitle" in _locales/pt_BR/messages.json
  'menu.capture': 'Capturar',
  'menu.captureEdit': 'Capturar e editar',
  'menu.area': 'Área',
  'menu.visible': 'Parte visível',
  'menu.full': 'Página inteira',
  'menu.element': 'Elemento',
  'menu.library': 'Abrir a biblioteca',
  'menu.settings': 'Configurações',
  // the no-trace mode: a capture is copied and saved nowhere
  'sw.noTrace.title': 'sem rastro', // after the name in the tooltip of the icon, while the mode is on
  'sw.noTrace.edit': 'O modo sem rastro está ativo: nada é salvo, então não há nada para editar. Desative-o no popup do Obturo para editar uma captura.',
  'sw.noTrace.copyFailed': 'Sem rastro: a cópia falhou e nada foi salvo. Tente de novo.',
  // what a full-page capture tells the user on the page (notice.js): what the image is not, or why the capture stopped
  'sw.full.cut': 'A página é mais longa do que uma captura comporta: a imagem para no ponto alcançado.',
  'sw.full.scaled': 'A imagem foi reduzida para {n}% para caber nos limites de uma captura.',
  'sw.full.frame': 'O conteúdo está em um frame, que o Obturo não consegue rolar: só a parte visível foi capturada.',
  'sw.full.fail.resized': 'Página inteira interrompida: a janela mudou de tamanho durante a captura. Nada foi salvo. Tente de novo sem mexer na janela.',
  'sw.full.fail.moved': 'Página inteira interrompida: a área capturada se moveu durante a rolagem. Nada foi salvo.',
  'sw.full.fail.tab': 'Página inteira interrompida: outra aba ou janela recebeu o foco durante a captura. Nada foi salvo.',
  'sw.full.fail.page': 'Página inteira interrompida: a página mudou ou parou de responder durante a captura. Nada foi salvo.',
  'sw.full.fail.other': 'A captura de página inteira falhou. Nada foi salvo. Tente de novo.',
};
