// Runs while library.html is still being parsed, before the stylesheet: puts the theme chosen in the settings on <html>, so that
// the first paint already has its colors. Without it an explicit theme that differs from the one of the system (dark chosen, light
// system) showed 8 or 9 ms of the other one before library.js, a module that runs after the parse, set data-theme.
// It reads the copy that settings.js keeps in localStorage (the key must stay the one of APPEARANCE_KEY there; theme-boot.test.js
// checks it); IndexedDB, the truth, is only confirmed by library.js a moment later. A plain script and not a module (a module
// would wait for the others), and an external file: the content security policy of the pages forbids inline scripts.
{
  try {
    const theme = JSON.parse(localStorage.getItem('obturo.appearance'))?.theme;
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch {
    // no copy yet (first visit), no localStorage, or not JSON: library.js applies the theme once the settings are read
  }
}
