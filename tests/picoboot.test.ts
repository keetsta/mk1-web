import { test } from "node:test";
import assert from "node:assert/strict";
import { CMD, encodeCommand, Picoboot, rangeArgs } from "../src/mk1/flash/picoboot.ts";
import { FLASH_BASE, SECTOR, type Image } from "../src/mk1/flash/uf2.ts";

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
function fakeDevice(log: string[]) {
  const ok = { status: "ok" as const };
  return {
    configuration: {
      interfaces: [
        { interfaceNumber: 0, alternates: [{ interfaceClass: 8, endpoints: [] }] },
        {
          interfaceNumber: 1,
          alternates: [{
            interfaceClass: 0xff,
            endpoints: [
              { endpointNumber: 3, direction: "in", type: "bulk" },
              { endpointNumber: 4, direction: "out", type: "bulk" },
            ],
          }],
        },
      ],
    },
    open: async () => { log.push("open"); },
    selectConfiguration: async () => {},
    claimInterface: async (n: number) => { log.push(`claim ${n}`); },
    controlTransferOut: async (s: { request: number }) => { log.push(`ctrl ${s.request.toString(16)}`); return ok; },
    controlTransferIn: async () => ({ ...ok, data: new DataView(new ArrayBuffer(16)) }),
    transferOut: async (ep: number, data: Uint8Array) => {
      if (data.length === 32 && new DataView(data.buffer).getUint32(0, true) === 0x431fd10b)
        log.push(`cmd ${data[8].toString(16)} @${new DataView(data.buffer).getUint32(16, true).toString(16)}`);
      else log.push(`out ${ep} ${data.length}`);
      return { ...ok, bytesWritten: data.length };
    },
    transferIn: async (ep: number) => { log.push(`in ${ep}`); return { ...ok, data: new DataView(new ArrayBuffer(0)) }; },
    releaseInterface: async () => {},
    close: async () => { log.push("close"); },
  };
}

test("flashing: exclusive, leave XIP, erase+write each sector, reboot; acks go the other way", async () => {
  const log: string[] = [];
  const dev = fakeDevice(log);
  const pb = await Picoboot.open(dev as unknown as USBDevice);
  const image: Image = {
    sectors: [0, 1].map((i) => ({ addr: FLASH_BASE + i * SECTOR, data: new Uint8Array(SECTOR) })),
    bytes: 2 * SECTOR,
    family: 0,
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
    "cmd 3 @10001000", "in 3",
    "cmd 5 @10001000", "out 4 4096", "in 3",
    "cmd a @0", "in 3",
    "close",
  ]);
  assert.deepEqual(progress, [0.5, 1]);
});
