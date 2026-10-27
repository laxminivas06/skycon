import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api/recon': {
        target: 'http://localhost:8443',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:8443',
        ws: true
      }
    }
  }
});
