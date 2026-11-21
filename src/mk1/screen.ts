/* What the card's 16×9 matrix shows: a level per LED, 0 dark to 1 fully lit as the eye sees it, row 0 on top,
   left to right. The card sends levels (its idle screen, pong, the cube fade in and out); the shell's own
   matrix is on or off. */

export type Screen = Float32Array;

export const LEDS = 16 * 9;

export const dark = (): Screen => new Float32Array(LEDS);

/** how far toward its lit colour an LED is drawn. On the card any light stands out against the unlit LED; on
 *  a screen a lit LED is only a colour mixed over the pale lens, and a third of the way to red reads as nearly
 *  off (half the cube's lit LEDs are a third lit or less). The square root lifts the low levels and leaves off
 *  and full, the shell's only two, where they are */
export const drawn = (level: number) => Math.sqrt(level);

/** the shell's matrix: 9 rows, bit 15 = leftmost column */
export function fromRows(rows: ArrayLike<number>): Screen {
  const s = dark();
  for (let i = 0; i < LEDS; i++) s[i] = (rows[i >> 4] >> (15 - (i & 15))) & 1;
  return s;
}
