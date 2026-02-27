import { test, expect } from '@playwright/test';

test.describe('Termbook Full Visual & Behavior Audit', () => {
    test('end-to-end user simulation', async ({ page }) => {
        // A. Initial Load & PWD
        await page.goto('http://localhost:4000');
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'screenshots/audit_01_load.png' });

        const input = page.getByPlaceholder('Enter terminal command...');

        // B. Command Execution & Result Snapshotting
        await input.fill('echo "Hello World"');
        await input.press('Enter');
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'screenshots/audit_02_snapshot.png' });
        
        // C. Ghost Text & History
        await input.fill('echo');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/audit_03_ghost_text.png' });
        await input.press('ArrowRight');
        await input.press('Enter');
        await page.waitForTimeout(1000);

        // D. TUI Modal & Interaction
        const tuiCmd = "python3 -c \"import sys, time; print('\\x1b[?1049h'); sys.stdout.flush(); print('LLM AUDIT: TUI MODE'); sys.stdout.flush(); time.sleep(3); print('\\x1b[?1049l');\"";
        await input.fill(tuiCmd);
        await input.press('Enter');
        await page.waitForTimeout(1500);
        await page.screenshot({ path: 'screenshots/audit_04_tui_modal.png' });
        await page.waitForTimeout(3000);

        // E. Session Management (Create/Switch)
        await page.click('button[title="New Session"]');
        await page.waitForTimeout(1500);
        await page.screenshot({ path: 'screenshots/audit_05_session_2.png' });
        
        const sessions = page.locator('.sidebar ul li');
        await sessions.first().click(); // Switch back
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'screenshots/audit_06_session_1_rehydrated.png' });

        // F. Delete Session
        const firstSession = page.locator('.sidebar ul li').first();
        const deleteBtn = firstSession.locator('.delete-session-btn');
        await deleteBtn.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/audit_07_session_deleted.png' });
        
        // G. Breadcrumbs & PWD Deep Dive
        await input.fill('mkdir -p test_dir/sub_dir && cd test_dir/sub_dir && pwd');
        await input.press('Enter');
        await page.waitForTimeout(1500);
        await page.screenshot({ path: 'screenshots/audit_08_deep_breadcrumbs.png' });
    });
});

