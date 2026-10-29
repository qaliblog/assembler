import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The API proxy target is read from the environment so the same deterministic
 * configuration works whether or not a backend was generated. Tests and builds
 * never require a running backend.
 */
const proxyTarget = process.env['VITE_API_PROXY'];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    ...(proxyTarget === undefined || proxyTarget === ''
      ? {}
      : { proxy: { '/api': { target: proxyTarget, changeOrigin: true } } }),
  },
  build: {
    sourcemap: false,
    target: 'es2022',
  },
});
