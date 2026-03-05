import { test, expect, Page } from '@playwright/test';

async function waitForStable(page: Page) {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
}

test.describe('Reliability Audit V4 - Sequence Test', () => {
    test.beforeEach(async ({ page }) => {
        // Log browser console for debugging
        page.on('console', msg => {
            console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
        });
        await page.goto('http://localhost:4000?new_session=true');
        await page.waitForTimeout(2000);
    });

    test('Execute ls-vim-nvim sequence with zero residuals', async ({ page }) => {
        test.setTimeout(300000);

        const input = page.locator('.chat-input-wrapper textarea');
        const modal = page.locator('.tui-modal-overlay');

        const commands = [
            { cmd: 'ls', type: 'shell' },
            { cmd: 'ls', type: 'shell' },
            { cmd: 'ls', type: 'shell' },
            { cmd: 'vim --clean +q', type: 'tui_auto_quit' },
            { cmd: 'nvim --clean -c "set guicursor=n-v-c:block,i-ci-ve:ver25" +q', type: 'tui_auto_quit' },
            { cmd: 'nvim --clean -c "set guicursor=n-v-c:block,i-ci-ve:ver25"', type: 'tui_interactive' },
            { cmd: 'ls', type: 'shell' },
            { cmd: 'ls', type: 'shell' }
        ];

        let cellCount = 0;
        for (let i = 0; i < commands.length; i++) {
            const { cmd, type } = commands[i];
            console.log(`STEP ${i + 1}: Running "${cmd}" (${type})`);
            
            await input.fill(cmd);
            await page.keyboard.press('Enter');

            if (type === 'shell') {
                cellCount++;
                const cell = page.locator('.notebook-cell').nth(cellCount - 1);
                await expect(cell).toBeVisible({ timeout: 10000 });
                // Wait for command to finish and snapshot to appear
                await expect(cell.locator('.snapshot-output')).toBeVisible({ timeout: 15000 });
                await page.screenshot({ path: `../screenshots/step_${i + 1}_${cmd.split(' ')[0]}_done.png` });
            } else if (type === 'tui_auto_quit') {
                cellCount++;
                // Short-lived TUIs might exit faster than Playwright can catch the modal.
                // We primarily want to ensure they don't block the UI and eventually snapshot.
                const cell = page.locator('.notebook-cell').nth(cellCount - 1);
                await expect(cell.locator('.snapshot-output')).toBeVisible({ timeout: 15000 });
                await page.screenshot({ path: `../screenshots/step_${i + 1}_${cmd.split(' ')[0]}_done.png` });
            } else if (type === 'tui_interactive') {
                cellCount++;
                await expect(modal).toBeVisible({ timeout: 15000 });
                
                // Wake up Nvim/TUI
                await page.keyboard.press('Escape');
                await page.waitForTimeout(2000);
                
                await expect(async () => {
                    const bufferInfo = await page.evaluate(() => {
                        const term = (window as any).__ACTIVE_TERM;
                        if (!term) return { type: "NONE", text: "NO TERM" };
                        let lines = [];
                        const activeBuffer = term.buffer.active;
                        for (let i = 0; i < term.rows; i++) {
                            const line = activeBuffer.getLine(i);
                            if (line) lines.push(line.translateToString(true));
                        }
                        return { type: activeBuffer.type, text: lines.join('\n') };
                    });
                    console.log(`STEP ${i + 1} BUFFER POLL: type=${bufferInfo.type} snippet="${bufferInfo.text.substring(0, 100).replace(/\n/g, '\\n')}"`);
                    expect(bufferInfo.text).toMatch(/~|\[No Name\]|VIM/i);
                }).toPass({ timeout: 20000 });
                await page.screenshot({ path: `../screenshots/step_${i + 1}_${cmd.split(' ')[0]}_active.png` });
                
                // Interact a bit
                await page.keyboard.press('i');
                await page.waitForTimeout(500);
                await page.keyboard.type('Visual Audit Step');
                await page.screenshot({ path: `../screenshots/step_${i + 1}_${cmd.split(' ')[0]}_typed.png` });
                
                await page.keyboard.press('Escape');
                await page.waitForTimeout(500);
                await page.keyboard.type(':q!');
                await page.keyboard.press('Enter');
                
                await expect(modal).not.toBeVisible({ timeout: 15000 });
                const cell = page.locator('.notebook-cell').nth(cellCount - 1);
                await expect(cell.locator('.snapshot-output')).toBeVisible({ timeout: 15000 });
                await page.screenshot({ path: `../screenshots/step_${i + 1}_${cmd.split(' ')[0]}_done.png` });
            }
            
            // Verify focus returns to input after each command
            await expect(input).toBeFocused({ timeout: 5000 });
        }

        // Final verification: Ensure no leakage between cells
        const allCells = page.locator('.notebook-cell');
        await expect(allCells).toHaveCount(cellCount);
        
        // Verify last ls output doesn't contain nvim residuals
        const lastCell = allCells.last();
        const lastOutput = await lastCell.locator('.snapshot-output').innerText();
        expect(lastOutput).not.toContain('Visual Audit Step');
        
        await page.screenshot({ path: '../screenshots/final_state.png' });
    });
});
