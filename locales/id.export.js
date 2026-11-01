// Indonesian texts of the downloads: the Download button and its format menu ('act.download*', 'dl.*'), the grouped
// export ('export.*') and the Download section of the settings ('settings.download*').
// i18n.test.js checks the pair with en.export.js and that every key is used by export-ui.js, library.html or settings-ui.js.
/** @type {Record<string, string>} */
export default {
  // the Download button of the editor
  'act.download': 'Unduh',
  'act.download.tip': 'Unduh versi yang ditampilkan dalam format pilihan',
  'dl.group': 'Unduh',
  'dl.options': 'Opsi unduhan',
  'dl.busy': 'Mengekspor…',

  // its menu
  'dl.format': 'Format',
  'dl.hint.png': 'Tanpa kehilangan kualitas, teks tajam',
  'dl.hint.jpeg': 'File kecil, untuk foto',
  'dl.hint.webp': 'File kecil, teks tetap tajam',
  'dl.hint.pdf': 'Dokumen',
  'dl.quality': 'Kualitas',
  'dl.quality.value': '{n}%',
  'dl.estimate': 'Perkiraan ukuran',
  'dl.estimate.idle': '(geser penggesernya)',
  'dl.estimate.value': '{size}',
  'dl.estimate.approx': '~ {size}', // extrapolated from a band of a big image
  'dl.estimate.busy': 'Memperkirakan…',
  'dl.estimate.none': 'terlalu besar untuk diperkirakan',
  'dl.layout': 'Halaman',
  'dl.layout.fit': 'Pas gambar',
  'dl.layout.paper': 'A4',
  'dl.encoding': 'Gambar',
  'dl.encoding.flate': 'Tanpa kehilangan',
  'dl.encoding.jpeg': 'Ringan (JPEG)',
  'dl.go': 'Unduh {format}',

  // a single export that fails (the banner; too large for the browser is 'msg.exportFailed')
  'export.err.encoder': 'Gagal mengekspor: browser Anda tidak dapat menghasilkan format ini. Pilih PNG.',
  'export.err.unreadable': 'Gagal mengekspor: gambar tangkapan ini tidak dapat dibaca. Buka lagi tangkapannya.',
  'export.err.generic': 'Gagal mengekspor. Coba format lain, atau kurangi skala atau pangkas gambar.',

  // the grouped export
  'export.bulk': 'Ekspor…',
  'export.bulk.tip': 'Ekspor tangkapan yang dipilih sebagai satu file',
  'export.title': 'Ekspor tangkapan',
  'export.count.one': '1 tangkapan dipilih',
  'export.count.other': '{n} tangkapan dipilih',
  'export.output': 'Keluaran',
  'export.output.zip': 'ZIP berisi gambar',
  'export.output.pdf': 'PDF multihalaman',
  'export.format': 'Format gambar',
  'export.version': 'Setiap tangkapan diekspor seperti yang ditampilkan: versi aktifnya, diedit atau tidak.',
  'export.asShown.one': '1 tangkapan yang diedit memakai versi Asli: diekspor seperti yang ditampilkan, tanpa perubahan.',
  'export.asShown.other': '{n} tangkapan yang diedit memakai versi Asli: diekspor seperti yang ditampilkan, tanpa perubahan.',
  'export.limit': 'Satu ekspor memuat maksimum {max} tangkapan. Pilih lebih sedikit.',
  'export.start': 'Ekspor',
  'export.cancel': 'Batal',
  'export.progress': 'Mengekspor tangkapan {done} dari {total}…',
  'export.canceled': 'Ekspor dibatalkan. Tidak ada yang diunduh.',
  'export.done': 'Tangkapan diekspor: {done} dari {total}. File sedang diunduh.',
  'export.none': 'Tidak ada yang dapat diekspor (0 dari {total}).',
  'export.failed': 'File tidak dapat dibuat.',
  'export.cause.gone': 'tangkapan sudah tidak ada',
  'export.cause.limit': 'batas ukuran satu ekspor tercapai',
  'export.cause.tooLarge': 'terlalu besar untuk browser',
  'export.cause.encoder': 'browser tidak dapat menghasilkan format ini',
  'export.cause.unreadable': 'gambar tidak dapat dibaca',
  'export.cause.other': 'kesalahan tak terduga',

  // settings
  'settings.download': 'Unduh',
  'settings.download.format': 'Format bawaan',
  'settings.download.quality': 'Kualitas',
  'settings.download.quality.hint': 'JPEG, WebP, PDF ringan',
  'settings.download.layout': 'Halaman PDF',
  'settings.download.encoding': 'Gambar PDF',
  'settings.download.name': 'Nama file',
  'settings.download.name.hint': 'Kata dalam kurung kurawal akan diganti: {host} situs, {title} judul halaman, {date} tanggal dan {time} jam tangkapan. Judul hanya dipakai jika Anda menuliskannya di sini.',
};
