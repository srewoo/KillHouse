export default {
  // Relative asset paths so dist/ loads as an unpacked Chrome extension.
  base: './',
  server: { host: '127.0.0.1' },
  build: { target: 'esnext' },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
};
