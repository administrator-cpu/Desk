import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  base: "./", // loaded via file:// in production, not a web root
  server: {
    port: 5174,
    strictPort: true, // fail loudly rather than silently picking a different port main.js won't know about
  },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
});
