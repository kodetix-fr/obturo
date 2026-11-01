// What the E2E tests read or set in the browser (functions passed to page.evaluate or sw.evaluate).

/** Hook of the test copy's service worker (see SW_HOOK in support/browser.mjs). */
declare const __t: any;

interface Window {
  // set by support/instrument.mjs
  __csp: string[];
  __c: {
    bmp: number;
    bmpClosed: number;
    urls: number;
    revoked: number;
    urlLive: Set<string>;
    calls: Array<{ at: number; resize: boolean; crop: boolean }>;
  };
  __uiReady?: number;
  __failDb?: boolean | 'write';
  // set by the scenarios
  __clip?: ClipboardItem[];
  __hold?: Promise<void>;
  __xss?: number;
  __marker?: number;
  __sent?: unknown[];
  __closed: number; // popup test pages
  __created: unknown[]; // popup test pages: the tabs it asked for
  __answers: unknown[];
  __msgs?: unknown[];
  __mutations: number;
  __frames: number;
  __fr: { t: number[]; on: boolean; cards?: number };
  __sel?: unknown[]; // history view tests
  __q?: number;
  __up?: number;
  __ready?: boolean; // scroller test pages
  __h?: number;
  __violation: (directive: string) => void; // privacy test pages
  __make: (specs: Array<Record<string, any>>) => Promise<File[]>; // import test pages: File objects built in the page
  importScripts: (...urls: string[]) => void; // a worker has it, a page does not: the privacy test tries it in both
  chrome: any;
}
