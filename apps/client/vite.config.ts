import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

// In Vite, command === 'build' indicates production build
// The esbuild drop configuration strips console and debugger statements
const isProduction = process.argv.includes('build');
const dropOptions = isProduction ? ['console', 'debugger'] : [];
const analyzeBundle = process.env.ANALYZE === 'true';

function getNodeModulePackageName(normalizedId: string) {
  const nodeModulesMarker = '/node_modules/';
  const packagePathStart = normalizedId.lastIndexOf(nodeModulesMarker);
  if (packagePathStart === -1) return undefined;

  const packagePath = normalizedId.slice(packagePathStart + nodeModulesMarker.length);
  const [scopeOrName, packageName] = packagePath.split('/');
  if (!scopeOrName) return undefined;

  return scopeOrName.startsWith('@') && packageName
    ? `${scopeOrName}/${packageName}`
    : scopeOrName;
}

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
          const packageName = getNodeModulePackageName(normalizedId);
          if (!packageName) return undefined;

          if (packageName === '@dimforge/rapier3d-compat') {
            return 'physics-vendor';
          }
          if (packageName === 'livekit-client') {
            return 'voice-vendor';
          }
          if (
            packageName.startsWith('@solana/') ||
            packageName.startsWith('@noble/') ||
            packageName === 'bn.js' ||
            packageName === 'borsh' ||
            packageName === 'jayson' ||
            packageName === 'rpc-websockets' ||
            packageName === 'superstruct'
          ) {
            return 'wallet-vendor';
          }
          if (
            packageName === 'react' ||
            packageName === 'react-dom' ||
            packageName === 'scheduler'
          ) {
            return 'react-vendor';
          }
          if (
            packageName === 'three' ||
            packageName.startsWith('@react-three/') ||
            packageName === 'three-stdlib' ||
            packageName === 'maath'
          ) {
            return 'rendering-vendor';
          }
          if (
            packageName === 'colyseus.js' ||
            packageName.startsWith('@colyseus/') ||
            packageName === 'msgpackr'
          ) {
            return 'network-vendor';
          }
          if (packageName === 'zustand') {
            return 'state-vendor';
          }
          if (
            packageName.startsWith('@radix-ui/') ||
            packageName.startsWith('@floating-ui/') ||
            packageName === 'lucide-react' ||
            packageName === 'framer-motion'
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
