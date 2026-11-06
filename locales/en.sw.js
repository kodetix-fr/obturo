// English texts of the service worker: menu entries and the like (keys 'menu.*', 'sw.*').
/** @type {Record<string, string>} */
export default {
  'sw.actionTitle': 'Obturo', // tooltip of the icon; the same text as "actionTitle" in _locales/en/messages.json
  'menu.capture': 'Capture',
  'menu.captureEdit': 'Capture and edit',
  'menu.area': 'Area',
  'menu.visible': 'Visible part',
  'menu.full': 'Full page',
  'menu.element': 'Element',
  'menu.library': 'Open the library',
  'menu.settings': 'Settings',
  // the no-trace mode: a capture is copied and saved nowhere
  'sw.noTrace.title': 'no trace', // after the name in the tooltip of the icon, while the mode is on
  'sw.noTrace.edit': 'No trace is on: nothing is saved, so there is nothing to edit. Turn it off in the Obturo popup to edit a capture.',
  'sw.noTrace.copyFailed': 'No trace: the copy failed, and nothing was saved. Try again.',
  // what a full-page capture tells the user on the page (notice.js): what the image is not, or why the capture stopped
  'sw.full.cut': 'The page is longer than a capture can hold: the image stops at the point reached.',
  'sw.full.scaled': 'The image was reduced to {n}% to fit the limits of a capture.',
  'sw.full.frame': "The content is in a frame, which Obturo can't scroll: only the visible part was captured.",
  'sw.full.fail.resized': 'Full page stopped: the window changed size during the capture. Nothing was saved. Try again without touching the window.',
  'sw.full.fail.moved': 'Full page stopped: the area being captured moved while it scrolled. Nothing was saved.',
  'sw.full.fail.tab': 'Full page stopped: another tab or window took the focus during the capture. Nothing was saved.',
  'sw.full.fail.page': 'Full page stopped: the page changed or stopped answering during the capture. Nothing was saved.',
  'sw.full.fail.other': 'Full page failed. Nothing was saved. Try again.',
  // what a capture says on the page when the sensitive text was hidden (redact.js)
  'sw.redact.one': '{n} sensitive item covered in the text of the page. Form fields, images and frames are not covered: check the image before you share.',
  'sw.redact.other': '{n} sensitive items covered in the text of the page. Form fields, images and frames are not covered: check the image before you share.',
  'sw.redact.none': 'No e-mail address, phone number, IBAN, card number or key found in the text of the page. Form fields, images and frames are not covered: check the image before you share.',
  'sw.redact.partial': 'The page is too big to be searched in full: some text may still show.',
};
