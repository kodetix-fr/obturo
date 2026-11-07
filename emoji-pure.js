// The emoji the editor places, as code points (the source stays ASCII). No DOM, no Fabric.

/** One entry per emoji: its code points, joined by `-`. */
const CODE_POINTS = [
  '1F44D', '1F44E', '2705', '274C', '26A0-FE0F', '2753', '2757', '2B50', '1F525', '1F4A1',
  '1F41B', '1F6AB', '1F440', '1F3AF', '1F600', '1F615', '1F621', '1F389', '2764-FE0F', '1F449',
];

/** The emoji of the picker, in order. */
export const EMOJIS = CODE_POINTS.map((entry) => String.fromCodePoint(...entry.split('-').map((hex) => parseInt(hex, 16))));
export const DEFAULT_EMOJI = EMOJIS[0];

/** The font stack that draws them: the color emoji of each system, then whatever has the glyph. */
export const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** @param {unknown} value An emoji of the picker, or the first one for anything else. */
export const cleanEmoji = (value) => EMOJIS.find((e) => e === value) ?? DEFAULT_EMOJI;
