/* The card's shell compiled to WebAssembly (wasm/hal_wasm.c + the mk1-shell core): the same code the
   firmware runs, here with a JS HAL. No Vite imports, so tests can load it under Node. */

export type Hal = {
  /** bytes the shell prints, already with \r\n */
  write(bytes: Uint8Array): void;
  /** the matrix changed (9 rows, bit 15 = left column) */
  frame(rows: Uint16Array): void;
  button(): boolean;
  /** light level 0..1023 */
  lux(): number;
  load(size: number): Uint8Array | null;
  save(state: Uint8Array): void;
  /** ctrl-d at an empty prompt */
  exit(): void;
};

export type Shell = {
  input(bytes: Uint8Array): void;
  /** call every 20 ms */
  tick(): void;
  /** a program is running in the foreground */
  running(): boolean;
};

type Exports = {
  memory: WebAssembly.Memory;
  _initialize(): void;
  init(): void;
  input(c: number): void;
  tick(): void;
  running(): number;
};

export async function createShell(wasm: BufferSource, hal: Hal): Promise<Shell> {
  let memory: WebAssembly.Memory | null = null;
  const bytes = (p: number, n: number) => new Uint8Array(memory!.buffer, p, n);
  const { instance } = await WebAssembly.instantiate(wasm, {
    mk1: {
      write: (p: number, n: number) => hal.write(bytes(p, n).slice()),
      matrix: (p: number) => hal.frame(new Uint16Array(memory!.buffer.slice(p, p + 18))),
      button: () => (hal.button() ? 1 : 0),
      lux: () => Math.max(0, Math.min(1023, Math.round(hal.lux()))),
      load: (p: number, n: number) => {
        const saved = hal.load(n);
        if (!saved || saved.length !== n) return 0;
        bytes(p, n).set(saved);
        return 1;
      },
      save: (p: number, n: number) => hal.save(bytes(p, n).slice()),
      exit: () => hal.exit(),
    },
  });
  const ex = instance.exports as unknown as Exports;
  memory = ex.memory;
  ex._initialize();
  ex.init();
  return {
    input: (data) => data.forEach((c) => ex.input(c)),
    tick: () => ex.tick(),
    running: () => ex.running() !== 0,
  };
}
