import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// In Vite, command === 'build' indicates production build
// The esbuild drop configuration strips console and debugger statements
const isProduction = process.argv.includes('build');
const dropOptions = isProduction ? ['console', 'debugger'] : [];

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
  // Use esbuild option at top level for transpilation
  esbuild: {
    drop: dropOptions,
  },
  build: {
    target: 'esnext',
    // Also configure for minification
    minify: 'esbuild',
    esbuild: {
      drop: dropOptions,
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
      drop: dropOptions,
    },
  },
  define: {
    'process.env': {},
    global: 'globalThis',
  },
});

