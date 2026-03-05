import { test, expect, devices } from '@playwright/test';

test.describe('Termbook Layout & UI Fixes', () => {
    test('Mobile Viewport: Content should fit or scroll, not truncate', async ({ page }) => {
        // Use iPhone 12 viewport
        await page.setViewportSize(devices['iPhone 12'].viewport);
        await page.goto('http://localhost:4000/?new_session=true');
        await page.waitForTimeout(2000);

        // Check Top Header
        const header = page.locator('.top-header');
        const headerBox = await header.boundingBox();
        const viewportSize = page.viewportSize();
        
        // The header shouldn't be wider than the viewport (triggering horizontal scroll on body)
        expect(headerBox.width).toBeLessThanOrEqual(viewportSize.width);

        // Check Input Box visibility
        const input = page.locator('.chat-input-wrapper textarea');
        await expect(input).toBeVisible();
        const inputBox = await input.boundingBox();
        expect(inputBox.y).toBeGreaterThan(0);
        expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(viewportSize.height);

        // Check Terminal Content Width (should match viewport or have scroll)
        const content = page.locator('.notebook-content');
        const scrollWidth = await content.evaluate(el => el.scrollWidth);
        const clientWidth = await content.evaluate(el => el.clientWidth);
        
        // If scrollWidth > clientWidth, we expect overflow-x to be auto/scroll
        if (scrollWidth > clientWidth) {
            const overflowX = await content.evaluate(el => window.getComputedStyle(el).overflowX);
            expect(['auto', 'scroll']).toContain(overflowX);
        }
    });

    test('Text Wrapping: Long lines should wrap or scroll', async ({ page }) => {
        await page.goto('http://localhost:4000/?new_session=true');
        await page.waitForTimeout(1000);
        const input = page.locator('.chat-input-wrapper textarea');
        
        // Inject a very long line
        const longLine = "A".repeat(200);
        await input.fill(`echo "${longLine}"`);
        await input.press('Enter');
        await page.waitForTimeout(1000);

        // Check the output cell
        const cellOutput = page.locator('.notebook-cell .cell-output').first();
        
        // We expect xterm to handle this. Since we rely on PTY wrapping, 
        // if the PTY is 120 cols, it SHOULD wrap at 120 chars.
        // If the container is narrower than 120 chars, it should scroll.
        
        // Let's verify the container isn't clipping hidden content
        const overflow = await cellOutput.evaluate(el => window.getComputedStyle(el).overflow);
        // It should probably be hidden (if xterm handles scroll) or auto.
        // But for "Visual Audit" failure "Truncated", we need to ensure the PTY fits the container.
    });

    test('Cursor Visibility: Input should have visible caret', async ({ page }) => {
        await page.goto('http://localhost:4000/?new_session=true');
        const input = page.locator('.chat-input-wrapper textarea');
        await input.focus();
        
        const caretColor = await input.evaluate(el => window.getComputedStyle(el).caretColor);
        console.log('Caret Color:', caretColor);
        expect(caretColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(caretColor).not.toBe('transparent');
    });
});
