// Global teardown for the SSH e2e suite.
//
// Leaves the sshd RUNNING by default so subsequent local test runs don't
// pay the setup cost. Set TERMBOOK_E2E_KILL_SSHD=1 to force teardown.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const PID_FILE = '/tmp/termbook-e2e-sshd/sshd.pid';

export default async function globalTeardown() {
    if (!process.env.TERMBOOK_E2E_KILL_SSHD) return;
    try {
        if (fs.existsSync(PID_FILE)) {
            spawnSync('pkill', ['-F', PID_FILE], { stdio: 'ignore' });
            fs.unlinkSync(PID_FILE);
            console.log('[ssh-teardown] sshd stopped');
        }
    } catch (e) {
        console.warn('[ssh-teardown] cleanup error:', e.message);
    }
}
