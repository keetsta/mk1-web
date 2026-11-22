/* Flashing the RP2350 from the browser: WebUSB to the bootloader's PICOBOOT interface, the one picotool
   uses. The card must be in BOOTSEL (the page asks the running firmware with a 1200-baud touch, or the
   button is held while plugging in). Protocol: RP2350 datasheet, "PICOBOOT interface". */

import { isWritableSector, SECTOR, type Image } from "./uf2.ts";

export const RP2350_BOOT = { vendorId: 0x2e8a, productId: 0x000f } as const;

const MAGIC = 0x431fd10b;
export const CMD = {
  exclusive: 0x01,
  erase: 0x03,
  read: 0x84,
  write: 0x05,
  exitXip: 0x06,
  reboot2: 0x0a,
} as const;
const IF_RESET = 0x41, IF_STATUS = 0x42;
const EXCLUSIVE = 1;
const REBOOT_NORMAL = 0x0;

/** struct picoboot_cmd: magic, token, id, args size, transfer length, 16 bytes of args */
export function encodeCommand(token: number, id: number, args: Uint8Array, transfer: number): Uint8Array<ArrayBuffer> {
  if (args.length > 16) throw new Error("PICOBOOT args are at most 16 bytes");
  const b = new Uint8Array(32);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, token >>> 0, true);
  b[8] = id;
  b[9] = args.length;
  dv.setUint32(12, transfer >>> 0, true);
  b.set(args, 16);
  return b;
}

function words(...v: number[]): Uint8Array {
  const b = new Uint8Array(v.length * 4);
  const dv = new DataView(b.buffer);
  v.forEach((x, i) => dv.setUint32(i * 4, x >>> 0, true));
  return b;
}
export const rangeArgs = (addr: number, size: number) => words(addr, size);

export class PicobootError extends Error {}

export class Picoboot {
  private token = 1;
  private readonly dev: USBDevice;
  private readonly iface: number;
  private readonly epIn: number;
  private readonly epOut: number;

  private constructor(dev: USBDevice, iface: number, epIn: number, epOut: number) {
    this.dev = dev;
    this.iface = iface;
    this.epIn = epIn;
    this.epOut = epOut;
  }

  static async open(dev: USBDevice, expectedChip: string | null): Promise<Picoboot> {
    if (dev.vendorId !== RP2350_BOOT.vendorId || dev.productId !== RP2350_BOOT.productId ||
        (expectedChip !== null && dev.serialNumber?.toLowerCase() !== expectedChip)) {
      throw new PicobootError("the selected bootloader does not match the card");
    }
    await dev.open();
    try {
      if (!dev.configuration) await dev.selectConfiguration(1);
      for (const it of dev.configuration!.interfaces) {
        const alt = it.alternate;
        const bulkIn = alt.endpoints.find((e) => e.type === "bulk" && e.direction === "in");
        const bulkOut = alt.endpoints.find((e) => e.type === "bulk" && e.direction === "out");
        if (alt.interfaceClass === 0xff && bulkIn && bulkOut) {
          await dev.claimInterface(it.interfaceNumber);
          const reset = await dev.controlTransferOut({
            requestType: "vendor", recipient: "interface", request: IF_RESET, value: 0, index: it.interfaceNumber,
          });
          if (reset.status !== "ok") throw new PicobootError("could not reset the bootloader");
          return new Picoboot(dev, it.interfaceNumber, bulkIn.endpointNumber, bulkOut.endpointNumber);
        }
      }
      throw new PicobootError("no PICOBOOT interface on this device");
    } catch (error) {
      await dev.close().catch(() => {});
      throw error;
    }
  }

  private async status(what: string): Promise<never> {
    let code = "?";
    try {
      const r = await this.dev.controlTransferIn(
        { requestType: "vendor", recipient: "interface", request: IF_STATUS, value: 0, index: this.iface }, 16);
      if (r.data) code = String(r.data.getUint32(4, true));
    } catch { /* the status is a nicety */ }
    throw new PicobootError(`the bootloader refused ${what} (status ${code})`);
  }

  private async command(id: number, args: Uint8Array, what: string, data?: Uint8Array<ArrayBuffer>, readLength = 0) {
    const transfer = data ? data.length : readLength;
    const sent = await this.dev.transferOut(this.epOut, encodeCommand(this.token++, id, args, transfer));
    if (sent.status !== "ok" || sent.bytesWritten !== 32) return this.status(what);
    let result: DataView | undefined;
    if (transfer) {
      if (id & 0x80) {
        const r = await this.dev.transferIn(this.epIn, transfer);
        if (r.status !== "ok" || r.data?.byteLength !== transfer) return this.status(what);
        result = r.data;
      } else {
        const r = await this.dev.transferOut(this.epOut, data!);
        if (r.status !== "ok" || r.bytesWritten !== transfer) return this.status(what);
      }
    }
    // the command's status is a zero-length packet the other way
    if (id & 0x80) {
      const r = await this.dev.transferOut(this.epOut, new Uint8Array(0));
      if (r.status !== "ok" || r.bytesWritten !== 0) return this.status(what);
    } else {
      const r = await this.dev.transferIn(this.epIn, 64);
      if (r.status !== "ok" || r.data?.byteLength !== 0) return this.status(what);
    }
    return result;
  }

  /** erase and write every sector of the image, then boot it */
  async flash(image: Image, progress: (done: number) => void): Promise<void> {
    if (!image.sectors.length || image.sectors.some((s) => !isWritableSector(s.addr) || s.data.length !== SECTOR)) {
      throw new PicobootError("the image contains an invalid or reserved flash sector");
    }
    await this.command(CMD.exclusive, Uint8Array.of(EXCLUSIVE), "exclusive access");
    await this.command(CMD.exitXip, new Uint8Array(0), "leaving XIP");
    let i = 0;
    for (const s of image.sectors) {
      await this.command(CMD.erase, rangeArgs(s.addr, SECTOR), `erasing ${hex(s.addr)}`);
      await this.command(CMD.write, rangeArgs(s.addr, SECTOR), `writing ${hex(s.addr)}`, s.data);
      const written = await this.command(CMD.read, rangeArgs(s.addr, SECTOR), `reading ${hex(s.addr)}`, undefined, SECTOR);
      if (!written || s.data.some((byte, offset) => byte !== written.getUint8(offset))) {
        throw new PicobootError(`verification failed at ${hex(s.addr)}`);
      }
      progress(++i / image.sectors.length);
    }
    await this.command(CMD.reboot2, words(REBOOT_NORMAL, 500, 0, 0), "the reboot");
  }

  async close(): Promise<void> {
    try { await this.dev.releaseInterface(this.iface); } catch { /* gone after the reboot */ }
    try { await this.dev.close(); } catch { /* same */ }
  }
}

const hex = (n: number) => "0x" + n.toString(16).padStart(8, "0");
