import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        desktop: resolve(__dirname, 'desktop.html'),
        options: resolve(__dirname, 'options.html'),
        privacy: resolve(__dirname, 'privacy.html')
      }
    }
  }
});
