// Indonesian texts of the service worker: menu entries and the like (keys 'menu.*', 'sw.*').
/** @type {Record<string, string>} */
export default {
  'sw.actionTitle': 'Obturo', // tooltip of the icon; the same text as "actionTitle" in _locales/id/messages.json
  'menu.capture': 'Tangkap',
  'menu.captureEdit': 'Tangkap dan edit',
  'menu.area': 'Area',
  'menu.visible': 'Bagian yang terlihat',
  'menu.full': 'Seluruh halaman',
  'menu.element': 'Elemen',
  'menu.library': 'Buka pustaka',
  'menu.settings': 'Pengaturan',
  // the no-trace mode: a capture is copied and saved nowhere
  'sw.noTrace.title': 'tanpa jejak', // after the name in the tooltip of the icon, while the mode is on
  'sw.noTrace.edit': 'Mode tanpa jejak aktif: tidak ada yang disimpan, jadi tidak ada yang bisa diedit. Matikan di popup Obturo untuk mengedit tangkapan.',
  'sw.noTrace.copyFailed': 'Tanpa jejak: gagal menyalin, dan tidak ada yang disimpan. Coba lagi.',
  'sw.copied': 'Tangkapan disalin dan disimpan di riwayat.',
  'sw.copied.noTrace': 'Tangkapan disalin. Tidak ada yang disimpan (tanpa jejak).',
  'sw.copyFailed': 'Penyalinan gagal. Tangkapan tersimpan di riwayat: salin dari sana.',
  // what a full-page capture tells the user on the page (notice.js): what the image is not, or why the capture stopped
  'sw.full.cut': 'Halaman lebih panjang daripada yang dapat ditampung satu tangkapan: gambar berhenti di titik yang tercapai.',
  'sw.full.scaled': 'Gambar diperkecil ke {n}% agar sesuai batas tangkapan.',
  'sw.full.frame': 'Isinya berada dalam bingkai yang tidak dapat digulir Obturo: hanya bagian yang terlihat yang ditangkap.',
  'sw.full.fail.resized': 'Tangkapan seluruh halaman dihentikan: ukuran jendela berubah saat menangkap. Tidak ada yang disimpan. Coba lagi tanpa menyentuh jendela.',
  'sw.full.fail.moved': 'Tangkapan seluruh halaman dihentikan: area yang ditangkap berpindah saat digulir. Tidak ada yang disimpan.',
  'sw.full.fail.tab': 'Tangkapan seluruh halaman dihentikan: tab atau jendela lain mengambil fokus saat menangkap. Tidak ada yang disimpan.',
  'sw.full.fail.page': 'Tangkapan seluruh halaman dihentikan: halaman berubah atau berhenti merespons saat menangkap. Tidak ada yang disimpan.',
  'sw.full.fail.other': 'Tangkapan seluruh halaman gagal. Tidak ada yang disimpan. Coba lagi.',
  // what a capture says on the page when the sensitive text was hidden (redact.js)
  'sw.redact.one': '{n} item sensitif ditutup di teks halaman. Kolom formulir, gambar, dan frame tidak ditutup: periksa gambar sebelum membagikan.',
  'sw.redact.other': '{n} item sensitif ditutup di teks halaman. Kolom formulir, gambar, dan frame tidak ditutup: periksa gambar sebelum membagikan.',
  'sw.redact.none': 'Tidak ada alamat email, nomor telepon, IBAN, nomor kartu, atau kunci di teks halaman. Kolom formulir, gambar, dan frame tidak ditutup: periksa gambar sebelum membagikan.',
  'sw.redact.partial': 'Halaman terlalu besar untuk dicari seluruhnya: sebagian teks mungkin masih terlihat.',
};
