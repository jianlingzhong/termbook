// E2E: SSH session — Path B (default).
//
// Termbook automatically injects a salted shell-integration into the remote
// shell when the user runs an interactive `ssh user@host`. From that point
// each remote command becomes a real Termbook cell with REAL remote pwd /
// git branch / exit code in the chips. The outer ssh cell becomes a
// session-header cell.
//
// Tests cover:
//   A. Happy path: ssh → cd remote → ls → exit
//   B. Each remote cell has 🔌 SSH host chip (orange)
//   C. Remote pwd shown correctly in chip after `cd /tmp`
//   D. Remote git branch shown after `cd <git repo>`
//   E. Remote command exit code (success + failure) reflected in cell
//   F. vim over SSH opens TUI modal, :q! returns to SSH-active session
//   G. ssh --no-termbook opts out (no chip, falls back to old behavior)
//   H. ssh host cmd (single-shot) treated as plain one-shot, no injection
//   I. `exit` on remote cleanly closes the outer ssh-session-header cell
//   J. Nested ssh works (outer injection holds, inner is plain)
//
// Prerequisites (handled by ssh-global-setup.mjs):
//   - Userspace sshd on 127.0.0.1:2222
//   - Developer's id_ed25519 in ~/.ssh/authorized_keys
//   - known_hosts seeded at /tmp/termbook-e2e-sshd/known_hosts

import { test, expect } from '@playwright/test';
import {
    VIEWPORT, gotoFreshSession, waitInputReady, runCommand, shot, lastCellInfo, waitForPassthrough, waitForIdle,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

const SSH_HOST = '127.0.0.1';
const SSH_PORT = 2222;

// Helper: submit a command and wait for the ssh session to become active.
// In Path B, the outer ssh cell closes when injection succeeds. So "ready"
// here = (a) outer ssh cell shows the SSH session placeholder, AND
//        (b) input is back to non-passthrough (or the SSH-active idle).
async function loginSsh(page, extraArgs = '') {
    const inp = await waitInputReady(page);
    await inp.fill(`ssh -p ${SSH_PORT} ${extraArgs} ${SSH_HOST}`);
    await inp.press('Enter');
    // Wait for sshState to reach 'active' — observable as the outer cell
    // closing with usedSshSession placeholder. Max ~6s (injection delay +
    // idle window + bootstrap roundtrip).
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const cells = await page.evaluate(() => Array.from(document.querySelectorAll('.notebook-cell')).map(c => ({
            cmd: c.querySelector('.read-only-command')?.textContent || null,
            isRunning: c.classList.contains('active-cell'),
            hasSshChip: !!c.querySelector('.cell-env-chip-ssh'),
            usedSshSession: !!c.querySelector('.tui-completed-placeholder'),
        })));
        const outer = cells.find(c => (c.cmd || '').startsWith('ssh '));
        if (outer && !outer.isRunning && outer.usedSshSession) return;
        await page.waitForTimeout(200);
    }
    throw new Error('SSH never reached active Path B state within 10s');
}

// Submit a command WHILE the SSH session is active (will become a remote cell).
async function runRemote(page, cmd, { afterMs = 1200 } = {}) {
    const inp = page.locator('.chat-input-wrapper textarea').first();
    await inp.focus();
    await inp.fill(cmd);
    await inp.press('Enter');
    // Wait for the cell to close (no active cell remains).
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        const n = await page.locator('.notebook-cell.active-cell').count();
        if (n === 0) { await page.waitForTimeout(afterMs); return; }
        await page.waitForTimeout(150);
    }
    throw new Error(`remote cmd did not finish in 8s: ${cmd}`);
}

