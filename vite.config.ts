import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// the demo page; on keetsta.me the module is built by the site's own Vite
export default defineConfig({
  plugins: [react()],
});
