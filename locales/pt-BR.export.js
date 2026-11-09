// Brazilian Portuguese texts of the downloads: the Download button and its format menu ('act.download*', 'dl.*'), the grouped
// export ('export.*') and the Download section of the settings ('settings.download*').
// i18n.test.js checks the pair with en.export.js and that every key is used by export-ui.js, library.html or settings-ui.js.
/** @type {Record<string, string>} */
export default {
  // the Download button of the editor
  'act.download': 'Baixar',
  'act.download.tip': 'Baixar a versão exibida no formato escolhido',
  'dl.group': 'Baixar',
  'dl.options': 'Opções de download',
  'dl.busy': 'Exportando…',

  // its menu
  'dl.format': 'Formato',
  'dl.size': 'Tamanho',
  'dl.hint.png': 'Sem perdas, texto nítido',
  'dl.hint.jpeg': 'Arquivos pequenos, para fotografias',
  'dl.hint.webp': 'Arquivos pequenos, o texto continua nítido',
  'dl.hint.pdf': 'Um documento',
  'dl.quality': 'Qualidade',
  'dl.quality.value': '{n}%',
  'dl.estimate': 'Tamanho estimado',
  'dl.estimate.idle': '(mova o controle deslizante)',
  'dl.estimate.value': '{size}',
  'dl.estimate.approx': '~ {size}', // extrapolated from a band of a big image
  'dl.estimate.busy': 'Estimando…',
  'dl.estimate.none': 'grande demais para estimar',
  'dl.layout': 'Páginas',
  'dl.layout.fit': 'Ajustar à imagem',
  'dl.layout.paper': 'A4',
  'dl.encoding': 'Imagens',
  'dl.encoding.flate': 'Sem perdas',
  'dl.encoding.jpeg': 'Leve (JPEG)',
  'dl.go': 'Baixar {format}',

  // a single export that fails (the banner; too large for the browser is 'msg.exportFailed')
  'export.err.encoder': 'Falha na exportação: seu navegador não consegue gerar este formato. Escolha PNG.',
  'export.err.unreadable': 'Falha na exportação: a imagem desta captura não pode ser lida. Abra-a de novo.',
  'export.err.generic': 'Falha na exportação. Tente outro formato, reduza a escala ou recorte a imagem.',

  // the grouped export
  'export.bulk': 'Exportar…',
  'export.bulk.tip': 'Exportar as capturas selecionadas em um único arquivo',
  'export.title': 'Exportar capturas',
  'export.count.one': '1 captura selecionada',
  'export.count.other': '{n} capturas selecionadas',
  'export.output': 'Saída',
  'export.output.zip': 'ZIP de imagens',
  'export.output.pdf': 'PDF de várias páginas',
  'export.format': 'Formato de imagem',
  'export.version': 'Cada captura é exportada como está exibida: sua versão ativa, editada ou não.',
  'export.asShown.one': '1 captura editada está em Original: ela é exportada como exibida, sem as alterações.',
  'export.asShown.other': '{n} capturas editadas estão em Original: elas são exportadas como exibidas, sem as alterações.',
  'export.limit': 'Uma exportação aceita no máximo {max} capturas. Selecione menos.',
  'export.start': 'Exportar',
  'export.cancel': 'Cancelar',
  'export.progress': 'Exportando captura {done} de {total}…',
  'export.canceled': 'Exportação cancelada. Nada foi baixado.',
  'export.done': 'Capturas exportadas: {done} de {total}. O arquivo está sendo baixado.',
  'export.none': 'Nada pôde ser exportado (0 de {total}).',
  'export.failed': 'O arquivo não pôde ser gerado.',
  'export.cause.gone': 'a captura não existe mais',
  'export.cause.limit': 'o limite de tamanho de uma exportação foi atingido',
  'export.cause.tooLarge': 'grande demais para o navegador',
  'export.cause.encoder': 'o navegador não consegue gerar este formato',
  'export.cause.unreadable': 'a imagem não pode ser lida',
  'export.cause.other': 'erro inesperado',

  // settings
  'settings.download': 'Download',
  'settings.download.format': 'Formato padrão',
  'settings.download.quality': 'Qualidade',
  'settings.download.quality.hint': 'JPEG, WebP, PDF leve',
  'settings.download.layout': 'Páginas do PDF',
  'settings.download.encoding': 'Imagens do PDF',
  'settings.download.name': 'Nome do arquivo',
  'settings.download.name.hint': 'As palavras entre chaves são substituídas: {host} o site, {title} o título da página, {date} e {time} da captura. O título só é usado se você o escrever aqui.',
};
