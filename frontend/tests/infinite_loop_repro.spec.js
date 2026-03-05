import { test, expect } from '@playwright/test';

test.describe('Infinite Resize Loop Prevention', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:4000');
        await page.waitForTimeout(1000);
    });

    test('Inline TUI should lock its height and not infinitely loop', async ({ page }) => {
        const input = page.locator('.chat-input-wrapper textarea');
        await input.waitFor({ state: 'visible', timeout: 10000 });

        // A mock TUI that listens to SIGWINCH and redraws.
        // We will simulate drawing a box.
        const tuiCommand = `python3 -c "import sys, time, signal, os
def draw(signum=None, frame=None):
    try:
        rows, cols = os.get_terminal_size()
    except:
        rows, cols = 24, 80
    sys.stdout.write('\\x1b[H') # go home
    for i in range(rows - 1):
        sys.stdout.write(f'Row {i}'.ljust(cols-1) + '\\n')
    sys.stdout.write(f'Row {rows-1}'.ljust(cols-1)) # no newline at end, but print to bottom right
    sys.stdout.flush()

signal.signal(signal.SIGWINCH, draw)
sys.stdout.write('\\x1b[2J') # Clear screen
draw()
time.sleep(3)
"`;

        await input.click();
        await input.fill(tuiCommand);
        await input.press('Enter');

        // Wait for the python script to finish
        await page.waitForTimeout(4000);
        
        // Take a screenshot
        await page.screenshot({ path: 'infinite_loop_test.png' });

        // We check if the terminal height is reasonable (not 1000px)
        const cellContent = page.locator('.notebook-cell').last().locator('.cell-output');
        const box = await cellContent.boundingBox();
        
        console.log('Cell Output Height:', box.height);
        
        // The maxRows is around Math.floor((window.innerHeight - 200) / 20)
        // Usually around 20-40 rows. So height should be less than 800px.
        expect(box.height).toBeLessThan(1000);
    });
});
