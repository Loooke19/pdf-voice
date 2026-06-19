import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "icons/pwa-192.png",
        "icons/pwa-512.png",
        "icons/apple-touch-icon.png",
      ],
      manifest: {
        name: "阅声 · PDF 本地朗读",
        short_name: "阅声",
        description: "在设备本地提取 PDF 文字、OCR 并使用系统语音朗读。",
        theme_color: "#f5f2ea",
        background_color: "#f5f2ea",
        display: "standalone",
        start_url: "./",
        scope: "./",
        lang: "zh-CN",
        categories: ["books", "education", "productivity"],
        icons: [
          {
            src: "icons/pwa-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,webmanifest}"],
        globIgnores: ["ocr/**"],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes("/ocr/"),
            handler: "CacheFirst",
            options: {
              cacheName: "pdf-voice-ocr-v1",
              expiration: {
                maxEntries: 24,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
