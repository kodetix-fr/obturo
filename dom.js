// The elements of library.html that the editor drives, looked up once at import and typed. The editor is imported
// after the page has loaded: the elements exist. A missing id (or one of another kind) throws a clear error right
// away, instead of a "cannot read properties of null" later.
import { byId } from './dom-i18n.js';

export const dom = {
  // Toolbar
  ui: byId('ui', HTMLFieldSetElement), // disabled until a shot is open
  tools: [.../** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#tools [data-tool]'))],
  lineProps: byId('lineProps'), // color and stroke (rectangle, arrow, text)
  color: byId('color', HTMLInputElement), // the free line color
  lineSwatches: byId('lineSwatches'), // radio group, filled by panel.js (as the other swatches)
  strokeField: byId('strokeField'), // the thin / medium / thick choice
  thick: byId('thick'), // radio group (stroke width, or the size of a marker)
  thickLabel: byId('thickLabel'), // its label: "Stroke", or "Size" for a marker
  textProps: byId('textProps'),
  font: byId('font', HTMLSelectElement),
  size: byId('size', HTMLInputElement),
  bold: byId('bold', HTMLButtonElement),
  italic: byId('italic', HTMLButtonElement),
  underline: byId('underline', HTMLButtonElement),
  bgSwatches: byId('bgSwatches'), // text background: "none", then the palette
  bgColor: byId('bgColor', HTMLInputElement),
  markerProps: byId('markerProps'), // numbered marker: edit its text, the side of the text
  legendEdit: byId('legendEdit', HTMLButtonElement),
  sidePick: byId('sidePick'), // radio group
  highlightProps: byId('highlightProps'), // highlighter: swatches
  hlSwatches: byId('hlSwatches'), // radio group, filled by panel.js
  hlColor: byId('hlColor', HTMLInputElement),
  spotProps: byId('spotProps'), // spotlight: a hint
  flatProps: byId('flatProps'), // solid fill: swatches and free color
  swatches: byId('swatches'), // radio group, filled by panel.js
  flatColor: byId('flatColor', HTMLInputElement),
  pixelProps: byId('pixelProps'),
  block: byId('block', HTMLInputElement),
  blurProps: byId('blurProps'),
  blur: byId('blur', HTMLInputElement),
  undo: byId('undo', HTMLButtonElement),
  redo: byId('redo', HTMLButtonElement),
  del: byId('del', HTMLButtonElement),
  copy: byId('copy', HTMLButtonElement),
  copyLabel: byId('copyLabel'),
  download: byId('download', HTMLButtonElement),
  downloadFmt: byId('downloadFmt'), // the format a click on Download produces (export)
  downloadMenu: byId('downloadMenu', HTMLButtonElement), // the caret that opens the format menu (export)
  beautify: byId('beautify', HTMLButtonElement), // opens the beautify panel; marked when the displayed version has a look
  // Versions, crop, scale, zoom
  versions: byId('versions'),
  newVersion: byId('newVersion', HTMLButtonElement),
  delVersion: byId('delVersion', HTMLButtonElement),
  crop: byId('crop', HTMLButtonElement),
  shapeProps: byId('shapeProps'), // the shape of an area
  shapePick: byId('shapePick'), // radio group
  cropGroup: byId('cropGroup'), // Apply and Cancel, shown while a crop is in progress
  cropOk: byId('cropOk', HTMLButtonElement),
  cropCancel: byId('cropCancel', HTMLButtonElement),
  cropClear: byId('cropClear', HTMLButtonElement),
  scalePct: byId('scalePct', HTMLInputElement),
  scaleW: byId('scaleW', HTMLInputElement),
  out: byId('out'),
  outNote: byId('outNote'),
  fit: byId('fit', HTMLButtonElement),
  actual: byId('actual', HTMLButtonElement),
  zoomLabel: byId('zoomLabel'),
  // Editing area
  stageMsg: byId('stageMsg'),
};
