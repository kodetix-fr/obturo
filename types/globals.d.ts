// What fullpage.js sets on the window of the captured page (isolated world of the extension) and what sw.js calls
// through chrome.scripting.executeScript.

/** A box in the window, in CSS px. */
interface FullPageBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What begin() finds: the document, and the elements that scroll under the window (see pickScroller in pure.js). */
interface FullPageScan {
  /** Window size at the start, in CSS px. */
  vw: number;
  vh: number;
  /** Display scale (devicePixelRatio). */
  dpr: number;
  /** The document: can the user scroll it, and how far (scrollHeight - clientHeight). */
  doc: { user: boolean; max: number };
  /** The share of the window (0 to 1) that the biggest frame shows: what a frame shows is captured as it shows. */
  frame: number;
  /** Elements that scroll vertically: client box in the window, and how far they scroll. */
  cands: Array<FullPageBox & { max: number }>;
}

/** What aim() takes as the target of the capture (the document or one of the candidates). */
interface FullPageMeasure {
  /** Where the target shows its content, in the window. */
  box: FullPageBox;
  /** How far it scrolls, in CSS px (the capture is `max` + the visible height of `box` high). */
  max: number;
  /** Window size at the start: used to detect a resize or a zoom change. */
  vw: number;
  vh: number;
  /** Display scale (devicePixelRatio). */
  dpr: number;
}

/** Result of positioning on a tile. */
interface FullPageStep {
  /** ACTUAL scroll position (the browser clamps the last tile). */
  y: number;
  /** Escape was pressed during the capture. */
  cancelled: boolean;
  vh: number;
  /** How far the target scrolls now: it grows with lazy loading. */
  max: number;
  /** Where the target shows its content now: the SW checks that it did not move. */
  box: FullPageBox;
}

interface FullPageApi {
  begin(options?: { wait?: number; fixed?: string }): FullPageScan;
  aim(index: number): FullPageMeasure;
  go(y: number, phase: 'first' | 'mid' | 'last'): Promise<FullPageStep>;
  size(): { max: number };
  end(): boolean;
}

/** What redact.js sets on the window of the captured page, and sw.js calls. */
interface RedactApi {
  apply(region?: FullPageBox): Promise<void>;
  clear(): void;
  result(): { hidden: number; incomplete: boolean };
}

interface Window {
  __obturoFull?: FullPageApi;
  __obturoRedact?: RedactApi;
}

/** What sensitive.js sets on the global object: the parts of a text to hide. */
declare var __obturoSensitive: { find(text: string): Array<{ start: number; end: number; kind: string }> };
