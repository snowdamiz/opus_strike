import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
  build: {
    target: 'esnext',
    // Strip console and debugger from production builds
    esbuild: {
      drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
    esbuildOptions: {
      // Node.js global to browser globalThis for Solana libraries
      define: {
        global: 'globalThis',
      },
      // Also drop during development dependency optimization
      drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    },
  },
  define: {
    'process.env': {},
    global: 'globalThis',
  },
});

