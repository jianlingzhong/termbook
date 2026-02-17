import { test, expect } from '@playwright/test';
// @ts-ignore
import fs from 'fs';
// @ts-ignore
import path from 'path';

test.describe('Debug Logging System', () => {

  const backendLog = '/tmp/termbook-backend.log';
  const frontendLog = '/tmp/termbook-frontend.log';

  test('validates backend and frontend append-only debug logs', async ({ page }) => {
    // 1. Navigate to Termbook
    await page.goto('http://localhost:5174/');

    // 2. Wait for the frontend active badge/connection
    await page.waitForSelector('.pwd-breadcrumb', { state: 'visible' });
    await page.waitForTimeout(500); // Small buffer for WebSocket connection

    // 3. Fire a simple command
    const inputLocator = page.locator('.input-with-ghost input');
    await inputLocator.fill('echo "DEBUG_LOG_TEST_xyz123"');
    await inputLocator.press('Enter');

    // 4. Wait for the cell output to show up in the DOM (it may be rendered inside collapsed component states depending on React timing)
    await page.waitForFunction(() => document.body.innerText.includes('DEBUG_LOG_TEST_xyz123'), {}, { timeout: 15000 });

    // Allow an extra moment for the frontend to POST its final handleCreateSnapshot logs back
    await page.waitForTimeout(2000);

    // 5. Read the Backend Log
    expect(fs.existsSync(backendLog)).toBeTruthy();
    const backendContents = fs.readFileSync(backendLog, 'utf8');

    // Assert backend markers exist
    expect(backendContents).toContain('==== BACKEND STARTED AT');

    // Assert backend captured the PTY events (should see standard ISO stamps)
    expect(backendContents).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] PTY stdout/);
    expect(backendContents).toContain('DEBUG_LOG_TEST_xyz123');

    // 6. Read the Frontend Log
    expect(fs.existsSync(frontendLog)).toBeTruthy();
    const frontendContents = fs.readFileSync(frontendLog, 'utf8');

    // Assert frontend markers exist
    expect(frontendContents).toContain('==== FRONTEND RELOADED ====');

    // Assert frontend captured WebSocket & Snapshot events
    expect(frontendContents).toContain('WS output');
    expect(frontendContents).toContain('WS exit');
    expect(frontendContents).toContain('handleCreateSnapshot');
  });

});
