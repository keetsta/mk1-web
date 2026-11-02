import wasmUrl from "./mc1-shell.wasm?url";
import { createShell, type Hal, type Shell } from "./core";

/** fetches the shell's WebAssembly (content-hashed by Vite) and starts it */
export async function loadShell(hal: Hal): Promise<Shell> {
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error(`the shell didn't load (${res.status})`);
  return createShell(await res.arrayBuffer(), hal);
}
