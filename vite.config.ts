import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    // ELK is a lazy, self-contained layout engine; application and UI vendor
    // chunks remain below Vite's default 500 kB threshold.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          "dock-vendor": ["dockview-react"],
          "flow-vendor": ["@xyflow/react"],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
  },
});
