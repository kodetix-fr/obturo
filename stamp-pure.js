// The text of a stamp: the address of the page and the date of the capture (pure functions, testable with `node --test`).

export const MAX_ADDRESS = 100; // characters of the address kept in a stamp
const SEPARATOR = '  |  ';

/**
 * The address as it is stamped: no scheme and no fragment, escapes read back (a path in another script stays readable), the query only
 * when `query` is true. Past MAX_ADDRESS characters the host stays and the head of the path goes, because the end of an address is what
 * tells two pages apart. A text that is not a web address is cut at the end as it is.
 * @param {string} url @param {{ query?: boolean }} [options]
 */
export function displayAddress(url, { query = true } = {}) {
  let host = '', rest = String(url ?? '').trim();
  try {
    const u = new URL(rest);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const search = query ? u.search : '';
      host = u.host;
      rest = u.pathname === '/' && !search ? '' : u.pathname + search;
      try { rest = decodeURIComponent(rest); } catch { /* a broken escape stays as it is */ }
    }
  } catch { /* not an address: kept as it is */ }
  rest = [...rest].map((c) => (c < ' ' || c === '\x7f' ? ' ' : c)).join('');
  if (host.length + rest.length <= MAX_ADDRESS) return host + rest;
  if (!host || host.length > MAX_ADDRESS - 8) return `${(host + rest).slice(0, MAX_ADDRESS - 3)}...`;
  return `${host}...${rest.slice(rest.length - (MAX_ADDRESS - host.length - 3))}`;
}

/** The text of the stamp of a capture: its address, then `when` (the date, already written for the language); either one may be missing. @param {string} url @param {string} when @param {{ query?: boolean }} [options] */
export const stampText = (url, when, options) => [displayAddress(url, options), when].filter(Boolean).join(SEPARATOR);

/**
 * Font size of a stamp for an area `width` px wide: a small line, 1 / 80 of the width, brought down when the text would not fit in it.
 * @param {number} width @param {number} textWidthAtOne What the text measures at a font size of 1.
 */
export function stampFontSize(width, textWidthAtOne) {
  const wanted = Math.max(11, Math.round(width / 80));
  const room = Math.max(1, width * 0.96);
  return Math.max(8, Math.min(wanted, Math.floor(room / Math.max(textWidthAtOne, 1e-6))));
}
