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
          const normalizedId = id.split(path.sep).join('/');

          if (normalizedId.includes('@dimforge/rapier3d-compat')) {
            return 'physics-vendor';
          }
          if (normalizedId.includes('livekit-client')) {
            return 'voice-vendor';
          }
          if (
            normalizedId.includes('@solana/') ||
            normalizedId.includes('@noble/') ||
            normalizedId.includes('/bn.js/') ||
            normalizedId.includes('/borsh/') ||
            normalizedId.includes('/jayson/') ||
            normalizedId.includes('/rpc-websockets/') ||
            normalizedId.includes('/superstruct/')
          ) {
            return 'wallet-vendor';
          }
          if (
            normalizedId.includes('/react/') ||
            normalizedId.includes('/react-dom/') ||
            normalizedId.includes('/scheduler/')
          ) {
            return 'react-vendor';
          }
          if (
            normalizedId.includes('/three/') ||
            normalizedId.includes('/@react-three/') ||
            normalizedId.includes('/three-stdlib/') ||
            normalizedId.includes('/maath/')
          ) {
            return 'rendering-vendor';
          }
          if (
            normalizedId.includes('/colyseus.js/') ||
            normalizedId.includes('/@colyseus/') ||
            normalizedId.includes('/msgpackr/')
          ) {
            return 'network-vendor';
          }
          if (normalizedId.includes('/zustand/')) {
            return 'state-vendor';
          }
          if (
            normalizedId.includes('/@radix-ui/') ||
            normalizedId.includes('/lucide-react/') ||
            normalizedId.includes('/framer-motion/')
          ) {
            return 'ui-vendor';
          }
          return undefined;
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
