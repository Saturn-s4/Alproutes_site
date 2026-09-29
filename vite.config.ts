import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works both on GitHub Pages (/Alproutes_site/) and at a domain root.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          leaflet: ['leaflet', 'react-leaflet'],
        },
      },
    },
  },
});
