// Simplified Chinese texts of the service worker: menu entries and the like (keys 'menu.*', 'sw.*').
/** @type {Record<string, string>} */
export default {
  'sw.actionTitle': 'Obturo', // tooltip of the icon; the same text as "actionTitle" in _locales/zh_CN/messages.json
  'menu.capture': '截图',
  'menu.captureEdit': '截图并编辑',
  'menu.area': '区域',
  'menu.visible': '可见区域',
  'menu.full': '整个页面',
  'menu.element': '元素',
  'menu.library': '打开图库',
  'menu.settings': '设置',
  // the no-trace mode: a capture is copied and saved nowhere
  'sw.noTrace.title': '不留痕', // after the name in the tooltip of the icon, while the mode is on
  'sw.noTrace.edit': '“不留痕”模式已开启：不会保存任何内容，因此没有可编辑的截图。请在 Obturo 弹出窗口中关闭它，再编辑截图。',
  'sw.noTrace.copyFailed': '“不留痕”模式：复制失败，且没有保存任何内容。请重试。',
  'sw.copied': '截图已复制并保存到历史记录。',
  'sw.copied.noTrace': '截图已复制。未保存任何内容（不留痕）。',
  'sw.copyFailed': '复制失败。截图已保存在历史记录中，请从那里复制。',
  // what a full-page capture tells the user on the page (notice.js): what the image is not, or why the capture stopped
  'sw.full.cut': '页面长度超出单次截图的上限：图片只截取到已滚动到的位置。',
  'sw.full.scaled': '图片已缩小到 {n}%，以符合截图的限制。',
  'sw.full.frame': '内容位于 Obturo 无法滚动的框架中：只截取了可见区域。',
  'sw.full.fail.resized': '整页截图已中止：截图过程中窗口大小发生了变化。没有保存任何内容。请在不触碰窗口的情况下重试。',
  'sw.full.fail.moved': '整页截图已中止：正在截取的区域在滚动时发生了移动。没有保存任何内容。',
  'sw.full.fail.tab': '整页截图已中止：截图过程中另一个标签页或窗口获得了焦点。没有保存任何内容。',
  'sw.full.fail.page': '整页截图已中止：截图过程中页面发生了变化或停止响应。没有保存任何内容。',
  'sw.full.fail.other': '整页截图失败。没有保存任何内容。请重试。',
  // what a capture says on the page when the sensitive text was hidden (redact.js)
  'sw.redact.one': '已遮盖页面文本中的 {n} 项敏感内容。表单字段、图片和框架不会被遮盖：分享前请检查截图。',
  'sw.redact.other': '已遮盖页面文本中的 {n} 项敏感内容。表单字段、图片和框架不会被遮盖：分享前请检查截图。',
  'sw.redact.none': '在页面文本中未发现电子邮件地址、电话号码、IBAN、银行卡号或密钥。表单字段、图片和框架不会被遮盖：分享前请检查截图。',
  'sw.redact.partial': '页面太大，无法完整搜索：部分文本可能仍然可见。',
};
