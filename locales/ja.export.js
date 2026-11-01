// Japanese texts of the downloads: the Download button and its format menu ('act.download*', 'dl.*'), the grouped
// export ('export.*') and the Download section of the settings ('settings.download*').
// i18n.test.js checks the pair with en.export.js and that every key is used by export-ui.js, library.html or settings-ui.js.
/** @type {Record<string, string>} */
export default {
  // the Download button of the editor
  'act.download': 'ダウンロード',
  'act.download.tip': '表示中のバージョンを選んだ形式でダウンロードします',
  'dl.group': 'ダウンロード',
  'dl.options': 'ダウンロード オプション',
  'dl.busy': 'エクスポートしています…',

  // its menu
  'dl.format': '形式',
  'dl.hint.png': '可逆圧縮、文字が鮮明',
  'dl.hint.jpeg': '小さいファイル、写真向け',
  'dl.hint.webp': '小さいファイル、文字も鮮明',
  'dl.hint.pdf': '文書向け',
  'dl.quality': '品質',
  'dl.quality.value': '{n}%',
  'dl.estimate': '推定サイズ',
  'dl.estimate.idle': '（スライダーを動かしてください）',
  'dl.estimate.value': '{size}',
  'dl.estimate.approx': '約 {size}', // extrapolated from a band of a big image
  'dl.estimate.busy': '推定しています…',
  'dl.estimate.none': '大きすぎて推定できません',
  'dl.layout': 'ページ',
  'dl.layout.fit': '画像に合わせる',
  'dl.layout.paper': 'A4',
  'dl.encoding': '画像',
  'dl.encoding.flate': '可逆圧縮',
  'dl.encoding.jpeg': '軽量（JPEG）',
  'dl.go': '{format} をダウンロード',

  // a single export that fails (the banner; too large for the browser is 'msg.exportFailed')
  'export.err.encoder': 'エクスポートできませんでした。お使いのブラウザはこの形式に書き出せません。PNG を選んでください。',
  'export.err.unreadable': 'エクスポートできませんでした。このキャプチャの画像を読み取れません。開き直してください。',
  'export.err.generic': 'エクスポートできませんでした。別の形式を試すか、倍率を下げるかトリミングしてください。',

  // the grouped export
  'export.bulk': 'エクスポート…',
  'export.bulk.tip': '選択したキャプチャを 1 つのファイルにエクスポートします',
  'export.title': 'キャプチャをエクスポート',
  'export.count.one': '1 件のキャプチャを選択中',
  'export.count.other': '{n} 件のキャプチャを選択中',
  'export.output': '出力',
  'export.output.zip': '画像の ZIP',
  'export.output.pdf': '複数ページの PDF',
  'export.format': '画像形式',
  'export.version': '各キャプチャは、編集済みかどうかにかかわらず、表示中のバージョンのままエクスポートされます。',
  'export.asShown.one': '編集済みのキャプチャ 1 件がオリジナル表示になっています。表示どおり、変更なしでエクスポートされます。',
  'export.asShown.other': '編集済みのキャプチャ {n} 件がオリジナル表示になっています。表示どおり、変更なしでエクスポートされます。',
  'export.limit': '1 回のエクスポートは {max} 件までです。選択を減らしてください。',
  'export.start': 'エクスポート',
  'export.cancel': 'キャンセル',
  'export.progress': 'キャプチャをエクスポートしています… {done} / {total}',
  'export.canceled': 'エクスポートをキャンセルしました。何もダウンロードされていません。',
  'export.done': 'キャプチャをエクスポートしました: {done} / {total}。ファイルをダウンロードしています。',
  'export.none': '何もエクスポートできませんでした（0 / {total}）。',
  'export.failed': 'ファイルを作成できませんでした。',
  'export.cause.gone': 'キャプチャがもう存在しません',
  'export.cause.limit': 'エクスポートのサイズ上限に達しました',
  'export.cause.tooLarge': 'ブラウザには大きすぎます',
  'export.cause.encoder': 'ブラウザがこの形式に書き出せません',
  'export.cause.unreadable': '画像を読み取れません',
  'export.cause.other': '予期しないエラー',

  // settings
  'settings.download': 'ダウンロード',
  'settings.download.format': '既定の形式',
  'settings.download.quality': '品質',
  'settings.download.quality.hint': 'JPEG、WebP、軽量 PDF',
  'settings.download.layout': 'PDF のページ',
  'settings.download.encoding': 'PDF の画像',
  'settings.download.name': 'ファイル名',
  'settings.download.name.hint': '波かっこ内の語は置き換えられます: {host} はサイト、{title} はページのタイトル、{date} と {time} はキャプチャの日付と時刻です。タイトルはここに書いた場合にのみ使われます。',
};
