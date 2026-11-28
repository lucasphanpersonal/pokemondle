import { defineConfig } from '@playwright/test'

// Two-player Party test (e2e/live/) against a LOCAL Supabase stack, never the live project. In CI,
// .github/workflows/party-e2e.yml starts the stack, serves the Edge Functions, builds the site with VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY pointing at it and runs `npx playwright test -c playwright.party.config.ts`.
// Env: PARTY_API_URL, PARTY_ANON_KEY (the local stack's) and PARTY_DB_URL (its Postgres, used to force short timers).
const executablePath = process.env.PW_CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: './e2e/live',
  // One game at a time: the tests share the stack's per-network caps and its once-a-second sweep.
  workers: 1,
  timeout: 120_000,
  // No retries: the game must pass first time (a retry once hid the host's missing-guest bug, fixed in src/party/resync.ts).
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    trace: process.env.CI ? 'retain-on-failure' : 'off',
    launchOptions: { executablePath },
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: false,
  },
})
