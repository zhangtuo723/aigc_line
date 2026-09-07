import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  outputDir: './test-results/playwright',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
})
