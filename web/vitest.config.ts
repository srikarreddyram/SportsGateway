import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Tailwind's Vite plugin is intentionally absent here: these tests assert behaviour
    // and rendered text, never computed styles, so compiling CSS would only slow them.
    css: false,
  },
});
