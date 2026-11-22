import { test } from "node:test";
import assert from "node:assert/strict";
import { CMD, encodeCommand, Picoboot, rangeArgs } from "../src/mk1/flash/picoboot.ts";
import { FLASH_BASE, SAVES_BASE, SECTOR, type Image } from "../src/mk1/flash/uf2.ts";

test("a command packet is 32 bytes: magic, token, id, args size, transfer, args", () => {
  const p = encodeCommand(7, CMD.write, rangeArgs(0x10001000, 4096), 4096);
  const dv = new DataView(p.buffer);
  assert.equal(p.length, 32);
  assert.equal(dv.getUint32(0, true), 0x431fd10b);
  assert.equal(dv.getUint32(4, true), 7);
  assert.equal(p[8], 0x05);
  assert.equal(p[9], 8);
  assert.equal(dv.getUint32(12, true), 4096);
  assert.equal(dv.getUint32(16, true), 0x10001000);
  assert.equal(dv.getUint32(20, true), 4096);
});

/** a pretend bootloader: records what the page sends and answers every transfer with "ok" */
function fakeDevice(log: string[], verify = true) {
  const ok = { status: "ok" as const };
  const alternate = {
    interfaceClass: 0xff,
    endpoints: [
      { endpointNumber: 3, direction: "in", type: "bulk" },
      { endpointNumber: 4, direction: "out", type: "bulk" },
    ],
  };
  const written = new Map<number, Uint8Array>();
  let address = 0;
  return {
    vendorId: 0x2e8a,
    productId: 0x000f,
    serialNumber: "0102030405060708",
    configuration: {
      interfaces: [
        { interfaceNumber: 0, alternate: { interfaceClass: 8, endpoints: [] } },
        { interfaceNumber: 1, alternate },
      ],
    },
    open: async () => { log.push("open"); },
    selectConfiguration: async () => {},
    claimInterface: async (n: number) => { log.push(`claim ${n}`); },
    controlTransferOut: async (s: { request: number }) => { log.push(`ctrl ${s.request.toString(16)}`); return ok; },
    controlTransferIn: async () => ({ ...ok, data: new DataView(new ArrayBuffer(16)) }),
    transferOut: async (ep: number, data: Uint8Array) => {
      if (data.length === 32 && new DataView(data.buffer).getUint32(0, true) === 0x431fd10b) {
        address = new DataView(data.buffer).getUint32(16, true);
        log.push(`cmd ${data[8].toString(16)} @${address.toString(16)}`);
      } else {
        if (data.length) written.set(address, Uint8Array.from(data));
        log.push(`out ${ep} ${data.length}`);
      }
      return { ...ok, bytesWritten: data.length };
    },
    transferIn: async (ep: number, length: number) => {
      log.push(`in ${ep}`);
      const bytes = length === SECTOR ? Uint8Array.from(written.get(address)!) : new Uint8Array(0);
      if (!verify && bytes.length) bytes[0] ^= 1;
      return { ...ok, data: new DataView(bytes.buffer) };
    },
    releaseInterface: async () => {},
    close: async () => { log.push("close"); },
  };
}

test("flashing: exclusive, leave XIP, erase+write each sector, reboot; acks go the other way", async () => {
  const log: string[] = [];
  const dev = fakeDevice(log);
  const pb = await Picoboot.open(dev as unknown as USBDevice, "0102030405060708");
  const image: Image = {
    sectors: [0, 1].map((i) => ({ addr: FLASH_BASE + i * SECTOR, data: new Uint8Array(SECTOR) })),
    bytes: 2 * SECTOR,
    family: 0,
    safeToCopy: true,
  };
  const progress: number[] = [];
  await pb.flash(image, (p) => progress.push(p));
  await pb.close();
  assert.deepEqual(log, [
    "open", "claim 1", "ctrl 41",
    "cmd 1 @1", "in 3",
    "cmd 6 @0", "in 3",
    "cmd 3 @10000000", "in 3",
    "cmd 5 @10000000", "out 4 4096", "in 3",
    "cmd 84 @10000000", "in 3", "out 4 0",
    "cmd 3 @10001000", "in 3",
    "cmd 5 @10001000", "out 4 4096", "in 3",
    "cmd 84 @10001000", "in 3", "out 4 0",
    "cmd a @0", "in 3",
    "close",
  ]);
  assert.deepEqual(progress, [0.5, 1]);
});

test("mismatched bootloader is rejected before opening it, and reserved sectors before any command", async () => {
  const log: string[] = [];
  const dev = fakeDevice(log) as unknown as USBDevice;
  await assert.rejects(Picoboot.open(dev, "9999999999999999"), /does not match/);
  assert.deepEqual(log, []);
  const pb = await Picoboot.open(dev, "0102030405060708");
  const sectors = [FLASH_BASE, SAVES_BASE].map((addr) => ({ addr, data: new Uint8Array(SECTOR) }));
  await assert.rejects(pb.flash({ sectors, bytes: 2 * SECTOR, family: 0, safeToCopy: false }, () => {}), /reserved/);
  assert.deepEqual(log, ["open", "claim 1", "ctrl 41"]);
  await pb.close();
});

test("a mismatched readback prevents reboot", async () => {
  const log: string[] = [];
  const pb = await Picoboot.open(fakeDevice(log, false) as unknown as USBDevice, null);
  const sectors = [{ addr: FLASH_BASE, data: new Uint8Array(SECTOR) }];
  await assert.rejects(pb.flash({ sectors, bytes: SECTOR, family: 0, safeToCopy: true }, () => {}), /verification failed/);
  assert.ok(!log.includes("cmd a @0"));
  await pb.close();
});
