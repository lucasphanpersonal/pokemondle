import { defineConfig } from '@playwright/test'

// Party playtest harness (e2e/live/party-playtest.spec.ts) against a LOCAL Supabase stack, run by
// .github/workflows/party-playtest.yml. One long game per run (PLAYTEST_GAME), real timers, no retries.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: './e2e/live',
  testMatch: /party-playtest\.spec\.ts$/,
  workers: 1,
  timeout: 60 * 60_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'off',
    launchOptions: { executablePath },
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: false,
  },
})
