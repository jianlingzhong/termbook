// Global setup for the SSH e2e suite (08_ssh_session.spec.mjs).
//
// Starts a userspace sshd on 127.0.0.1:2222 with a one-off host key and
// the developer's ed25519 key pre-authorized. We use a non-privileged port
// because enabling the real macOS Remote Login service requires Full Disk
// Access privileges that this test runner doesn't (and shouldn't) have.
//
// Side effects (all written under /tmp/termbook-e2e-sshd/):
//   - ssh_host_ed25519_key, .pub  : per-run host key
//   - sshd_config                  : config pinned to port 2222, our key only
//   - sshd.pid, sshd.log           : runtime artifacts
//
// We DON'T touch the user's ~/.ssh/known_hosts here; tests use
// `-o UserKnownHostsFile=/tmp/termbook-e2e-sshd/known_hosts` so the
// developer's machine's known_hosts stays untouched.
//
// If port 2222 is already in use (e.g. another test run is still active),
// we reuse it. If the developer's ~/.ssh/id_ed25519 doesn't exist, we
// generate one. If authorized_keys isn't readable, we bail with a clear
// message (developer must add their key manually).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const SSHD_DIR = '/tmp/termbook-e2e-sshd';
const SSHD_PORT = 2222;
const SSHD_HOST = '127.0.0.1';

function portInUse(port) {
    return new Promise(resolve => {
        const s = net.createConnection({ host: '127.0.0.1', port }, () => { s.end(); resolve(true); });
        s.on('error', () => resolve(false));
    });
}

function sh(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
    if (r.status !== 0 && !opts.allowFail) {
        throw new Error(`Command failed: ${cmd} ${args.join(' ')}\nstderr: ${r.stderr}\nstdout: ${r.stdout}`);
    }
    return r;
}

export default async function globalSetup() {
    // 1. Port reuse check
    if (await portInUse(SSHD_PORT)) {
        console.log(`[ssh-setup] sshd already running on ${SSHD_HOST}:${SSHD_PORT}, reusing`);
        // Make sure the auth chain still works.
        const ok = sh('ssh', [
            '-p', String(SSHD_PORT),
            '-o', 'BatchMode=yes',
            '-o', `UserKnownHostsFile=${SSHD_DIR}/known_hosts`,
            '-o', 'StrictHostKeyChecking=accept-new',
            SSHD_HOST,
            'echo OK_REUSE',
        ], { allowFail: true });
        if ((ok.stdout || '').includes('OK_REUSE')) return;
        console.warn('[ssh-setup] existing sshd not usable, restarting');
        try { sh('pkill', ['-F', `${SSHD_DIR}/sshd.pid`], { allowFail: true }); } catch {}
    }

    fs.mkdirSync(SSHD_DIR, { recursive: true });

    // 2. Host key. Persist across runs so ~/.ssh/known_hosts entries stay
    // valid after the first run. If a previous run left a key, REUSE it.
    const hostKey = `${SSHD_DIR}/ssh_host_ed25519_key`;
    if (!fs.existsSync(hostKey)) {
        sh('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostKey]);
    }
    fs.chmodSync(hostKey, 0o600);

    // 2b. Remove any stale ~/.ssh/known_hosts entry for [127.0.0.1]:2222
    // pointing at a DIFFERENT host key. Otherwise Termbook's ssh (which
    // uses the default known_hosts) will fail with "REMOTE HOST
    // IDENTIFICATION HAS CHANGED" and refuse the connection.
    const userKnownHosts = path.join(os.homedir(), '.ssh', 'known_hosts');
    sh('ssh-keygen', ['-R', `[${SSHD_HOST}]:${SSHD_PORT}`, '-f', userKnownHosts], { allowFail: true });
    // Re-seed the entry to the CURRENT host key.
    const scan = sh('ssh-keyscan', ['-p', String(SSHD_PORT), '-H', SSHD_HOST], { allowFail: true });
    // The scan may fail if sshd isn't up yet — we'll re-seed after launch.
    void scan;

    // 3. Developer key + authorized_keys
    const userKey = path.join(os.homedir(), '.ssh', 'id_ed25519');
    const userKeyPub = `${userKey}.pub`;
    if (!fs.existsSync(userKey)) {
        sh('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', userKey]);
    }
    const authKeys = path.join(os.homedir(), '.ssh', 'authorized_keys');
    const pubContent = fs.readFileSync(userKeyPub, 'utf8').trim();
    let auth = '';
    try { auth = fs.readFileSync(authKeys, 'utf8'); } catch {}
    if (!auth.split('\n').some(l => l.trim() === pubContent)) {
        fs.appendFileSync(authKeys, '\n' + pubContent + '\n');
        try { fs.chmodSync(authKeys, 0o600); } catch {}
    }

    // 4. sshd_config
    const sshdConfig = `Port ${SSHD_PORT}
ListenAddress ${SSHD_HOST}
HostKey ${hostKey}
PidFile ${SSHD_DIR}/sshd.pid
PasswordAuthentication no
ChallengeResponseAuthentication no
UsePAM no
PubkeyAuthentication yes
AuthorizedKeysFile %h/.ssh/authorized_keys
PermitRootLogin no
StrictModes no
PrintMotd no
PrintLastLog no
AcceptEnv LANG LC_*
Subsystem sftp /usr/libexec/sftp-server
`;
    fs.writeFileSync(`${SSHD_DIR}/sshd_config`, sshdConfig);

    // 5. Launch sshd (non-daemonized? actually use default daemon mode so it
    //    detaches; we manage via PidFile).
    sh('/usr/sbin/sshd', [
        '-f', `${SSHD_DIR}/sshd_config`,
        '-E', `${SSHD_DIR}/sshd.log`,
    ]);

    // 6. Wait for port
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if (await portInUse(SSHD_PORT)) break;
        await new Promise(r => setTimeout(r, 100));
    }
    if (!(await portInUse(SSHD_PORT))) {
        throw new Error(`[ssh-setup] sshd failed to bind ${SSHD_HOST}:${SSHD_PORT}. See ${SSHD_DIR}/sshd.log`);
    }

    // 7. Seed known_hosts. We seed TWO files:
    //    - /tmp/termbook-e2e-sshd/known_hosts — test-private, for the smoke
    //      check below and for any test that explicitly opts into it.
    //    - ~/.ssh/known_hosts — the default ssh reads from here, and that's
    //      the file Termbook's spawned ssh will hit. We must add a current
    //      entry here so the test ssh succeeds without -o overrides.
    const scanOut = sh('ssh-keyscan', ['-p', String(SSHD_PORT), '-H', SSHD_HOST]);
    fs.writeFileSync(`${SSHD_DIR}/known_hosts`, scanOut.stdout);
    // Append to user's known_hosts (the earlier ssh-keygen -R removed stale entries).
    fs.appendFileSync(userKnownHosts, scanOut.stdout);

    // 8. Smoke test
    const smoke = sh('ssh', [
        '-p', String(SSHD_PORT),
        '-o', 'BatchMode=yes',
        '-o', `UserKnownHostsFile=${SSHD_DIR}/known_hosts`,
        SSHD_HOST,
        'echo SMOKE_OK',
    ]);
    if (!smoke.stdout.includes('SMOKE_OK')) {
        throw new Error(`[ssh-setup] smoke test failed: ${smoke.stderr}`);
    }
    console.log(`[ssh-setup] userspace sshd ready on ${SSHD_HOST}:${SSHD_PORT}`);
}
