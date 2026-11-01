// What a capture hides in the text of a page: e-mail addresses, phone numbers, IBANs, card numbers and well-known secrets. Pure, no DOM.
// A classic script, injected before redact.js, so it cannot export: the tests import it for its effect and read globalThis.__obturoSensitive.
// ponytail: patterns and checksums only, no "long random string" rule (commit hashes and ids would be hidden too); add a rule when a service shows a stable prefix.
(() => {
  /** Luhn check of a string of digits. @param {string} digits */
  const luhn = (digits) => {
    let sum = 0;
    for (let i = digits.length - 1, double = false; i >= 0; i--, double = !double) {
      let d = digits.charCodeAt(i) - 48;
      if (double && (d *= 2) > 9) d -= 9;
      sum += d;
    }
    return sum % 10 === 0;
  };

  /** ISO 13616 check (mod 97) of an IBAN without spaces. @param {string} iban */
  const ibanOk = (iban) => {
    if (iban.length < 15 || iban.length > 34) return false;
    let rest = 0;
    for (const c of iban.slice(4) + iban.slice(0, 4)) {
      for (const d of c <= '9' ? c : String(c.charCodeAt(0) - 55)) rest = (rest * 10 + Number(d)) % 97;
    }
    return rest === 1;
  };

  const SECRET = new RegExp([
    String.raw`[sr]k_(?:live|test)_[A-Za-z0-9]{10,}`, // Stripe
    String.raw`sk-(?:proj-)?[A-Za-z0-9_-]{20,}`,
    String.raw`gh[pousr]_[A-Za-z0-9]{30,}`, // GitHub
    String.raw`github_pat_[A-Za-z0-9_]{20,}`,
    String.raw`(?:AKIA|ASIA)[0-9A-Z]{16}`, // AWS
    String.raw`xox[baprs]-[A-Za-z0-9-]{10,}`, // Slack
    String.raw`AIza[0-9A-Za-z_-]{35}`, // Google
    String.raw`eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}`, // JWT
  ].map((p) => `(?<![\\w-])${p}`).join('|'), 'g');

  // A text with none of these cannot match a rule: most of a page is skipped by this one test.
  const MAY = /[@\d]|-----|eyJ|AIza|AKIA|ASIA|xox|gh[pousr]_|github_pat_|[sr]k[_-]/;

  /** @type {Array<[string, RegExp, ((match: string) => boolean)?]>} In order of priority. */
  const RULES = [
    ['secret', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
    ['secret', SECRET],
    ['iban', /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, (m) => ibanOk(m.replaceAll(' ', ''))],
    ['card', /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g, (m) => luhn(m.replace(/[ -]/g, ''))],
    ['email', /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, (m) => !/\.(?:png|jpe?g|gif|webp|svg|css|js)$/i.test(m)],
    // international (+ or 00, 9 to 14 digits) and the French national form 0X XX XX XX XX
    ['phone', /(?<![\w@.+-])(?:\+|00)[1-9](?:[ .()-]{0,2}\d){8,13}(?!\d)/g],
    ['phone', /(?<![\w@.+-])0[1-9](?:[ .-]?\d{2}){4}(?!\d)/g],
  ];

  /**
   * The parts of a text to hide, in order, never overlapping: two matches that touch are merged, so that the whole of both is hidden.
   * @param {string} text
   * @returns {Array<{ start: number, end: number, kind: string }>}
   */
  function find(text) {
    if (!MAY.test(text)) return [];
    /** @type {Array<{ start: number, end: number, kind: string, rank: number }>} */
    const hits = [];
    RULES.forEach(([kind, re, ok], rank) => {
      for (const m of text.matchAll(re)) if (!ok || ok(m[0])) hits.push({ start: m.index, end: m.index + m[0].length, kind, rank });
    });
    hits.sort((a, b) => a.start - b.start || a.rank - b.rank);
    /** @type {Array<{ start: number, end: number, kind: string }>} */
    const out = [];
    for (const { start, end, kind } of hits) {
      const last = out.at(-1);
      if (last && start < last.end) last.end = Math.max(last.end, end);
      else out.push({ start, end, kind });
    }
    return out;
  }

  globalThis.__obturoSensitive = { find };
})();
