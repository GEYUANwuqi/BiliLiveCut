import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      ["/api", "/auth", "/review/api", "/collection/api", "/openapi.json"].map(
        (prefix) => [
          prefix,
          {
            target: process.env.BLC_API_PROXY || "http://127.0.0.1:8000",
            changeOrigin: false,
          },
        ],
      ),
    ),
  },
  build: { sourcemap: false },
});
