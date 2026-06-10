import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

// In Vite, command === 'build' indicates production build
// The esbuild drop configuration strips console and debugger statements
const isProduction = process.argv.includes('build');
const dropOptions = isProduction ? ['console', 'debugger'] : [];
const analyzeBundle = process.env.ANALYZE === 'true';

export default defineConfig({
  plugins: [
    react(),
    analyzeBundle && visualizer({
      filename: 'dist/bundle-stats.html',
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: path.resolve(__dirname, './node_modules/buffer/index.js'),
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/three/') || id.includes('@react-three/fiber') || id.includes('@react-three/drei')) {
            return 'three-vendor';
          }
          if (id.includes('@dimforge/rapier3d-compat')) {
            return 'physics-vendor';
          }
          if (id.includes('colyseus.js')) {
            return 'network-vendor';
          }
          if (id.includes('@solana/web3.js') || id.includes('/bs58/') || id.includes('/buffer/')) {
            return 'wallet-vendor';
          }
          if (id.includes('/zustand/') || id.includes('/react/') || id.includes('/react-dom/')) {
            return 'react-vendor';
          }
          return 'vendor';
        },
      },
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
