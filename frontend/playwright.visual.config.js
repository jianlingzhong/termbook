import { defineConfig, devices } from '@playwright/test';

const useCi = process.env.TERMBOOK_CI === '1';

export default defineConfig({
    testDir: './tests/visual',
    testMatch: /.*\.spec\.mjs$/,
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report-visual', open: 'never' }],
    ],
    timeout: 60_000,
    expect: { timeout: 8_000 },

    use: {
        baseURL: process.env.TERMBOOK_BASE_URL || 'http://localhost:4000',
        viewport: { width: 1600, height: 900 },
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    ...(useCi ? {
        webServer: [
            {
                command: 'node server.js',
                cwd: '../backend',
                url: 'http://localhost:4001/api/health',
                reuseExistingServer: true,
                timeout: 30_000,
            },
            {
                command: 'npm run dev',
                url: 'http://localhost:4000',
                reuseExistingServer: true,
                timeout: 30_000,
            },
        ],
    } : {}),
});
