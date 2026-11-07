// The text of a stamp: the address of the page and the date of the capture (pure functions, testable with `node --test`).

export const MAX_ADDRESS = 100; // characters of the address kept in a stamp
const SEPARATOR = '  |  ';

/**
 * The address as it is stamped: no scheme and no fragment, cut at MAX_ADDRESS characters. A text that is not an address is cut as it is.
 * @param {string} url
 */
export function displayAddress(url) {
  let text = String(url ?? '').trim();
  try {
    const u = new URL(text);
    if (u.protocol === 'http:' || u.protocol === 'https:') text = u.host + (u.pathname === '/' && !u.search ? '' : u.pathname) + u.search;
  } catch { /* not an address: kept as it is */ }
  return text.length > MAX_ADDRESS ? `${text.slice(0, MAX_ADDRESS - 3)}...` : text;
}

/** The text of the stamp of a capture: its address, then `when` (the date, already written for the language); either one may be missing. @param {string} url @param {string} when */
export const stampText = (url, when) => [displayAddress(url), when].filter(Boolean).join(SEPARATOR);

/**
 * Font size of a stamp for an area `width` px wide: a small line, 1 / 80 of the width, brought down when the text would not fit in it.
 * @param {number} width @param {number} textWidthAtOne What the text measures at a font size of 1.
 */
export function stampFontSize(width, textWidthAtOne) {
  const wanted = Math.max(11, Math.round(width / 80));
  const room = Math.max(1, width * 0.96);
  return Math.max(8, Math.min(wanted, Math.floor(room / Math.max(textWidthAtOne, 1e-6))));
}
