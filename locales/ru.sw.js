// Russian texts of the service worker: menu entries and the like (keys 'menu.*', 'sw.*').
/** @type {Record<string, string>} */
export default {
  'sw.actionTitle': 'Obturo', // tooltip of the icon; the same text as "actionTitle" in _locales/ru/messages.json
  'menu.capture': 'Снимок',
  'menu.captureEdit': 'Снимок с редактированием',
  'menu.area': 'Область',
  'menu.visible': 'Видимая часть',
  'menu.full': 'Вся страница',
  'menu.library': 'Открыть библиотеку',
  'menu.settings': 'Настройки',
  // the no-trace mode: a capture is copied and saved nowhere
  'sw.noTrace.title': 'без следа', // after the name in the tooltip of the icon, while the mode is on
  'sw.noTrace.edit': 'Включён режим «без следа»: ничего не сохраняется, поэтому редактировать нечего. Выключите его во всплывающем окне Obturo, чтобы редактировать снимок.',
  'sw.noTrace.copyFailed': 'Без следа: не удалось скопировать, и ничего не сохранено. Попробуйте снова.',
  // what a full-page capture tells the user on the page (notice.js): what the image is not, or why the capture stopped
  'sw.full.cut': 'Страница длиннее, чем вмещает снимок: изображение обрывается на достигнутом месте.',
  'sw.full.scaled': 'Изображение уменьшено до {n} %, чтобы уложиться в пределы снимка.',
  'sw.full.frame': 'Содержимое находится во фрейме, который Obturo не может прокрутить: снята только видимая часть.',
  'sw.full.fail.resized': 'Снимок всей страницы прерван: окно изменило размер во время съёмки. Ничего не сохранено. Попробуйте снова, не трогая окно.',
  'sw.full.fail.moved': 'Снимок всей страницы прерван: снимаемая область сдвинулась во время прокрутки. Ничего не сохранено.',
  'sw.full.fail.tab': 'Снимок всей страницы прерван: другая вкладка или окно перехватили фокус во время съёмки. Ничего не сохранено.',
  'sw.full.fail.page': 'Снимок всей страницы прерван: страница изменилась или перестала отвечать во время съёмки. Ничего не сохранено.',
  'sw.full.fail.other': 'Снимок всей страницы не удался. Ничего не сохранено. Попробуйте снова.',
};
