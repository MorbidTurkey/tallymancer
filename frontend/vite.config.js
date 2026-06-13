import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),

    /*
     * vite-plugin-pwa — generates the Web App Manifest and a Workbox
     * service worker so Tallymancer is installable on mobile.
     *
     * Strategy: 'generateSW' (plugin writes the SW for us).
     * registerType: 'autoUpdate' — the SW updates itself in the background
     * when a new version is deployed; no "reload to update" prompt needed.
     *
     * What gets cached:
     *  - App shell (HTML, JS, CSS, fonts, icons): precache at install time.
     *  - /api/presets: runtime cache (stale-while-revalidate, 1h expiry).
     *  - /api/sessions/* and /ws/*: NOT cached — live data, must be fresh.
     *
     * Even with network offline, the app shell loads and shows the
     * connection spinner.  Scores require a live WebSocket.
     */
    VitePWA({
      registerType: 'autoUpdate',

      // Files that should be precached by the service worker.
      // The glob runs relative to the Vite `dist/` output directory.
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],

      manifest: {
        name: 'Tallymancer',
        short_name: 'Tallymancer',
        description: 'Real-time score tracker for any TCG — Lorcana, MTG, Star Wars Unlimited, and more.',
        start_url: '/',
        display: 'standalone',
        // Orientation 'any' allows both portrait (list view) and landscape (table view).
        orientation: 'any',
        background_color: '#0e0e16',
        theme_color: '#1c1c2e',
        lang: 'en',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            // 'any maskable' = can be masked to any shape (circle, squircle, etc.)
            purpose: 'any maskable',
          },
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },

      workbox: {
        // Precache all static assets emitted by the Vite build
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],

        // Runtime caching rules (for requests NOT covered by precache)
        runtimeCaching: [
          {
            // Cache the presets list — it almost never changes.
            // stale-while-revalidate: serve from cache immediately, then
            // refresh in the background so the next visit is always up to date.
            urlPattern: /\/api\/presets/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-presets',
              expiration: {
                maxAgeSeconds: 60 * 60,   // 1 hour
                maxEntries: 5,
              },
            },
          },
        ],

        // Don't try to cache API session calls or WebSocket connections —
        // those are live data that must always come from the server.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
      },
    }),
  ],

  server: {
    // Proxy API and WebSocket calls to the FastAPI backend during local dev.
    // This means the React app can use relative URLs (/api/..., /ws/...)
    // and Vite forwards them to the backend, eliminating CORS headaches.
    // In production, nginx (inside the frontend Docker container) handles
    // this proxy, so the same relative URLs work without any config change.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,        // required for WebSocket proxying
        changeOrigin: true,
      },
    },
  },
})
