/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/** Git short SHA, else the package.json version, else 'dev'. */
function appVersion(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    if (sha) return sha
  } catch {
    // not a git checkout
  }
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
    if (typeof pkg.version === 'string' && pkg.version) return pkg.version
  } catch {
    // ignore
  }
  return 'dev'
}

// `base: './'` keeps asset paths relative, so the same build works at a
// domain root (Vercel, Netlify) or under a sub-path (GitHub Pages /pokemondle/).
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [react(), tailwindcss()],
  build: {
    // The bundled Pokémon dataset makes the main chunk ~540 kB (~115 kB gzipped).
    chunkSizeWarningLimit: 700,
    // (Vite 8's name for what was rollupOptions.)
    rolldownOptions: {
      // Two pages: the game, and Party at /party/ (its own bundle, so Daily and Endless don't grow from Party code).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        party: fileURLToPath(new URL('./party/index.html', import.meta.url)),
      },
      // What both pages use (React, the shared styles, the dialog) goes in one chunk named "shared".
      output: { codeSplitting: { groups: [{ name: 'shared', minShareCount: 2 }] } },
    },
  },
  test: {
    environment: 'node',
    // Browser smoke tests (e2e/) run under Playwright, not Vitest.
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
})
