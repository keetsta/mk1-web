import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";

/** the commit this build runs, for the page's footer; `label` says -dirty when the tree had changes */
function build() {
  try {
    const git = (args: string) => execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { commit: git("rev-parse HEAD"), label: git("describe --always --dirty --abbrev=7") };
  } catch {
    return null;
  }
}

// the demo page; on keetsta.me the module is built by the site's own Vite (it defines __MK1_BUILD__ the same way)
export default defineConfig({
  plugins: [react()],
  define: { __MK1_BUILD__: JSON.stringify(build()) },
});
