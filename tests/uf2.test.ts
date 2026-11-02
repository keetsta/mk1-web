import { test } from "node:test";
import assert from "node:assert/strict";
import { FAMILY, parseUf2, Uf2Error } from "../src/mk1/flash/uf2.ts";

function block(addr: number, family: number, fill: number, flags = 0x2000): Uint8Array {
  const b = new Uint8Array(512);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 0x0a324655, true);
  dv.setUint32(4, 0x9e5d5157, true);
  dv.setUint32(8, flags, true);
  dv.setUint32(12, addr, true);
  dv.setUint32(16, 256, true);
  dv.setUint32(28, family, true);
  b.fill(fill, 32, 32 + 256);
  dv.setUint32(508, 0x0ab16f30, true);
  return b;
}
const cat = (...bs: Uint8Array[]) => Uint8Array.from(bs.flatMap((b) => [...b]));

test("pages land in 4 KB sectors, gaps stay erased", () => {
  const img = parseUf2(cat(
    block(0x10000000, FAMILY.rp2350ArmS, 1),
    block(0x10000100, FAMILY.rp2350ArmS, 2),
    block(0x10001f00, FAMILY.rp2350ArmS, 3),
  ));
  assert.equal(img.family, FAMILY.rp2350ArmS);
  assert.equal(img.bytes, 768);
  assert.deepEqual(img.sectors.map((s) => s.addr), [0x10000000, 0x10001000]);
  assert.equal(img.sectors[0].data[0], 1);
  assert.equal(img.sectors[0].data[0x100], 2);
  assert.equal(img.sectors[0].data[0x200], 0xff);
  assert.equal(img.sectors[1].data[0xf00], 3);
});

test("picotool's E10 block is skipped, RP2040 images are refused", () => {
  const img = parseUf2(cat(block(0x10ffff00, FAMILY.absolute, 0), block(0x10000000, FAMILY.rp2350ArmS, 7)));
  assert.equal(img.sectors.length, 1);
  assert.equal(img.family, FAMILY.rp2350ArmS);
  assert.throws(() => parseUf2(block(0x10000000, FAMILY.rp2040, 0)), /RP2040/);
  assert.throws(() => parseUf2(new Uint8Array(100)), Uf2Error);
  assert.throws(() => parseUf2(block(0x20000000, FAMILY.rp2350ArmS, 0)), /outside the flash/);
});
