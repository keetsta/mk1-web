import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createShell } from "../src/mk1/shell/core.ts";

const wasm = readFileSync(new URL("../src/mk1/shell/mk1-shell.wasm", import.meta.url));

async function boot(connected = true) {
  let out = "";
  const frames: Uint8Array[] = [];
  let saved: Uint8Array | null = null;
  const t = { btn: false, lux: 512, failSave: false };
  const shell = await createShell(wasm, {
    write: (b) => { out += new TextDecoder().decode(b); },
    frame: (levels) => frames.push(levels.slice()),
    button: () => t.btn,
    lux: () => t.lux,
    load: () => saved,
    save: (s) => {
      if (t.failSave) throw new Error("storage unavailable");
      saved = s;
    },
    exit: () => { out += "<exit>"; },
  });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) shell.tick(); };
  if (connected) {
    tick(32);
    shell.connect();
    tick(16);
  }
  const type = (s: string) => { out = ""; shell.input(new TextEncoder().encode(s)); return out; };
  return { shell, type, tick, frames, t, get out() { return out; }, saved: () => saved };
}

test("the real shell runs in WebAssembly: banner, help, the manual", async () => {
  const { type } = await boot();
  assert.match(type("help\r"), /man \[n\]\s+the manual/);
  assert.match(type("man 0\r"), /task 1\. lamp/);
  assert.match(type("nope\r"), /nope: no such command/);
});

test("the matrix reaches the page as frames, and there is no buzzer", async () => {
  const { type, tick, frames } = await boot();
  type("try mov 0xffff pix\r");
  tick();
  assert.ok(frames.at(-1)!.slice(0, 16).every((v) => v === 255));
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
  assert.ok(s.frames.at(-1)!.slice(128).every((v) => v === 255));
  s.type("\x03");
  assert.match(s.type("check\r"), /task 1 passed[\s\S]*chapter 1 unlocked/);
  assert.ok(s.saved()!.length > 2000);
});

test("ctrl-d tells the page, sudo still starts the marquee", async () => {
  const { type, shell, frames } = await boot();
  assert.match(type("\x04"), /bye[\s\S]*<exit>/);
  assert.match(type("sudo\r"), /there will be dragons!/);
  const before = frames.length;
  for (let i = 0; i < 30; i++) shell.tick();
  assert.ok(frames.length > before);
});

test("a storage error leaves the program usable and reports it was not saved", async () => {
  const { type, t, saved } = await boot();
  t.failSave = true;
  const output = type("edit\rnop\r.\r");
  assert.match(output, /could not save progress[\s\S]*program in memory, 1 instruction/);
  assert.doesNotMatch(output, /saved,/);
  assert.match(type("list\r"), /1\| nop/);
  assert.equal(saved(), null);
});

test("the firmware animates boot, shell entry and return to standby", async () => {
  const { shell, type, tick, frames } = await boot(false);
  const partial = (levels: Uint8Array) => levels.some((v) => v > 0 && v < 255);
  tick(12);
  assert.ok(frames.length > 5 && frames.some(partial));
  tick(20);
  const standby = frames.at(-1)!;
  assert.equal(standby[0], 0);
  assert.ok(partial(standby));

  shell.connect();
  type("try mov 0xffff pix\r");
  tick(8);
  assert.ok(partial(frames.at(-1)!));
  tick(8);
  assert.ok(frames.at(-1)!.slice(0, 16).every((v) => v === 255));

  type("\x04");
  tick(8);
  assert.ok(partial(frames.at(-1)!));
  tick(6);
  assert.deepEqual(frames.at(-1), standby);
});
