// Shared helpers for visual / motion / regression tests.
// Kept dependency-free (only @playwright/test) so it works under both
// `playwright test` and standalone `node` runners.

export const INPUT = '.chat-input-wrapper textarea';
export const VIEWPORT = { width: 1600, height: 900 };
export const BASE_URL = process.env.TERMBOOK_BASE_URL || 'http://localhost:4000';

export async function waitInputReady(page, timeoutMs = 15000) {
    const inp = page.locator(INPUT).first();
    await inp.waitFor({ state: 'visible', timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const disabled = await inp.isDisabled().catch(() => true);
        if (!disabled) return inp;
        await page.waitForTimeout(150);
    }
    return inp;
}

export async function runCommand(page, cmd, waitMs = 1500) {
    const inp = await waitInputReady(page);
    await inp.fill(cmd);
    await inp.press('Enter');
    await page.waitForTimeout(waitMs);
    return inp;
}

export async function gotoFreshSession(page) {
    await page.goto(`${BASE_URL}/?new_session=true`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
}

export async function cellHeights(page) {
    return await page.locator('.cell-output').evaluateAll(els =>
        els.map(e => Math.round(e.getBoundingClientRect().height))
    );
}

export async function lastCellText(page) {
    return await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('.notebook-cell .cell-output'));
        return (cells[cells.length - 1]?.innerText || '').trim();
    });
}

// Measure the maximum height seen across a window of time.
// Useful for catching transient flashes that disappear by the time the
// command completes.
export async function maxCellHeightDuring(page, ms, selector = '.cell-output') {
    let max = 0;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        const h = await page.locator(selector).first().evaluate(
            el => (el ? Math.round(el.getBoundingClientRect().height) : 0)
        ).catch(() => 0);
        if (h > max) max = h;
        await page.waitForTimeout(30);
    }
    return max;
}
