/*
This file configures the frontend build, test setup, and PWA plugin.
Edit this file when Vite plugins, frontend test setup, or build settings change.
Copy a config pattern here when you add another shared frontend build setting.
*/

import { defineConfig } from "vitest/config";
import { createLogger, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_DEV_PROXY_TARGET?.trim();
  const baseLogger = createLogger();
  const logger = {
    ...baseLogger,
    error(message: string, options?: Parameters<typeof baseLogger.error>[1]) {
      baseLogger.error(message, options);
    },
  };

  return {
    customLogger: logger,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        workbox: {
          navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        },
        manifest: {
          name: "The Hollow Below",
          short_name: "Hollow Below",
          description: "A first-person pixel horror game about exploring a cave.",
          theme_color: "#000000",
          background_color: "#000000",
          display: "standalone",
          start_url: "/",
          // These PNG files come from public/icon.svg. Run `npm run icons` after changing the SVG (see icon/AGENTS.md).
          icons: [
            { src: "/pwa-64x64.png", sizes: "64x64", type: "image/png" },
            { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
            { src: "/maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
      }),
    ],
    server: proxyTarget
      ? {
          proxy: {
            "/api": {
              target: proxyTarget,
              changeOrigin: true,
            },
          },
        }
      : undefined,
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./vitest.setup.ts",
      exclude: ["tests/**", "node_modules/**", "dist/**"],
    },
  };
});
