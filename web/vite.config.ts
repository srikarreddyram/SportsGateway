import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GATEWAY_URL points at whatever is answering on the client-facing port — Nginx in
// front of the full Docker stack (8080), or a single gateway process in dev (3000).
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // The UI is just another client: it calls the same /api routes real consumers
      // would, through this proxy only to dodge browser CORS in local dev.
      '/api': { target: GATEWAY_URL, changeOrigin: true },
    },
  },
});
