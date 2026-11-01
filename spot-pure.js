// Pure logic of the spotlight (everything is dimmed except one or more areas): the shade. No DOM, no Fabric, testable with `node --test`.
// The areas themselves are drawn by shapes.js (Spot): each one is a clip, and the clips add up as an intersection, so the shade is painted
// once over the image without any of them, whatever their shape and however they overlap.

/** What the spotlight paints over everything outside its areas: black, at this opacity. */
export const SPOT_SHADE = 'rgba(0, 0, 0, 0.55)';
