// Japanese texts of the service worker: menu entries and the like (keys 'menu.*', 'sw.*').
/** @type {Record<string, string>} */
export default {
  'sw.actionTitle': 'Obturo', // tooltip of the icon; the same text as "actionTitle" in _locales/ja/messages.json
  'menu.capture': 'キャプチャ',
  'menu.captureEdit': 'キャプチャして編集',
  'menu.area': '範囲',
  'menu.visible': '表示部分',
  'menu.full': 'ページ全体',
  'menu.element': '要素',
  'menu.library': 'ライブラリを開く',
  'menu.settings': '設定',
  // the no-trace mode: a capture is copied and saved nowhere
  'sw.noTrace.title': '保存しない', // after the name in the tooltip of the icon, while the mode is on
  'sw.noTrace.edit': '「保存しない」がオンです。何も保存されないため、編集するものがありません。キャプチャを編集するには、Obturo のポップアップでオフにしてください。',
  'sw.noTrace.copyFailed': '「保存しない」モード: コピーできず、何も保存されませんでした。もう一度お試しください。',
  'sw.copied': 'キャプチャをコピーし、履歴に保存しました。',
  'sw.copied.noTrace': 'キャプチャをコピーしました。何も保存されていません（保存しない）。',
  'sw.copyFailed': 'コピーに失敗しました。キャプチャは履歴に保存されています。そこからコピーしてください。',
  // what a full-page capture tells the user on the page (notice.js): what the image is not, or why the capture stopped
  'sw.full.cut': 'ページが 1 回のキャプチャに収まる長さを超えています。画像は到達した位置で終わっています。',
  'sw.full.scaled': 'キャプチャの上限に収めるため、画像を {n}% に縮小しました。',
  'sw.full.frame': '内容はフレーム内にあり、Obturo はスクロールできません。表示部分だけをキャプチャしました。',
  'sw.full.fail.resized': 'ページ全体のキャプチャを中止しました。キャプチャ中にウィンドウのサイズが変わりました。何も保存されていません。ウィンドウを操作せずにもう一度お試しください。',
  'sw.full.fail.moved': 'ページ全体のキャプチャを中止しました。スクロール中にキャプチャ対象の範囲が動きました。何も保存されていません。',
  'sw.full.fail.tab': 'ページ全体のキャプチャを中止しました。キャプチャ中に別のタブまたはウィンドウがフォーカスを取得しました。何も保存されていません。',
  'sw.full.fail.page': 'ページ全体のキャプチャを中止しました。キャプチャ中にページが変化したか、応答しなくなりました。何も保存されていません。',
  'sw.full.fail.other': 'ページ全体のキャプチャに失敗しました。何も保存されていません。もう一度お試しください。',
  // what a capture says on the page when the sensitive text was hidden (redact.js)
  'sw.redact.one': 'ページのテキスト内の機密項目 {n} 件を覆いました。入力欄、画像、フレームは覆われません。共有する前に画像を確認してください。',
  'sw.redact.other': 'ページのテキスト内の機密項目 {n} 件を覆いました。入力欄、画像、フレームは覆われません。共有する前に画像を確認してください。',
  'sw.redact.none': 'ページのテキストに、メールアドレス、電話番号、IBAN、カード番号、キーは見つかりませんでした。入力欄、画像、フレームは覆われません。共有する前に画像を確認してください。',
  'sw.redact.partial': 'ページが大きすぎて全体を検索できませんでした。一部のテキストが見えている可能性があります。',
};
