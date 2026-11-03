import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createShell } from "../src/mk1/shell/core.ts";

const wasm = readFileSync(new URL("../src/mk1/shell/mk1-shell.wasm", import.meta.url));

async function boot() {
  let out = "";
  const frames: Uint16Array[] = [];
  let saved: Uint8Array | null = null;
  const t = { btn: false, lux: 512 };
  const shell = await createShell(wasm, {
    write: (b) => { out += new TextDecoder().decode(b); },
    frame: (rows) => frames.push(rows.slice()),
    button: () => t.btn,
    lux: () => t.lux,
    load: () => saved,
    save: (s) => { saved = s; },
    exit: () => { out += "<exit>"; },
  });
  const type = (s: string) => { out = ""; shell.input(new TextEncoder().encode(s)); return out; };
  return { shell, type, frames, t, get out() { return out; }, saved: () => saved };
}

test("the real shell runs in WebAssembly: banner, help, the manual", async () => {
  const { type } = await boot();
  assert.match(type("help\r"), /man \[n\]\s+the manual/);
  assert.match(type("man 0\r"), /task 1\. lamp/);
  assert.match(type("nope\r"), /nope: no such command/);
});

test("the matrix reaches the page as frames, and there is no buzzer", async () => {
  const { type, frames } = await boot();
  type("try mov 0xffff pix\r");
  assert.equal(frames.at(-1)![0], 0xffff);
  assert.match(type("try mov 440 bz\r"), /what is 'bz'\?/);
});

test("a program sees the page's button and light, and the task can be solved", async () => {
  const s = await boot();
  const prog = "edit\rtop: mov 0 a\req btn 1\rjf draw\rmov 0xffff a\rdraw: mov 0 row\rnext: mov a pix\r" +
    "add 1 row\rlt row 9\rjt next\rwait 1\rjmp top\r.\r";
  assert.match(s.type(prog), /saved, 11 instructions/);
  s.type("run\r");
  assert.ok(s.shell.running());
  s.t.btn = true;
  for (let i = 0; i < 3; i++) s.shell.tick();
  assert.equal(s.frames.at(-1)![8], 0xffff);
  s.type("\x03");
  assert.match(s.type("check\r"), /task 1 passed[\s\S]*chapter 1 unlocked/);
  assert.ok(s.saved()!.length > 2000);
});

test("ctrl-d tells the page, sudo still brings the dragon", async () => {
  const { type, shell, frames } = await boot();
  assert.match(type("\x04"), /bye[\s\S]*<exit>/);
  assert.match(type("sudo\r"), /<=#  , \*--,/);
  const before = frames.length;
  for (let i = 0; i < 30; i++) shell.tick();
  assert.ok(frames.length > before);
});
