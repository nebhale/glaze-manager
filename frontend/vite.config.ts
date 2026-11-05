import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: { license: { fileName: "third-party-licenses.md" } },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/media": "http://127.0.0.1:8000",
    },
  },
});
