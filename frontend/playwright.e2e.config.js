// End-to-end test configuration.
//
// Runs the e2e suite in tests/e2e/*.spec.mjs. Differs from
// playwright.visual.config.js in that:
//   - Video is ALWAYS recorded (not just retain-on-failure) so we have
//     a full record of every test run for debugging.
//   - Screenshots are always taken on failure AND attached automatically
//     when tests use the `shot()` helper.
//   - Trace is always retained.
//   - Reporter outputs to playwright-report-e2e/ (separate from visual).
//
// Usage:
//   npm run test:e2e                # run all e2e specs
//   npx playwright test --config=playwright.e2e.config.js -g "vim" --headed
//   npm run test:e2e -- --update-snapshots

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: /.*\.spec\.mjs$/,
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: 0,
    // Global setup spins up a userspace sshd on 127.0.0.1:2222 that the
    // SSH spec (08_ssh_session.spec.mjs) connects to. Non-SSH specs ignore
    // it — sshd binding to a high port has zero impact on the rest. The
    // sshd is intentionally LEFT RUNNING after teardown so subsequent test
    // runs reuse it (overridable via TERMBOOK_E2E_KILL_SSHD=1).
    globalSetup: './tests/e2e/ssh-global-setup.mjs',
    globalTeardown: './tests/e2e/ssh-global-teardown.mjs',
    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report-e2e', open: 'never' }],
    ],
    timeout: 120_000,
    expect: {
        timeout: 10_000,
        toHaveScreenshot: {
            // Allow tiny rendering differences (anti-aliasing, font hinting).
            maxDiffPixelRatio: 0.02,
            threshold: 0.2,
        },
    },

    use: {
        baseURL: process.env.TERMBOOK_BASE_URL || 'http://localhost:4000',
        viewport: { width: 1600, height: 900 },
        // Always record video — these are end-to-end tests, the screencast IS the artifact.
        video: { mode: 'on', size: { width: 1600, height: 900 } },
        // Take a screenshot on every assertion failure for offline debugging.
        screenshot: 'only-on-failure',
        // Always retain a trace so devs can step through with `npx playwright show-trace`.
        trace: 'on',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
