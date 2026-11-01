// Simplified Chinese texts of the downloads: the Download button and its format menu ('act.download*', 'dl.*'), the grouped
// export ('export.*') and the Download section of the settings ('settings.download*').
// i18n.test.js checks the pair with en.export.js and that every key is used by export-ui.js, library.html or settings-ui.js.
/** @type {Record<string, string>} */
export default {
  // the Download button of the editor
  'act.download': '下载',
  'act.download.tip': '以所选格式下载当前显示的版本',
  'dl.group': '下载',
  'dl.options': '下载选项',
  'dl.busy': '正在导出…',

  // its menu
  'dl.format': '格式',
  'dl.hint.png': '无损，文字清晰',
  'dl.hint.jpeg': '文件小，适合照片',
  'dl.hint.webp': '文件小，文字保持清晰',
  'dl.hint.pdf': '文档',
  'dl.quality': '质量',
  'dl.quality.value': '{n}%',
  'dl.estimate': '预计大小',
  'dl.estimate.idle': '（移动滑块）',
  'dl.estimate.value': '{size}',
  'dl.estimate.approx': '约 {size}', // extrapolated from a band of a big image
  'dl.estimate.busy': '正在估算…',
  'dl.estimate.none': '太大，无法估算',
  'dl.layout': '页面',
  'dl.layout.fit': '适应图片',
  'dl.layout.paper': 'A4',
  'dl.encoding': '图片',
  'dl.encoding.flate': '无损',
  'dl.encoding.jpeg': '轻量（JPEG）',
  'dl.go': '下载 {format}',

  // a single export that fails (the banner; too large for the browser is 'msg.exportFailed')
  'export.err.encoder': '导出失败：你的浏览器无法生成此格式的文件。请选择 PNG。',
  'export.err.unreadable': '导出失败：无法读取此截图的图片。请重新打开它。',
  'export.err.generic': '导出失败。请试试其他格式，或降低比例、裁剪图片。',

  // the grouped export
  'export.bulk': '导出…',
  'export.bulk.tip': '将所选截图导出为单个文件',
  'export.title': '导出截图',
  'export.count.one': '已选择 1 张截图',
  'export.count.other': '已选择 {n} 张截图',
  'export.output': '输出',
  'export.output.zip': '图片 ZIP 压缩包',
  'export.output.pdf': '多页 PDF',
  'export.format': '图片格式',
  'export.version': '每张截图都按当前显示的样子导出：即它正在使用的版本，无论是否编辑过。',
  'export.asShown.one': '有 1 张已编辑的截图当前显示为原图：它将按显示的样子导出，不含更改。',
  'export.asShown.other': '有 {n} 张已编辑的截图当前显示为原图：它们将按显示的样子导出，不含更改。',
  'export.limit': '一次导出最多 {max} 张截图。请减少选择。',
  'export.start': '导出',
  'export.cancel': '取消',
  'export.progress': '正在导出第 {done} 张截图，共 {total} 张…',
  'export.canceled': '导出已取消。没有下载任何内容。',
  'export.done': '已导出截图：{done} / {total}。文件正在下载。',
  'export.none': '没有可导出的内容（0 / {total}）。',
  'export.failed': '无法生成文件。',
  'export.cause.gone': '截图已不存在',
  'export.cause.limit': '已达到单次导出的大小上限',
  'export.cause.tooLarge': '对浏览器来说太大',
  'export.cause.encoder': '浏览器无法生成此格式',
  'export.cause.unreadable': '无法读取图片',
  'export.cause.other': '意外错误',

  // settings
  'settings.download': '下载',
  'settings.download.format': '默认格式',
  'settings.download.quality': '质量',
  'settings.download.quality.hint': 'JPEG、WebP、轻量 PDF',
  'settings.download.layout': 'PDF 页面',
  'settings.download.encoding': 'PDF 图片',
  'settings.download.name': '文件名',
  'settings.download.name.hint': '花括号中的词会被替换：{host} 为网站，{title} 为页面标题，{date} 和 {time} 为截图的日期和时间。页面标题只有写入此处的文件名时才会使用。',
};
