import { test } from "node:test";
import assert from "node:assert/strict";
import { OscSplitter, parseOsc, type CardMessage } from "../src/mk1/serial/osc.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

test("frames are taken out, text goes through", () => {
  const got: CardMessage[] = [];
  const sp = new OscSplitter((m) => got.push(m));
  const out = sp.push(enc("mk1> \x1b]7777;f;ffff00000000000000000000000000000000;440\x07help\r\n"));
  assert.equal(dec(out), "mk1> help\r\n");
  assert.equal(got.length, 1);
  const f = got[0];
  assert.ok(f.kind === "frame" && f.rows[0] === 0xffff && f.rows[8] === 0 && f.hz === 440);
});

test("a frame split across chunks, ended by ESC \\", () => {
  const got: CardMessage[] = [];
  const sp = new OscSplitter((m) => got.push(m));
  let text = "";
  for (const ch of "a\x1b]7777;mk1;1;0.1.0\x1b\\b") text += dec(sp.push(enc(ch)));
  assert.equal(text, "ab");
  assert.deepEqual(got, [{ kind: "hello", version: 1, firmware: "0.1.0" }]);
});

test("the shell's own escapes and other OSCs reach the terminal untouched", () => {
  const sp = new OscSplitter(() => assert.fail("not ours"));
  const s = "\x1b[K\x1b[3D\x1b\x1b[2J\x1b]0;title\x07\x1b]7777;f;zz;1\x07";
  assert.equal(dec(sp.push(enc(s))), s);
});

test("parseOsc rejects anything malformed", () => {
  assert.equal(parseOsc("7777;f;ffff;0"), null);
  assert.equal(parseOsc("7777;f;" + "0".repeat(36) + ";-1"), null);
  assert.equal(parseOsc("7778;mk1;1"), null);
  assert.deepEqual(parseOsc("7777;mk1;1"), { kind: "hello", version: 1, firmware: null });
});
