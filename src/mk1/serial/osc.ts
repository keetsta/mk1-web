/* The card talks to the page inside its terminal stream (mk1-shell SPEC.md, "протокол страницы"):
   OSC 7777 sequences carry the matrix frames. OscSplitter takes them out of the byte stream before the
   terminal sees it; everything else, other OSCs included, goes on to the terminal untouched. */

const ESC = 0x1b, BEL = 0x07, OSC_OPEN = 0x5d /* ] */, ST_END = 0x5c /* \ */;
const MAX = 256;

export type CardMessage =
  /** protocol version, and the firmware's own (MK1_VERSION; a release is tagged v<firmware>) */
  | { kind: "hello"; version: number; firmware: string | null }
  | { kind: "frame"; rows: Uint16Array };

export const HELLO = new TextEncoder().encode("\x1b]7777;hello\x07");
export const BYE = new TextEncoder().encode("\x1b]7777;bye\x07");

/** "7777;f;<36 hex>" or "7777;mk1;<protocol>[;<firmware>]"; anything else is not ours */
export function parseOsc(body: string): CardMessage | null {
  const p = body.split(";");
  if (p[0] !== "7777") return null;
  if (p[1] === "mk1" && (p.length === 3 || p.length === 4)) {
    const version = Number(p[2]);
    const firmware = p.length === 4 && /^\d+\.\d+\.\d+$/.test(p[3]) ? p[3] : null;
    return Number.isInteger(version) ? { kind: "hello", version, firmware } : null;
  }
  if (p[1] === "f" && p.length === 3 && /^[0-9a-f]{36}$/i.test(p[2])) {
    const rows = new Uint16Array(9);
    for (let r = 0; r < 9; r++) rows[r] = parseInt(p[2].slice(r * 4, r * 4 + 4), 16);
    return { kind: "frame", rows };
  }
  return null;
}

export class OscSplitter {
  private state = 0; // 0 text, 1 ESC, 2 inside an OSC, 3 ESC inside an OSC
  private body: number[] = [];
  private readonly onMessage: (m: CardMessage) => void;

  constructor(onMessage: (m: CardMessage) => void) {
    this.onMessage = onMessage;
  }

  /** returns the bytes meant for the terminal */
  push(chunk: Uint8Array): Uint8Array {
    const out: number[] = [];
    for (const b of chunk) {
      switch (this.state) {
        case 0:
          if (b === ESC) this.state = 1;
          else out.push(b);
          break;
        case 1:
          if (b === OSC_OPEN) {
            this.state = 2;
            this.body = [];
          } else if (b === ESC) {
            out.push(ESC); // the first ESC was a lone one; the new one may still open an OSC
          } else {
            out.push(ESC, b);
            this.state = 0;
          }
          break;
        case 2:
          if (b === BEL) this.finish(out, [BEL]);
          else if (b === ESC) this.state = 3;
          else if (this.body.length < MAX) this.body.push(b);
          else this.giveUp(out, [b]);
          break;
        case 3:
          if (b === ST_END) this.finish(out, [ESC, ST_END]);
          else this.giveUp(out, [ESC, b]);
          break;
      }
    }
    return Uint8Array.from(out);
  }

  private finish(out: number[], end: number[]) {
    this.state = 0;
    const text = String.fromCharCode(...this.body);
    const m = parseOsc(text);
    if (m) this.onMessage(m);
    else out.push(ESC, OSC_OPEN, ...this.body, ...end); // someone else's OSC: the terminal's business
  }

  private giveUp(out: number[], rest: number[]) {
    this.state = 0;
    out.push(ESC, OSC_OPEN, ...this.body, ...rest);
  }
}
