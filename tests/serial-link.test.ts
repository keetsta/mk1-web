import assert from "node:assert/strict";
import { test } from "node:test";
import { openCard } from "../src/mk1/serial/link.ts";

const CHIP = "0102030405060708";
const encoder = new TextEncoder();

function serialPort(identity = "") {
  const speeds: number[] = [];
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    async open({ baudRate }: { baudRate: number }) {
      speeds.push(baudRate);
      if (baudRate === 1200) return;
      let input!: ReadableStreamDefaultController<Uint8Array>;
      this.readable = new ReadableStream({ start: (controller) => { input = controller; } });
      this.writable = new WritableStream({
        write(bytes) {
          const text = new TextDecoder().decode(bytes);
          if (text.includes("7777;hello")) {
            input.enqueue(encoder.encode("\x1b]7777;mk1;2;0.1.2\x07" + identity));
          } else {
            const request = /^\x1b\]7777;nick;([0-9a-f]{32});([0-9a-f]+)\x07$/.exec(text);
            if (request) {
              assert.equal(request[2], "74657374");
              input.enqueue(encoder.encode("\x1b]7777;nick;" + request[1] + ";" + "b".repeat(64) + "\x07"));
            }
          }
        },
      });
    },
    async close() {},
  };
  return { port: port as unknown as SerialPort, speeds };
}

const events = { text() {}, message() {}, closed() {} };

test("a serial hello by itself never authorizes the bootloader touch", async () => {
  const { port, speeds } = serialPort();
  const link = await openCard(port, events);
  assert.equal(await link.bootloader(), null);
  assert.deepEqual(speeds, [115200]);
  await link.close();
});

test("binds the bootloader to the identified chip and carries nickname confirmation", async () => {
  const { port, speeds } = serialPort("\x1b]7777;chip;" + CHIP + "\x07");
  const link = await openCard(port, events);
  assert.equal(await link.identify(), CHIP);
  assert.equal(await link.signNickname("a".repeat(32), "test"), "b".repeat(64));
  assert.equal(await link.bootloader(), CHIP);
  assert.deepEqual(speeds, [115200, 1200]);
});
