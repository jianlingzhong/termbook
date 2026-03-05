import { test, expect } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Human Simulation: End-to-End Workflow', () => {
  test('should handle a complex multi-command session with session switching and rehydration', async ({ page, context, browserName }) => {
    test.setTimeout(60000);
    // 1. ARRIVAL: User lands on the app and creates a new session
    const testSessionId = `human-sim-${browserName}-${Math.random().toString(36).substring(2, 7)}`;
    await page.goto(`http://localhost:4000/?session_id=${testSessionId}`);
    const globalInput = page.locator('.chat-input-wrapper textarea');

    // 2. WARMUP: User runs a simple command
    await globalInput.fill('pwd');
    await globalInput.press('Enter');
    const cell1 = page.locator('.notebook-cell:not(.interactive-cell)').nth(0);
    await expect(cell1).toBeVisible();
    await expect(cell1.locator('.cell-output')).toContainText('termbook', { timeout: 10000 });
    await expect(globalInput).toBeFocused({ timeout: 10000 });

    // 3. INTERACTIVE (HYBRID): User runs the gemini mimic
    await globalInput.fill('python3 tests/mimic_gemini.py');
    await globalInput.press('Enter');

    // Expect: Focus hands off to the cell
    const cell2 = page.locator('.notebook-cell:not(.interactive-cell)').nth(1);
    await expect(cell2).toHaveClass(/active-cell/);
    
    // We check if the cell's hidden textarea is focused
    const cellInput = cell2.locator('textarea');
    await expect(cellInput).toBeFocused();

    // Wait for the prompt to appear before typing
    await expect(cell2.locator('.xterm-rows')).toContainText('> Press keys:', { timeout: 10000 });

    // User types 'abc' into the cell
    await page.keyboard.type('abc');
    await page.waitForTimeout(5000); // Wait for snapshot to reflect keypresses
    await expect(cell2.locator('.xterm-rows')).toContainText('Last key: c');

    // 4. MULTI-TASKING: User creates a second session while gemini is running
    await page.click('button[title="New Session"]');
    await expect(page.locator('.notebook-cell:not(.interactive-cell)')).toHaveCount(0);
    await expect(globalInput).toBeFocused();

    await globalInput.fill('echo "session 2"');
    await globalInput.press('Enter');
    await expect(page.locator('.notebook-cell:not(.interactive-cell)')).toHaveCount(1);
    await expect(page.locator('.notebook-cell:not(.interactive-cell)').last()).toContainText('session 2');

    // 5. CONTEXT SWITCH: User returns to Session 1
    const session1SidebarItem = page.locator(`.sidebar li[data-session-id="${testSessionId}"]`);
    await session1SidebarItem.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('.notebook-cell:not(.interactive-cell)')).toHaveCount(2);
    const rehydratedCell2 = page.locator('.notebook-cell:not(.interactive-cell)').last();
    await expect(rehydratedCell2).toHaveClass(/active-cell/);
    await expect(rehydratedCell2.locator('textarea')).toBeFocused();

    // 6. REHYDRATION: User refreshes the page
    await page.goto(`http://localhost:4000/?session_id=${testSessionId}`);
    await page.waitForTimeout(5000); // Wait for rehydration stabilization

    // Expect: App restores state correctly
    const rehydratedCell2_after_reload = page.locator('.notebook-cell:not(.interactive-cell)').last();
    await expect(rehydratedCell2_after_reload).toHaveClass(/active-cell/, { timeout: 15000 });
    await expect(rehydratedCell2_after_reload.locator('textarea')).toBeFocused();
    const visibleOutputRehydrated = rehydratedCell2_after_reload.locator('.snapshot-output, .xterm-rows');
    await expect(visibleOutputRehydrated).toContainText('Last key: c');

    // 7. TUI TRANSITION: User triggers a menu in gemini (triggers Pillar 3)
    await page.keyboard.type('/');
    const modal = page.locator('.tui-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal).toContainText('--- MENU ---');

    // User exits menu
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
    await expect(rehydratedCell2_after_reload.locator('textarea')).toBeFocused();

    // 8. COMPLETION: User quits the tool
    await page.keyboard.press('q');
    await page.waitForTimeout(2000); 
    await expect(rehydratedCell2_after_reload).not.toHaveClass(/active-cell/);
    await expect(globalInput).toBeFocused();
  });
});
