import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5182',
      '/stream': { target: 'ws://localhost:5182', ws: true },
    },
  },
});
