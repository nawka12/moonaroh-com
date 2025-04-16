/** @type {import('vite').UserConfig} */
module.exports = {
  server: {
    port: 3000,
    host: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': [
            'holodex.js',
            '@the-convocation/twitter-scraper',
            'jsdom'
          ]
        }
      }
    }
  },
}
