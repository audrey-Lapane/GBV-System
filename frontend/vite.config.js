import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Content Security Policy for the built app only (Vite's dev server needs inline scripts).
// Scripts and connections are limited to this origin; the API is reached on the same origin.
const csp = {
  name: "csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace(
      "<head>",
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'" />`
    ),
};

export default defineConfig({
  plugins: [
    react(),
    csp,
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        // Neutral name and icon: the home screen does not reveal what the app is for.
        name: "Campus Desk",
        short_name: "Desk",
        description: "Campus Desk",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#F4F6F5",
        background_color: "#F4F6F5",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // Cache the application shell only. No API responses, report text, IDs or secrets.
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5173,
    // Same-origin API in development: the browser talks only to the dev server.
    proxy: { "/api": "http://localhost:4000" },
  },
  preview: { port: 4173, proxy: { "/api": "http://localhost:4000" } },
});
