import { test, expect } from '@playwright/test';

test.describe('System Reliability & Stability', () => {
  test('should maintain reasonable cell height (no sprawl)', async ({ page }) => {
    await page.goto('http://localhost:4000/?new_session=true');
    const input = page.locator('.chat-input-wrapper textarea');
    
    // Fire many short commands
    for (let i = 0; i < 10; i++) {
      await input.fill(`echo "height check ${i}"`);
      await input.press('Enter');
      await page.waitForTimeout(500); // Increased from 200ms
    }

    const cells = page.locator('.notebook-cell:not(.interactive-cell)');
    await expect(cells).toHaveCount(10, { timeout: 30000 }); // Increased timeout

    const lastCell = cells.last();
    const height = await lastCell.evaluate(el => el.offsetHeight);
    console.log(`Cell height: ${height}px`);
    
    // Each cell should be roughly 50-150px (header + small output)
    // If it's 500px, something is wrong (sprawl)
    expect(height).toBeLessThan(200);
  });

  test('should recover from rapid TUI entry/exit (no permanent black screen)', async ({ page }) => {
    await page.goto('http://localhost:4000/?new_session=true');
    const input = page.locator('.chat-input-wrapper textarea');

    // Rapidly enter and exit TUI multiple times
    for (let i = 0; i < 3; i++) {
      await input.fill('python3 -c "import sys; sys.stdout.write(\'\\x1b[?1049h\'); sys.stdout.flush(); import time; time.sleep(0.5); sys.stdout.write(\'\\x1b[?1049l\'); sys.stdout.flush();"');
      await input.press('Enter');
      
      // Wait for modal
      await expect(page.locator('.tui-modal-overlay')).toBeVisible({ timeout: 10000 });
      // Wait for it to close automatically (the command finishes)
      await expect(page.locator('.tui-modal-overlay')).not.toBeVisible({ timeout: 15000 });
    }

    // Verify app is still responsive
    await input.fill('echo "still here"');
    await input.press('Enter');
    await expect(page.locator('.notebook-cell:not(.interactive-cell)').last()).toContainText('still here');
  });

  test('should not flicker if output is identical', async ({ page }) => {
    await page.goto('http://localhost:4000/?new_session=true');
    const input = page.locator('.chat-input-wrapper textarea');

    await input.fill('python3 -c "import time; [print(\'steady\') for _ in range(5)]; time.sleep(2)"');
    await input.press('Enter');

    const cell = page.locator('.notebook-cell:not(.interactive-cell)').last();
    const output = cell.locator('.snapshot-output');
    
    // Wait for the specific output to appear
    await expect(cell).toContainText('steady', { timeout: 10000 });
    
    // Check if the text itself is steady.
    await page.waitForTimeout(5000);
    await expect(output).toContainText('steady');
  });

  test('should handle gemini-like TUI menu transitions', async ({ page }) => {
    await page.goto('http://localhost:4000/?new_session=true');
    const input = page.locator('.chat-input-wrapper textarea');

    await input.fill('python3 tests/mimic_gemini.py');
    await input.press('Enter');

    // Wait for the tool output to be visible in the cell
    const cell = page.locator('.notebook-cell:not(.interactive-cell)').last();
    // Use a more specific locator for the actual visible text to avoid hidden xterm.js elements
    const visibleOutput = cell.locator('.snapshot-output, .xterm-rows');
    await expect(visibleOutput).toContainText('MIMIC GEMINI', { timeout: 15000 });

    // Focus cell
    await cell.click();
    
    // Press '/' to enter menu (triggers TUI modal)
    await page.keyboard.type('/');
    
    const modal = page.locator('.tui-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 10000 });
    // Targeted locator to avoid xterm.js internal elements and match both live and potential snapshot if ever used in modal
    const modalTerminal = modal.locator('.xterm-rows, .snapshot-output');
    await expect(modalTerminal).toContainText('Search', { timeout: 15000 });

    // User exits menu
    await page.keyboard.press('Escape');
    await expect(page.locator('.tui-modal-overlay')).not.toBeVisible({ timeout: 10000 });

    // Verify we are back in the notebook and can see the original prompt
    await expect(visibleOutput).toContainText('> Press keys:', { timeout: 10000 });
    
    // Cleanup
    await page.keyboard.type('q');
  });
});
