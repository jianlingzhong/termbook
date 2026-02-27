import { test, expect } from '@playwright/test';

test.describe('Visual Audit V2: Cell Sizing and Layout', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER CONSOLE: ${msg.text()}`));
    await page.goto('http://localhost:4000/?new_session=true');
    await page.waitForTimeout(2000);
  });

  test('cell sizing: pwd should be compact', async ({ page }) => {
    const input = page.locator('input').first();
    await input.fill('pwd');
    await input.press('Enter');

    const cell = page.locator('.notebook-cell').first();
    await expect(cell).toBeVisible({ timeout: 15000 });
    await expect(cell).toContainText('termbook', { timeout: 10000 });
    
    await page.waitForTimeout(2000);
    const height = await cell.evaluate(el => el.offsetHeight);
    console.log(`pwd cell height: ${height}px`);
    
    expect(height).toBeLessThan(180);
    await page.screenshot({ path: 'screenshots/06_pwd_output.png' });
  });

  test('cell sizing: grows with output while live', async ({ page }) => {
    const input = page.locator('input').first();
    
    // Command that produces output slowly, longer duration
    await input.fill('for i in {1..10}; do echo "line $i"; sleep 1; done');
    await input.press('Enter');
    
    const cell = page.locator('.notebook-cell').first();
    await expect(cell).toBeVisible();
    
    // Wait for the text to appear in the terminal rows
    const rows = cell.locator('.xterm-rows');
    await expect(rows).toContainText('line 1', { timeout: 15000 });

    // Ensure it's still running (no snapshot yet)
    const isRunningH1 = await cell.evaluate(el => !el.querySelector('.snapshot-output'));
    const h1 = await cell.evaluate(el => el.offsetHeight);
    
    // Wait for more output
    await expect(rows).toContainText('line 5', { timeout: 20000 });
    const isRunningH2 = await cell.evaluate(el => !el.querySelector('.snapshot-output'));
    const h2 = await cell.evaluate(el => el.offsetHeight);
    
    console.log(`Live growth: h1=${h1}px (live=${isRunningH1}), h2=${h2}px (live=${isRunningH2})`);
    
    expect(isRunningH1).toBe(true);
    expect(isRunningH2).toBe(true);
    expect(h2).toBeGreaterThan(h1);
    expect(h2).toBeLessThan(700);
  });


  test('cell width: output fills whole cell', async ({ page }) => {
    const input = page.locator('input').first();
    
    await input.fill('echo "----------------------------------------------------------------------------------------------------------------------------------------------------------------"');
    await input.press('Enter');
    
    const cell = page.locator('.notebook-cell').first();
    await expect(cell).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: 'screenshots/08_echo_output.png' });
    
    const outputWidth = await cell.locator('.snapshot-output, .xterm-rows').first().evaluate(el => el.scrollWidth);
    const containerWidth = await cell.locator('.cell-output').evaluate(el => el.clientWidth - 32); 
    
    expect(outputWidth).toBeGreaterThanOrEqual(containerWidth * 0.8);
  });

  test('layout: new cells auto-scroll to bottom', async ({ page }) => {
    const input = page.locator('input').first();
    
    for (let i = 1; i <= 5; i++) {
        await input.fill(`echo "cell ${i}"`);
        await input.press('Enter');
        await page.waitForTimeout(1000);
    }
    
    const notebook = page.locator('.notebook-content');
    await page.screenshot({ path: 'screenshots/06_autoscroll.png' });
    const isScrolled = await notebook.evaluate((el) => {
        return Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 150;
    });
    
    expect(isScrolled).toBe(true);
  });
});
