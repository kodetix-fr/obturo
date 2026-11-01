// Russian texts of the downloads: the Download button and its format menu ('act.download*', 'dl.*'), the grouped
// export ('export.*') and the Download section of the settings ('settings.download*').
// i18n.test.js checks the pair with en.export.js and that every key is used by export-ui.js, library.html or settings-ui.js.
/** @type {Record<string, string>} */
export default {
  // the Download button of the editor
  'act.download': 'Скачать',
  'act.download.tip': 'Скачать текущую версию в выбранном формате',
  'dl.group': 'Скачивание',
  'dl.options': 'Параметры скачивания',
  'dl.busy': 'Экспорт…',

  // its menu
  'dl.format': 'Формат',
  'dl.hint.png': 'Без потерь, чёткий текст',
  'dl.hint.jpeg': 'Небольшие файлы, для фотографий',
  'dl.hint.webp': 'Небольшие файлы, текст остаётся чётким',
  'dl.hint.pdf': 'Документ',
  'dl.quality': 'Качество',
  'dl.quality.value': '{n} %',
  'dl.estimate': 'Примерный размер',
  'dl.estimate.idle': '(подвиньте ползунок)',
  'dl.estimate.value': '{size}',
  'dl.estimate.approx': '~ {size}', // extrapolated from a band of a big image
  'dl.estimate.busy': 'Оценка…',
  'dl.estimate.none': 'слишком большой для оценки',
  'dl.layout': 'Страницы',
  'dl.layout.fit': 'По изображению',
  'dl.layout.paper': 'A4',
  'dl.encoding': 'Изображения',
  'dl.encoding.flate': 'Без потерь',
  'dl.encoding.jpeg': 'Облегчённые (JPEG)',
  'dl.go': 'Скачать {format}',

  // a single export that fails (the banner; too large for the browser is 'msg.exportFailed')
  'export.err.encoder': 'Не удалось экспортировать: браузер не поддерживает этот формат. Выберите PNG.',
  'export.err.unreadable': 'Не удалось экспортировать: изображение этого снимка не читается. Откройте его заново.',
  'export.err.generic': 'Не удалось экспортировать. Попробуйте другой формат, уменьшите масштаб или обрежьте изображение.',

  // the grouped export
  'export.bulk': 'Экспорт…',
  'export.bulk.tip': 'Экспортировать выбранные снимки одним файлом',
  'export.title': 'Экспорт снимков',
  'export.count.one': 'Выбран 1 снимок',
  'export.count.other': 'Выбрано снимков: {n}',
  'export.output': 'Результат',
  'export.output.zip': 'ZIP с изображениями',
  'export.output.pdf': 'Многостраничный PDF',
  'export.format': 'Формат изображений',
  'export.version': 'Каждый снимок экспортируется так, как показан: его активная версия, изменённая или нет.',
  'export.asShown.one': '1 изменённый снимок переключён на «Оригинал»: он будет экспортирован как показан, без изменений.',
  'export.asShown.other': 'Изменённые снимки, переключённые на «Оригинал» ({n}), будут экспортированы как показаны, без изменений.',
  'export.limit': 'Максимум снимков за один экспорт: {max}. Выберите меньше.',
  'export.start': 'Экспортировать',
  'export.cancel': 'Отмена',
  'export.progress': 'Экспорт снимка {done} из {total}…',
  'export.canceled': 'Экспорт отменён. Ничего не скачано.',
  'export.done': 'Экспортировано снимков: {done} из {total}. Файл скачивается.',
  'export.none': 'Ничего не удалось экспортировать (0 из {total}).',
  'export.failed': 'Не удалось собрать файл.',
  'export.cause.gone': 'снимка больше нет',
  'export.cause.limit': 'достигнут предел размера экспорта',
  'export.cause.tooLarge': 'слишком большой для браузера',
  'export.cause.encoder': 'браузер не поддерживает этот формат',
  'export.cause.unreadable': 'изображение не читается',
  'export.cause.other': 'непредвиденная ошибка',

  // settings
  'settings.download': 'Скачивание',
  'settings.download.format': 'Формат по умолчанию',
  'settings.download.quality': 'Качество',
  'settings.download.quality.hint': 'JPEG, WebP, облегчённый PDF',
  'settings.download.layout': 'Страницы PDF',
  'settings.download.encoding': 'Изображения в PDF',
  'settings.download.name': 'Имя файла',
  'settings.download.name.hint': 'Слова в фигурных скобках заменяются значениями: {host} (сайт), {title} (заголовок страницы), {date} и {time} (дата и время снимка). Заголовок используется, только если вы впишете его здесь.',
};
