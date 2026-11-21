/* The card over Web Serial: the terminal's bytes both ways, with the page's frames taken out of them. */

import { BYE, HELLO, OscSplitter, type CardMessage } from "./osc";

/** the card's firmware enumerates under Raspberry Pi's vendor id with pico-sdk's own product id, as every
 *  pico-sdk board does: the filter lets any of them through, and only the card's hello tells them apart */
const CARD_FILTER: SerialPortFilter = { usbVendorId: 0x2e8a };

export type Trouble =
  | "unsupported" // no Web Serial: Safari, Firefox before 151, phones
  | "insecure" // not https
  | "blocked" // a policy or an embedding frame forbids it
  | "busy" // the port won't open: screen or another tab holds it, or no permission (Linux)
  | "lost"; // the card went away mid-session

export class LinkError extends Error {
  readonly trouble: Trouble;
  constructor(trouble: Trouble, message: string) {
    super(message);
    this.trouble = trouble;
  }
}

export function serialTrouble(): Trouble | null {
  if (!window.isSecureContext) return "insecure";
  if (!("serial" in navigator)) return "unsupported";
  return null;
}

/** the port this site was allowed before, if it is the only one plugged in. with two (two cards, or a card and
 *  another board) the visitor picks: taking the first would open the wrong one, or the one another tab holds */
export async function knownCard(): Promise<SerialPort | null> {
  const known = (await navigator.serial.getPorts()).filter((p) => p.getInfo().usbVendorId === CARD_FILTER.usbVendorId);
  return known.length === 1 ? known[0] : null;
}

/** the browser's picker; null if it was closed */
export async function askCard(): Promise<SerialPort | null> {
  try {
    return await navigator.serial.requestPort({ filters: [CARD_FILTER] });
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") return null;
    if (e instanceof DOMException && e.name === "SecurityError") throw new LinkError("blocked", e.message);
    throw e;
  }
}

export type CardLink = {
  write(bytes: Uint8Array): void;
  close(): Promise<void>;
  /** restarts the card into its bootloader: the 1200-baud touch its firmware listens for */
  bootloader(): Promise<void>;
};

export type CardEvents = {
  text(bytes: Uint8Array): void;
  message(m: CardMessage): void;
  /** lost: the card went away, rather than the page closing it */
  closed(lost: boolean): void;
};

export async function openCard(port: SerialPort, on: CardEvents): Promise<CardLink> {
  try {
    await port.open({ baudRate: 115200 });
  } catch (e) {
    throw new LinkError("busy", e instanceof Error ? e.message : String(e));
  }
  const splitter = new OscSplitter(on.message);
  const reader = port.readable!.getReader();
  const writer = port.writable!.getWriter();
  let closing = false;
  const reading = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = splitter.push(value);
        if (text.length) on.text(text);
      }
    } catch {
      /* the card was unplugged */
    } finally {
      reader.releaseLock();
    }
    if (!closing) {
      closing = true;
      writer.releaseLock();
      await port.close().catch(() => {});
      on.closed(true);
    }
  })();
  let queue = Promise.resolve();
  const write = (bytes: Uint8Array) => {
    queue = queue.then(() => writer.write(bytes)).catch(() => {});
  };
  const shut = async () => {
    closing = true;
    await queue;
    await reader.cancel().catch(() => {});
    await reading;
    writer.releaseLock();
    await port.close().catch(() => {});
  };
  write(HELLO);
  return {
    write,
    async close() {
      if (closing) return;
      write(BYE);
      await shut();
      on.closed(false);
    },
    async bootloader() {
      if (!closing) await shut();
      await port.open({ baudRate: 1200 });
      await port.close();
      on.closed(false);
    },
  };
}
