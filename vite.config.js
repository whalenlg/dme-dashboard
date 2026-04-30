import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/dme-dashboard/',
  build: {
    copyPublicDir: false,  // don't copy public/ into dist
  }
})