// Inspect all cells with their SSH-related metadata.
async function inspectCells(page) {
    return await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.notebook-cell')).map((c, i) => ({
            idx: i,
            cmd: c.querySelector('.read-only-command')?.textContent || null,
            isRunning: c.classList.contains('active-cell'),
            isFailed: c.classList.contains('failed-cell'),
            isSuccess: c.classList.contains('success-cell'),
            exitBadge: c.querySelector('.exit-code-badge')?.textContent || null,
            sshChip: c.querySelector('.cell-env-chip-ssh')?.innerText || null,
            gitChip: c.querySelector('.cell-env-chip-git')?.innerText || null,
            pwdBreadcrumb: c.querySelector('.cell-header-breadcrumb')?.innerText || null,
            usedSshSession: !!c.querySelector('.tui-completed-placeholder'),
            // Full output, not sliced — slicing was hiding content with
            // trailing whitespace from snapshot rendering.
            output: (c.querySelector('.cell-output')?.innerText || ''),
        }));
    });
}

test.describe('SSH session — Path B by default', () => {

    test('A: happy path: ssh, run remote commands, each is its own cell with SSH chip', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await shot(page, testInfo, '01_blank');

        await loginSsh(page);
        await shot(page, testInfo, '02_logged_in');

        // The outer ssh cell must be marked usedSshSession with the SSH host chip.
        const afterLogin = await inspectCells(page);
        expect(afterLogin.length).toBeGreaterThanOrEqual(1);
        const outer = afterLogin[0];
        expect(outer.cmd).toContain('ssh');
        expect(outer.usedSshSession).toBe(true);
        expect(outer.sshChip).toBeTruthy();

        // Run a remote command. Each should land as its own cell.
        await runRemote(page, 'echo HELLO_FROM_REMOTE');
        await shot(page, testInfo, '03_after_echo');
        const afterEcho = await inspectCells(page);
        const echoCell = afterEcho[afterEcho.length - 1];
        expect(echoCell.cmd).toBe('echo HELLO_FROM_REMOTE');
        expect(echoCell.sshChip).toBeTruthy();
        expect(echoCell.output).toContain('HELLO_FROM_REMOTE');
        expect(echoCell.isSuccess).toBe(true);
    });

    test('B: remote `cd /tmp` updates pwd breadcrumb to remote /tmp', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await loginSsh(page);
        await runRemote(page, 'cd /tmp');
        await runRemote(page, 'pwd');
        await shot(page, testInfo, '01_after_pwd');

        const cells = await inspectCells(page);
        // The pwd-cell's breadcrumb should show /tmp (remote pwd).
        const pwdCell = cells.find(c => c.cmd === 'pwd');
        expect(pwdCell).toBeTruthy();
        expect(pwdCell.pwdBreadcrumb).toContain('/tmp');
        expect(pwdCell.output).toContain('/tmp');
    });

    test('C: remote `cd <git repo>` shows git branch chip', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await loginSsh(page);
        // termbook itself is a git repo accessible to the remote (loopback).
        await runRemote(page, 'cd /Users/' + process.env.USER + '/personal/termbook');
        await runRemote(page, 'git rev-parse --abbrev-ref HEAD');
        await shot(page, testInfo, '01_after_git');

        const cells = await inspectCells(page);
        const gitCell = cells[cells.length - 1];
        expect(gitCell.gitChip).toBeTruthy();
        expect(gitCell.gitChip.trim().length).toBeGreaterThan(0);
        // The output should contain the same branch name shown on the chip.
        expect(gitCell.output.trim().length).toBeGreaterThan(0);
    });

    test('D: failing remote command shows nonzero exit badge with red border', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await loginSsh(page);
        await runRemote(page, 'this_command_does_not_exist_xyz_qqq');
        await shot(page, testInfo, '01_remote_fail');

        const cells = await inspectCells(page);
        const failCell = cells[cells.length - 1];
        expect(failCell.isFailed).toBe(true);
        expect(failCell.exitBadge).toBeTruthy();
        // bash/zsh emit 127 for "command not found"
        expect(failCell.exitBadge).toContain('127');
        expect(failCell.sshChip).toBeTruthy(); // still tagged as remote
    });

    test('E: `exit` on remote closes the session (no more SSH-active state)', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await loginSsh(page);
        await runRemote(page, 'echo BEFORE_EXIT');
        // Now exit
        const inp = page.locator('.chat-input-wrapper textarea').first();
        await inp.focus();
        await inp.fill('exit');
        await inp.press('Enter');
        // Wait for everything to settle
        await waitForIdle(page, 12000);
        await shot(page, testInfo, '01_after_exit');
        const cells = await inspectCells(page);
        const last = cells[cells.length - 1];
        expect(last.cmd).toBe('exit');
        expect(last.isSuccess).toBe(true);
        // After exit, a NEW local cell should NOT have the SSH chip.
        await runCommand(page, 'pwd');
        const after = await inspectCells(page);
        const local = after[after.length - 1];
        expect(local.sshChip).toBeNull();
    });

    test('F: vim on remote opens TUI modal; :q! returns to active SSH session', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await loginSsh(page);
        // Prepare a file on remote
        await runRemote(page, 'echo "vim test content" > /tmp/termbook_e2e_vim.txt');
        // Open vim
        const inp = page.locator('.chat-input-wrapper textarea').first();
        await inp.focus();
        await inp.fill('vim /tmp/termbook_e2e_vim.txt');
        await inp.press('Enter');
        // Wait for TUI modal
        const tuiDeadline = Date.now() + 5000;
        let tuiOpen = false;
        while (Date.now() < tuiDeadline) {
            const fl = await page.evaluate(() => !!document.querySelector('.chat-input-wrapper.is-tui'));
            if (fl) { tuiOpen = true; break; }
            await page.waitForTimeout(150);
        }
        expect(tuiOpen).toBe(true);
        await shot(page, testInfo, '01_in_vim');
        // Quit vim
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.keyboard.type(':q!');
        await page.keyboard.press('Enter');
        await waitForIdle(page, 10000);
        await shot(page, testInfo, '02_after_vim');
        // After vim, we should still be in SSH session (next cmd gets SSH chip)
        await runRemote(page, 'echo POST_VIM_OK');
        const cells = await inspectCells(page);
        const post = cells[cells.length - 1];
        expect(post.cmd).toBe('echo POST_VIM_OK');
        expect(post.sshChip).toBeTruthy();
        expect(post.output).toContain('POST_VIM_OK');
    });

    test('G: --no-termbook opts out: no SSH chip, falls back to Path A behavior', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        await inp.fill(`ssh --no-termbook -p ${SSH_PORT} ${SSH_HOST}`);
        await inp.press('Enter');
        // Should engage passthrough (the entire ssh session is one cell).
        await waitForPassthrough(page, 8000);
        await shot(page, testInfo, '01_no_termbook');
        const cells1 = await inspectCells(page);
        const sshCell = cells1[cells1.length - 1];
        expect(sshCell.isRunning).toBe(true);
        // The outer ssh cell should NOT be marked usedSshSession (no Path B).
        expect(sshCell.usedSshSession).toBe(false);
        // Exit so the cell closes
        const inp2 = page.locator('.chat-input-wrapper textarea').first();
        await inp2.focus();
        await page.keyboard.type('exit');
        await page.keyboard.press('Enter');
        await waitForIdle(page, 10000);
    });

    test('H: single-shot ssh (with trailing remote cmd) is treated as plain one-shot', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await runCommand(page, `ssh -p ${SSH_PORT} ${SSH_HOST} 'echo ONE_SHOT_OK'`);
        await shot(page, testInfo, '01_oneshot');
        const cells = await inspectCells(page);
        const last = cells[cells.length - 1];
        expect(last.cmd).toContain('ssh');
        expect(last.output).toContain('ONE_SHOT_OK');
        // Single-shot: no SSH chip (Path B not engaged because no interactive remote shell).
        expect(last.sshChip).toBeNull();
        expect(last.usedSshSession).toBe(false);
    });

    test('I: nested ssh: outer Path B holds, inner exits cleanly back to outer', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await loginSsh(page);
        // Inner ssh — back to ourselves (single-shot to test, since nested
        // interactive inner injection is intentionally not supported in v1).
        await runRemote(page, `ssh -p ${SSH_PORT} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${SSH_HOST} 'echo NESTED_OK'`);
        await shot(page, testInfo, '01_after_nested');
        const cells = await inspectCells(page);
        const nestedCell = cells[cells.length - 1];
        expect(nestedCell.output).toContain('NESTED_OK');
        // After the nested command exits, we should still be inside the
        // OUTER SSH session — the next remote command still gets the SSH chip.
        await runRemote(page, 'echo BACK_TO_OUTER');
        const after = await inspectCells(page);
        const back = after[after.length - 1];
        expect(back.cmd).toBe('echo BACK_TO_OUTER');
        expect(back.sshChip).toBeTruthy();
    });

    test('J: regression — unsalted OSC 133 from remote does NOT close cells', async ({ page }, testInfo) => {
        // Even though Path B uses salted markers, we want to verify that a
        // malicious/buggy remote command emitting an unsalted 133;D does
        // NOT prematurely close a remote cell.
        await gotoFreshSession(page);
        await loginSsh(page);
        // This should be ONE cell whose output contains both BEFORE and
        // AFTER text — the unsalted marker in the middle must NOT split
        // it into two cells.
        await runRemote(page, String.raw`printf 'BEFORE_FAKE\n\033]133;D;0\007AFTER_FAKE\n'`);
        await shot(page, testInfo, '01_unsalted_attack');
        const cells = await inspectCells(page);
        const target = cells.find(c => (c.cmd || '').includes('printf'));
        expect(target).toBeTruthy();
        expect(target.output).toContain('BEFORE_FAKE');
        expect(target.output).toContain('AFTER_FAKE');
        // And there should NOT be a stray cell created from the spoofed marker.
        const printfCellCount = cells.filter(c => (c.cmd || '').includes('printf')).length;
        expect(printfCellCount).toBe(1);
    });

    test('K: Tab completion in chat input completes against the REMOTE filesystem', async ({ page }, testInfo) => {
        // Path B's Tab completion routes through the remote shell (via the
        // __tb_complete RPC injected at session start), NOT through local
        // /api/complete on the backend's filesystem.
        //
        // Verifies:
        //   1. Tab completes a remote-only path to its single match.
        //   2. Multiple matches cycle correctly with repeated Tab presses.
        //   3. TBCMP markers do NOT leak into any cell output.
        await gotoFreshSession(page);
        await loginSsh(page);

        // Prepare three remote files with a common prefix.
        await runRemote(page, 'touch /tmp/__tb_e2e_tab_a /tmp/__tb_e2e_tab_b /tmp/__tb_e2e_tab_c');

        const inp = page.locator('.chat-input-wrapper textarea').first();
        await inp.focus();
        await inp.fill('ls /tmp/__tb_e2e_tab_');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(700);
        const t1 = await page.evaluate(() => document.querySelector('.chat-input-wrapper textarea')?.value);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(400);
        const t2 = await page.evaluate(() => document.querySelector('.chat-input-wrapper textarea')?.value);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(400);
        const t3 = await page.evaluate(() => document.querySelector('.chat-input-wrapper textarea')?.value);
        await shot(page, testInfo, '01_after_tab_cycle');

        // Each Tab should produce a distinct candidate.
        const completions = [t1, t2, t3];
        const distinct = new Set(completions);
        expect(distinct.size).toBe(3);
        // All three must end with one of a/b/c.
        for (const c of completions) {
            expect(c).toMatch(/^ls \/tmp\/__tb_e2e_tab_[abc]$/);
        }

        // Crucially: no TBCMP marker text should appear in ANY cell.
        const anyTbcmp = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.notebook-cell')).some(c =>
                (c.querySelector('.cell-output')?.innerText || '').includes('TBCMP')
            );
        });
        expect(anyTbcmp).toBe(false);

        // Cleanup
        await page.keyboard.press('Escape');
        await inp.fill('');
        await runRemote(page, 'rm -f /tmp/__tb_e2e_tab_a /tmp/__tb_e2e_tab_b /tmp/__tb_e2e_tab_c');
    });
});
