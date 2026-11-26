import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

// The dashboard's own version, for the banner (import.meta.env.VITE_DASH_VERSION):
// DMEKLR_VERSION when set (the lite package's make_lite.sh passes its
// release, e.g. v1.0.8), else git describe (v1.0.8, or v1.0.8-3-gabc1234
// past it, or just the short hash in a clone without tags), else
// package.json's version
function dashVersion() {
  if (process.env.DMEKLR_VERSION) return process.env.DMEKLR_VERSION
  try {
    return execSync('git describe --tags --always --dirty=+changes',
                    { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
  }
}
process.env.VITE_DASH_VERSION = dashVersion()

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
