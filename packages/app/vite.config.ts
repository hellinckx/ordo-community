import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";

const single = process.env.SUMMA_SINGLE_FILE === "1";
const isTauri = !!process.env.TAURI_ENV_PLATFORM;
// The public website (site/) lives at the root of the Netlify deploy; the web app is served under /app/.
// Desktop (Tauri) and the single-file build keep the root base.
const web = !single && !isTauri;

export default defineConfig({
  base: web ? "/app/" : "/",
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.1.0") },
  plugins: [
    react(),
    tailwindcss(),
    ...(single ? [viteSingleFile()] : []),
    ...(!single && !isTauri
      ? [
          VitePWA({
            registerType: "prompt",
            includeAssets: ["favicon.png", "icon-192.png", "icon-512.png"],
            manifest: {
              name: "Ordo",
              short_name: "Ordo",
              description: "Buchhaltung, Projekte und Lager für Selbstständige und kleine Firmen in Österreich – lokal und verschlüsselt.",
              theme_color: "#0a5fe0",
              background_color: "#f5f5f7",
              display: "standalone",
              id: "/app/",
              start_url: "/app/",
              scope: "/app/",
              lang: "de-AT",
              icons: [
                { src: "icon-192.png", sizes: "192x192", type: "image/png" },
                { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
              ],
              share_target: undefined,
            },
            workbox: {
              globPatterns: ["**/*.{js,css,html,png,svg,woff2,wasm}"],
              maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
              navigateFallback: "/app/index.html",
              runtimeCaching: [
                {
                  urlPattern: ({ url }) => url.pathname.includes("/tessdata/") || url.pathname.endsWith(".traineddata.gz"),
                  handler: "CacheFirst",
                  options: { cacheName: "summa-ocr-data", expiration: { maxEntries: 8 } },
                },
              ],
            },
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      exceljs: "exceljs/dist/exceljs.min.js",
      "tesseract.js": "tesseract.js/dist/tesseract.esm.min.js",
      ...(single || isTauri ? { "virtual:pwa-register": path.resolve(__dirname, "src/pwa-stub.ts") } : {}),
    },
  },
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
    host: isTauri ? "127.0.0.1" : true,
    fs: { allow: [path.resolve(__dirname, "..", "..")] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    outDir: web ? "dist/app" : "dist",
    target: isTauri ? "chrome120" : "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
    rollupOptions: single
      ? undefined
      : {
          output: {
            manualChunks: {
              react: ["react", "react-dom", "react-router"],
              charts: ["recharts"],
              pdf: ["pdfjs-dist"],
              ocr: ["tesseract.js"],
              reports: ["jspdf", "jspdf-autotable", "jszip"],
            },
          },
        },
  },
});
