import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: works on the custom domain root and on the
  // github.io/<repo>/ fallback subpath.
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
