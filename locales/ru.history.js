// Russian texts of the history: the full-screen view, its selection bar, and the history block of the settings (keys 'hist.*').
// Keys with a '.one' and a '.other' form are plurals (history-model.js, pluralForm). Russian needs three forms for a noun
// after a number, and the extension has only two, so the counted noun goes before the number ("Снимков: {n}") or is
// abbreviated ("{n} дн."). Key segments are letters only, so that i18n.test.js can find the keys used by the code.
/** @type {Record<string, string>} */
export default {
  // header button, strip shortcut
  'hist.open': 'История',
  'hist.open.tip': 'Просмотреть все снимки',
  'hist.all': 'Вся история',
  'hist.all.aria': 'Открыть всю историю. Снимков: {n}',

  // the view
  'hist.title': 'История',
  'hist.close': 'Закрыть историю',
  'hist.grid': 'Снимки',
  'hist.search.label': 'Поиск по снимкам',
  'hist.search.placeholder': 'Искать по названию или адресу',
  'hist.host.label': 'Сайт',
  'hist.host.all': 'Все сайты',
  'hist.period.label': 'Период',
  'hist.period.all': 'Всё время',
  'hist.period.today': 'Сегодня',
  'hist.period.week': '7 дней',
  'hist.period.month': '30 дней',
  'hist.pinned.only': 'Только закреплённые',
  'hist.count.one': 'Снимков: {n}',
  'hist.count.other': 'Снимков: {n}',
  'hist.found.one': 'Найдено: {n}',
  'hist.found.other': 'Найдено: {n}',
  'hist.more': 'Загрузка остальных…',
  'hist.hint.keys': 'Стрелки: перемещение, Пробел: выбор, Enter: открытие, P: закрепление, Delete: удаление.',
  'hist.footer.settings': 'Настройки хранилища',
  'hist.readonly': 'Эта вкладка только для чтения: закройте другую вкладку Obturo, чтобы открывать, закреплять или удалять снимки.',

  // cards
  'hist.card.select': 'Выбрать снимок от {when}',
  'hist.pin.card': 'Закрепить снимок от {when}',
  'hist.pin.editor': 'Закрепить этот снимок',
  'hist.pin.tip': 'Закреплённые снимки никогда не удаляются автоматически.',

  // states
  'hist.none.title': 'Ничего не найдено',
  'hist.none.hint': 'Попробуйте другие слова или сбросьте фильтры.',
  'hist.none.clear': 'Сбросить фильтры',
  'hist.error.title': 'Не удалось прочитать историю',
  'hist.error.hint': 'База данных недоступна. Перезагрузите страницу; если проблема сохраняется, перезапустите браузер.',
  'hist.error.retry': 'Повторить',

  // selection bar
  'hist.bulk.label': 'Действия с выбранным',
  'hist.sel.one': 'Выбрано: {n}',
  'hist.sel.other': 'Выбрано: {n}',
  'hist.sel.all': 'Выбрать все результаты: {n}',
  'hist.sel.clear': 'Снять выбор',
  'hist.bulk.pin': 'Закрепить',
  'hist.bulk.unpin': 'Открепить',
  'hist.bulk.delete': 'Удалить',

  // deleting
  'hist.cancel': 'Отмена',
  'hist.del.title.one': 'Удалить этот снимок?',
  'hist.del.title.other': 'Удалить выбранные снимки ({n})?',
  'hist.del.body': 'Выбранное будет стёрто из этого браузера вместе с версиями. Это действие нельзя отменить.',
  'hist.del.includes': 'Из них закреплённых: {pinned}, изменённых: {edited}.',
  'hist.del.size': 'Освободится {size}.',
  'hist.del.ok': 'Удалить',
  'hist.del.progress': 'Удаление… {done} из {total}',
  'hist.del.failed': 'Не удалось удалить: база данных недоступна. Перезагрузите страницу и попробуйте снова.',
  'hist.status.deleted.one': 'Удалено снимков: {n}',
  'hist.status.deleted.other': 'Удалено снимков: {n}',
  'hist.status.pinned.one': 'Закреплено снимков: {n}',
  'hist.status.pinned.other': 'Закреплено снимков: {n}',
  'hist.status.unpinned.one': 'Откреплено снимков: {n}',
  'hist.status.unpinned.other': 'Откреплено снимков: {n}',
  'hist.pin.failed': 'Не удалось обновить снимок: база данных недоступна. Перезагрузите страницу и попробуйте снова.',

  // sizes
  'hist.unit.b': 'Б',
  'hist.unit.kb': 'КБ',
  'hist.unit.mb': 'МБ',
  'hist.unit.gb': 'ГБ',
  'hist.unit.tb': 'ТБ',

  // settings block
  'hist.set.title': 'История',
  'hist.set.keep': 'Хранить снимки',
  'hist.keep.week': '7 дней',
  'hist.keep.month': '30 дней',
  'hist.keep.quarter': '90 дней',
  'hist.keep.year': '1 год',
  'hist.keep.forever': 'Бессрочно',
  'hist.keep.custom': '{n} дн.', // an abbreviation: a custom number of days can be 1, 2 or 5, and each needs another form
  'hist.set.cap': 'Предел размера',
  'hist.cap.half': '500 МБ',
  'hist.cap.single': '1 ГБ',
  'hist.cap.double': '2 ГБ',
  'hist.cap.five': '5 ГБ',
  'hist.cap.ten': '10 ГБ',
  'hist.cap.none': 'Без предела',
  'hist.set.noTrace': 'Без следа',
  'hist.set.noTrace.note': 'Снимки копируются в буфер обмена и нигде не сохраняются: ничего в истории, нечего редактировать. Уже сделанные снимки остаются. Во всплывающем окне Obturo есть тот же переключатель, а значок становится фиолетовым, пока режим включён.',
  'hist.set.note': 'Закреплённые снимки никогда не удаляются автоматически. Изменённые снимки не удаляются по сроку хранения, но могут быть удалены при достижении предела размера.',
  'hist.set.readonly': 'Эта вкладка только для чтения: закройте другую вкладку Obturo, чтобы менять эти настройки, очищать или удалять снимки.',
  'hist.meter.label': 'Место, занятое историей',
  'hist.meter.cap': '{count}, {used} из {cap}',
  'hist.meter.nocap': '{count}, {used}, без предела размера',
  'hist.meter.over': 'Одни лишь закреплённые снимки занимают больше предела.',
  'hist.meter.unavailable': 'Данные о хранилище недоступны.',
  'hist.pending': 'При следующей очистке (новый снимок или открытие библиотеки) будет удалено. {what}.',
  'hist.purge.btn': 'Очистить сейчас…',
  'hist.wipe.btn': 'Удалить всё…',

  // purge dialog
  'hist.purge.title': 'Очистить сейчас',
  'hist.purge.age': 'Удалить снимки старше',
  'hist.purge.days': 'дн.',
  'hist.purge.cap': 'Сократить историю до',
  'hist.purge.note': 'Закреплённые снимки всегда сохраняются. При очистке по возрасту сохраняются и изменённые снимки.',
  'hist.purge.none': 'С этими параметрами удалять нечего.',
  'hist.purge.some': 'Будет удалено. {what}. Освободится {size}.',
  'hist.purge.kept': 'Останутся: закреплённых {pinned}, изменённых {edited}.',
  'hist.purge.remaining': 'После очистки останется. {what} ({size}).',
  'hist.purge.over': 'Предел размера недостижим: одни лишь закреплённые снимки занимают больше места.',
  'hist.purge.run': 'Очистить',
  'hist.purge.running': 'Очистка…',
  'hist.purge.done': 'Удалено. {what}. Освобождено {size}.',
  'hist.purge.failed': 'Очистка не удалась: база данных недоступна. Перезагрузите страницу и попробуйте снова.',

  // delete everything
  'hist.wipe.title': 'Удалить всю историю?',
  'hist.wipe.body': 'Из этого браузера будет стёрто всё, включая закреплённые и изменённые снимки. {what} ({size}). Это действие нельзя отменить.',
  'hist.wipe.type': 'Введите {word} для подтверждения',
  'hist.wipe.word': 'УДАЛИТЬ',
  'hist.wipe.ok': 'Удалить всё',
};
