import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  plugins: [react(), {
    name: "mk1-render-blocking-entry",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      // Vite replaces the source tag, dropping the attribute needed to capture the first React frame.
      handler: (html) => html.replace(/<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc=)/, '<script blocking="render"'),
    },
  }],
  define: { __MK1_BUILD__: JSON.stringify(build()) },
  build: {
    rollupOptions: {
      input: [
        fileURLToPath(new URL("./index.html", import.meta.url)),
        fileURLToPath(new URL("./mk1/top/index.html", import.meta.url)),
      ],
    },
  },
  server: {
    proxy: { "/mk1/api": process.env.MK1_API_ORIGIN ?? "http://127.0.0.1:8787" },
  },
});
