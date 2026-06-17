import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development, requests to /api are proxied to the FastAPI backend.
// In production, FastAPI serves these built static files, so same-origin /api just works.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
