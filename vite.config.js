import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// npm run build: the GitHub Pages site (/dme-dashboard/, into dist/).
// npm run build:lite (--mode lite): the copy the lite package's bridge
// serves at its own root, into dist-lite/ (see .env.lite).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'lite' ? '/' : '/dme-dashboard/',
  build: {
    copyPublicDir: false,  // don't copy public/ into dist
    outDir: mode === 'lite' ? 'dist-lite' : 'dist',
  }
}))
