import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardReader } from "../src/mk1/serial/board.ts";

const encoder = new TextEncoder();
const header = "this card on the board:";
const url = "https://keetsta.me/mk1/top#";
const first = Buffer.concat([Buffer.of(1), Buffer.alloc(39, 0xa1)]).toString("base64url");
const second = Buffer.concat([Buffer.of(1), Buffer.alloc(40, 0xb2)]).toString("base64url");

test("reads exact top output split across chunks and line endings", () => {
  const tokens: string[] = [];
  const reader = new BoardReader((token) => tokens.push(token));
  for (const byte of encoder.encode(`mk1> top\r\n${header}\r\n${url}${first}\r`)) {
    reader.feed(Uint8Array.of(byte));
  }
  assert.deepEqual(tokens, []);
  reader.feed(encoder.encode(`\nmk1> top\n${header}\n${url}${second}\nmk1> `));
  assert.deepEqual(tokens, [first, second]);
});

test("requires an exact header directly before a canonical result link", () => {
  const tokens: string[] = [];
  const reader = new BoardReader((token) => tokens.push(token));
  const unrelated = [
    `${url}${first}`,
    ` ${header}\n${url}${first}`,
    `${header}\nother output\n${url}${first}`,
    `${header}\n${url.replace("https", "http")}${first}`,
    ...["AQ", "B" + first.slice(1), first + "=", first.slice(0, -1) + "B", first + "\r\r"]
      .map((text) => `${header}\n${url}${text}`),
  ];
  reader.feed(encoder.encode(unrelated.join("\n") + "\n"));
  assert.deepEqual(tokens, []);
  reader.feed(encoder.encode(`${header}\n${header}\n${url}${first}\n`));
  assert.deepEqual(tokens, [first]);
});

test("recovers after oversized output and accepts the maximum firmware token", () => {
  const tokens: string[] = [];
  const reader = new BoardReader((token) => tokens.push(token));
  const maxToken = "AQ" + "A".repeat(2032);
  reader.feed(encoder.encode(`${header}\n${url}${"A".repeat(65536)}`));
  reader.feed(encoder.encode(`\n${url}${first}\n${header}\n${url}${maxToken}AA\n${header}\r\n${url}${maxToken}\r\n`));
  assert.deepEqual(tokens, [maxToken]);
});
