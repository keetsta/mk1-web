const HEADER = "this card on the board:";
const URL_PREFIX = "https://keetsta.me/mk1/top#";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const TOKEN_MIN = Math.ceil((1 + 8 + 16) * 4 / 3);
const TOKEN_LIMIT = Math.ceil((1 + 8 + 1500 + 16) * 4 / 3); // TOKEN_BIN_MAX in the firmware
const LINE_LIMIT = URL_PREFIX.length + TOKEN_LIMIT + 1; // optional CR

export function isBoardToken(token: string): boolean {
  if (token.length < TOKEN_MIN || token.length > TOKEN_LIMIT || /[^A-Za-z0-9_-]/.test(token)) return false;
  const version = (ALPHABET.indexOf(token[0]) << 2) | (ALPHABET.indexOf(token[1]) >> 4);
  if (version !== 1) return false;
  const last = ALPHABET.indexOf(token[token.length - 1]);
  const tail = token.length % 4;
  return tail === 0 || (tail === 2 && (last & 15) === 0) || (tail === 3 && (last & 3) === 0);
}

export class BoardReader {
  private line: string | null = "";
  private waiting = false;
  private readonly onToken: (token: string) => void;

  constructor(onToken: (token: string) => void) {
    this.onToken = onToken;
  }

  feed(bytes: Uint8Array): void {
    for (const byte of bytes) {
      if (byte === 10) this.finishLine();
      else if (this.line !== null) {
        this.line = this.line.length < LINE_LIMIT ? this.line + String.fromCharCode(byte) : null;
      }
    }
  }

  private finishLine() {
    const line = this.line?.replace(/\r$/, "");
    const waiting = this.waiting;
    this.line = "";
    this.waiting = line === HEADER;
    if (!waiting || !line?.startsWith(URL_PREFIX)) return;
    const token = line.slice(URL_PREFIX.length);
    if (isBoardToken(token)) this.onToken(token);
  }
}
