/* UF2, the RP2350's firmware file: 512-byte blocks of 256 bytes of flash each. */

const MAGIC0 = 0x0a324655, MAGIC1 = 0x9e5d5157, MAGIC_END = 0x0ab16f30;
const FLAG_NOT_MAIN_FLASH = 0x1, FLAG_FAMILY = 0x2000, FLAG_EXTENSIONS = 0x8000;

export const FAMILY = {
  rp2040: 0xe48bff56,
  absolute: 0xe48bff57,
  data: 0xe48bff58,
  rp2350ArmS: 0xe48bff59,
  rp2350Riscv: 0xe48bff5a,
} as const;

export const FLASH_BASE = 0x10000000;
export const SECTOR = 4096;
const FLASH_END = FLASH_BASE + 16 * 1024 * 1024;
export const SAVES_BASE = FLASH_END - 8 * SECTOR;
export const MAX_UF2_BYTES = 32 * 1024 * 1024;

export type Image = {
  /** 4 KB sectors to erase and write, ascending, each SECTOR bytes (gaps 0xff) */
  sectors: { addr: number; data: Uint8Array<ArrayBuffer> }[];
  bytes: number;
  family: number;
  safeToCopy: boolean;
};

export class Uf2Error extends Error {}

export function isWritableSector(addr: number): boolean {
  return Number.isInteger(addr) && addr % SECTOR === 0 && addr >= FLASH_BASE && addr + SECTOR <= SAVES_BASE;
}

export function parseUf2(file: Uint8Array): Image {
  if (file.length > MAX_UF2_BYTES) throw new Uf2Error("the firmware file is too large");
  if (file.length === 0 || file.length % 512) throw new Uf2Error("not a .uf2 file");
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const pages = new Map<number, Uint8Array>();
  let family = 0;
  let safeToCopy = true;
  for (let off = 0; off < file.length; off += 512) {
    const u = (i: number) => dv.getUint32(off + i, true);
    if (u(0) !== MAGIC0 || u(4) !== MAGIC1 || u(508) !== MAGIC_END) throw new Uf2Error("not a .uf2 file");
    const flags = u(8), addr = u(12), size = u(16), fam = u(28);
    if (flags & FLAG_NOT_MAIN_FLASH) continue;
    if (flags & FLAG_FAMILY) {
      if (fam === FAMILY.rp2040) throw new Uf2Error("this firmware is for the RP2040, the card is an RP2350");
      // E10 dummy page is only for the ROM's drive. Older releases put it inside the save journal.
      if (fam === FAMILY.absolute && size === 256 && (flags & FLAG_EXTENSIONS) && u(288) === 0x9957e304 &&
          (addr === FLASH_END - 256 || addr === SAVES_BASE - 256)) {
        if (addr >= SAVES_BASE) safeToCopy = false;
        continue;
      }
      if (fam !== FAMILY.rp2350ArmS && fam !== FAMILY.rp2350Riscv && fam !== FAMILY.absolute && fam !== FAMILY.data)
        throw new Uf2Error("this .uf2 is not for an RP2350");
      if (!family || family === FAMILY.absolute) family = fam;
    }
    if (size !== 256 || addr % 256) throw new Uf2Error("unexpected block layout in the .uf2");
    if (addr < FLASH_BASE || addr + 256 > FLASH_END) throw new Uf2Error("the .uf2 writes outside the flash");
    if (addr + 256 > SAVES_BASE) throw new Uf2Error("the .uf2 would overwrite the card's saved progress");
    const page = file.subarray(off + 32, off + 32 + 256);
    const previous = pages.get(addr);
    if (previous?.some((byte, i) => byte !== page[i])) throw new Uf2Error("the .uf2 contains conflicting pages");
    if (!previous) pages.set(addr, page);
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
  return { sectors: list, bytes: pages.size * 256, family, safeToCopy };
}
