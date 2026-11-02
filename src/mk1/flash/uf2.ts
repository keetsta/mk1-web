/* UF2, the RP2350's firmware file: 512-byte blocks of 256 bytes of flash each. */

const MAGIC0 = 0x0a324655, MAGIC1 = 0x9e5d5157, MAGIC_END = 0x0ab16f30;
const FLAG_NOT_MAIN_FLASH = 0x1, FLAG_FAMILY = 0x2000;

export const FAMILY = {
  rp2040: 0xe48bff56,
  absolute: 0xe48bff57,
  data: 0xe48bff58,
  rp2350ArmS: 0xe48bff59,
  rp2350Riscv: 0xe48bff5a,
} as const;

export const FLASH_BASE = 0x10000000;
export const SECTOR = 4096;

export type Image = {
  /** 4 KB sectors to erase and write, ascending, each SECTOR bytes (gaps 0xff) */
  sectors: { addr: number; data: Uint8Array<ArrayBuffer> }[];
  bytes: number;
  family: number;
};

export class Uf2Error extends Error {}

export function parseUf2(file: Uint8Array): Image {
  if (file.length === 0 || file.length % 512) throw new Uf2Error("not a .uf2 file");
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const pages = new Map<number, Uint8Array>();
  let family = 0;
  for (let off = 0; off < file.length; off += 512) {
    const u = (i: number) => dv.getUint32(off + i, true);
    if (u(0) !== MAGIC0 || u(4) !== MAGIC1 || u(508) !== MAGIC_END) throw new Uf2Error("not a .uf2 file");
    const flags = u(8), addr = u(12), size = u(16), fam = u(28);
    if (flags & FLAG_NOT_MAIN_FLASH) continue;
    if (flags & FLAG_FAMILY) {
      if (fam === FAMILY.rp2040) throw new Uf2Error("this firmware is for the RP2040, the card is an RP2350");
      // picotool's RP2350-E10 workaround: one absolute block at the very end of a 16 MB flash, only for
      // drag-and-drop onto the bootloader's drive; written over PICOBOOT it would just wipe a sector
      if (fam === FAMILY.absolute && addr >= FLASH_BASE + 0xffff00) continue;
      if (fam !== FAMILY.rp2350ArmS && fam !== FAMILY.rp2350Riscv && fam !== FAMILY.absolute && fam !== FAMILY.data)
        throw new Uf2Error("this .uf2 is not for an RP2350");
      if (!family || family === FAMILY.absolute) family = fam;
    }
    if (size !== 256 || addr % 256) throw new Uf2Error("unexpected block layout in the .uf2");
    if (addr < FLASH_BASE || addr + 256 > FLASH_BASE + 0x1000000) throw new Uf2Error("the .uf2 writes outside the flash");
    pages.set(addr, file.slice(off + 32, off + 32 + 256));
  }
  if (!pages.size) throw new Uf2Error("the .uf2 is empty");
  const sectors = new Map<number, Uint8Array<ArrayBuffer>>();
  for (const [addr, page] of pages) {
    const base = addr - (addr % SECTOR);
    let s = sectors.get(base);
    if (!s) sectors.set(base, (s = new Uint8Array(SECTOR).fill(0xff)));
    s.set(page, addr - base);
  }
  const list = [...sectors].sort((a, b) => a[0] - b[0]).map(([addr, data]) => ({ addr, data }));
  return { sectors: list, bytes: pages.size * 256, family };
}
